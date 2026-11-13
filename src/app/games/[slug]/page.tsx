import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense, cache, type ReactNode } from "react";
import { findSlugByIgdbId, getGameBySlug, type GameDetail } from "@/features/games/detail";
import { averageLabel, formatAverage } from "@/lib/rating";
import { appPool } from "@/server/db/client";
import { igdbSource } from "@/server/igdb";
import type { GameDraft } from "@/server/igdb/mapper";

// 메타데이터와 본문이 같은 게임을 두 번 읽지 않게 한 요청 안에서 묶는다.
const loadGame = cache((slug: string) => getGameBySlug(appPool(), slug));

export async function generateMetadata({ params }: PageProps<"/games/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  // 미리보기(`igdb-{id}`)는 IGDB를 부르지 않고는 이름을 알 수 없어, 탭 제목을 위해 외부 호출을 하지 않는다.
  if (/^igdb-\d+$/.test(slug)) return { title: "게임 미리보기" };
  const game = await loadGame(slug);
  return { title: game ? (game.titleKo ?? game.title) : "게임" };
}

export default function GamePage({ params }: PageProps<"/games/[slug]">) {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 lg:px-8">
      {/* 게임 정보는 요청 시점 데이터라 Suspense 경계 안에서 읽는다(Cache Components). */}
      <Suspense fallback={null}>
        <GameContent params={params} />
      </Suspense>
    </main>
  );
}

/** 이름과 이동할 곳. 내부에 없는 항목(아직 가져오지 않은 회사 등)은 `href`가 없어 글자로만 보인다. */
type Linked = { name: string; href: string | null };

type View = {
  title: string;
  originalTitle: string | null;
  summary: string | null;
  releaseDate: string | null;
  cover: { url: string; width: number; height: number } | null;
  developers: Linked[];
  publishers: Linked[];
  platforms: string[];
  genres: Linked[];
  tags: Linked[];
  /** 평균 평점. 아직 서비스에 없는 미리보기는 평가가 있을 수 없으므로 비워 두어 아예 그리지 않는다. */
  rating?: { text: string | null; label: string | null };
};

const fromDetail = (g: GameDetail): View => ({
  title: g.titleKo ?? g.title,
  originalTitle: g.titleKo ? g.title : null,
  summary: g.summary,
  releaseDate: g.releaseDate,
  cover: g.coverUrl && g.coverWidth && g.coverHeight ? { url: g.coverUrl, width: g.coverWidth, height: g.coverHeight } : null,
  developers: g.developers.map((c) => ({ name: c.name, href: `/companies/${c.slug}` })),
  publishers: g.publishers.map((c) => ({ name: c.name, href: `/companies/${c.slug}` })),
  platforms: g.platforms.map((p) => p.name),
  genres: g.genres.map((x) => ({ name: x.name, href: `/genres/${x.slug}` })),
  tags: g.tags.map((x) => ({ name: x.name, href: `/tags/${x.slug}` })),
  rating: { text: formatAverage(g.ratingSum, g.ratingCount), label: averageLabel(g.ratingSum, g.ratingCount) },
});

async function GameContent({ params }: Pick<PageProps<"/games/[slug]">, "params">) {
  const { slug } = await params;
  const preview = /^igdb-(\d+)$/.exec(slug);
  if (preview) return <PreviewContent igdbId={Number(preview[1])} />;

  const game = await loadGame(slug);
  if (!game) notFound();
  return <GameView view={fromDetail(game)} />;
}

/** 아직 가져오지 않은 IGDB 게임. IGDB에서 읽어 보여 줄 뿐 DB에는 아무것도 쓰지 않는다. */
async function PreviewContent({ igdbId }: { igdbId: number }) {
  const pool = appPool();
  const internalSlug = await findSlugByIgdbId(pool, igdbId);
  if (internalSlug) redirect(`/games/${internalSlug}`);

  let draft: GameDraft | null = null;
  try {
    draft = await igdbSource().get(igdbId);
  } catch {
    return (
      <p role="status" className="type-body">
        게임 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.{" "}
        <Link href="/search" className="font-semibold underline underline-offset-4">
          검색으로 돌아가기
        </Link>
      </p>
    );
  }
  if (!draft) notFound();

  // 장르·태그는 내부 분류표에서 찾는다(IGDB 응답에는 슬러그만 변환돼 있다). 회사는 다른 게임으로 이미 가져온 것만
  // 내부 페이지가 있으므로 IGDB ID로 찾아 있을 때만 링크한다.
  const companies = [...draft.developers, ...draft.publishers];
  const [genres, tags, known] = await Promise.all([
    pool.query<{ slug: string; name: string }>("select slug, name from genres where slug = any($1) order by id", [draft.genreSlugs]),
    pool.query<{ slug: string; name: string }>("select slug, name from tags where slug = any($1) order by name", [draft.tagSlugs]),
    pool.query<{ igdb_id: number; slug: string }>("select igdb_id, slug from game_companies where igdb_id = any($1)", [companies.map((c) => c.igdbId)]),
  ]);
  const companySlug = new Map(known.rows.map((r) => [r.igdb_id, r.slug]));
  const company = (c: { igdbId: number; name: string }): Linked => {
    const slug = companySlug.get(c.igdbId);
    return { name: c.name, href: slug ? `/companies/${slug}` : null };
  };
  return (
    <GameView
      preview
      view={{
        title: draft.titleKo ?? draft.title,
        originalTitle: draft.titleKo ? draft.title : null,
        summary: draft.summary,
        releaseDate: draft.releaseDate,
        cover: draft.cover,
        developers: draft.developers.map(company),
        publishers: draft.publishers.map(company),
        platforms: draft.platforms.map((p) => p.name),
        genres: genres.rows.map((r) => ({ name: r.name, href: `/genres/${r.slug}` })),
        tags: tags.rows.map((r) => ({ name: r.name, href: `/tags/${r.slug}` })),
      }}
    />
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="type-body mt-1">{children}</dd>
    </div>
  );
}

/** 이름 목록. 이동할 곳이 있는 항목만 밑줄 링크이고, 링크 사이 간격은 터치하기 쉽게 세로 여백을 둔다. */
function LinkList({ items }: { items: Linked[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4">
      {items.map((item) => (
        <li key={item.href ?? item.name}>
          {item.href ? (
            <Link href={item.href} className="inline-block py-2 underline underline-offset-4">
              {item.name}
            </Link>
          ) : (
            <span className="inline-block py-2">{item.name}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

function GameView({ view, preview = false }: { view: View; preview?: boolean }) {
  const year = view.releaseDate?.slice(0, 4) ?? null;
  const facts: [string, ReactNode][] = [
    ["출시일", view.releaseDate],
    ["개발사", view.developers.length ? <LinkList items={view.developers} /> : null],
    ["퍼블리셔", view.publishers.length ? <LinkList items={view.publishers} /> : null],
    ["플랫폼", view.platforms.join(", ") || null],
    ["태그", view.tags.length ? <LinkList items={view.tags} /> : null],
  ];
  return (
    <article className="grid gap-8 md:grid-cols-[14rem_1fr]">
      <div>
        {view.cover ? (
          <Image src={view.cover.url} alt={`${view.title} 커버`} width={view.cover.width} height={view.cover.height} sizes="(min-width: 768px) 14rem, 60vw" className="h-auto w-full max-w-56 border border-line" priority />
        ) : (
          <div aria-hidden="true" className="aspect-[3/4] w-full max-w-56 border border-line bg-line-subtle" />
        )}
      </div>
      <div>
        <h1 className="type-h1">{view.title}</h1>
        {view.originalTitle ? <p className="type-body-sm mt-1 text-muted">{view.originalTitle}</p> : null}
        {year || view.genres.length ? (
          <div className="mt-2 flex flex-wrap items-center gap-x-4">
            {year ? <span className="type-body-sm text-muted">{year}</span> : null}
            {view.genres.length ? <LinkList items={view.genres} /> : null}
          </div>
        ) : null}
        {view.rating ? (
          <p className="type-mono mt-2">
            {view.rating.text ? (
              <>
                {/* 괄호 안의 숫자만 읽으면 무엇의 수인지 알 수 없어, 읽는 문구를 따로 둔다. */}
                <span className="sr-only">{view.rating.label}</span>
                <span aria-hidden="true">평균 {view.rating.text}</span>
              </>
            ) : (
              "아직 평가가 없어요"
            )}
          </p>
        ) : null}
        {preview ? (
          <p role="note" className="type-body-sm mt-4 border border-line px-3 py-2">
            아직 서비스에 등록되지 않은 게임이에요. 처음 기록하면 등록돼요.
          </p>
        ) : null}
        <dl className="mt-6 grid gap-4 sm:grid-cols-2">
          {facts.map(([label, value]) => (value ? <Fact key={label} label={label}>{value}</Fact> : null))}
        </dl>
        {view.summary ? (
          <section className="mt-8" aria-labelledby="game-summary">
            <h2 id="game-summary" className="type-h3">
              소개
            </h2>
            <p className="type-body mt-2 whitespace-pre-line">{view.summary}</p>
          </section>
        ) : null}
      </div>
    </article>
  );
}

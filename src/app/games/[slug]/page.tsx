import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { findSlugByIgdbId, getGameBySlug, type GameDetail } from "@/features/games/detail";
import { appPool } from "@/server/db/client";
import { igdbSource } from "@/server/igdb";
import type { GameDraft } from "@/server/igdb/mapper";

export const metadata: Metadata = { title: "게임" };

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

type View = {
  title: string;
  originalTitle: string | null;
  summary: string | null;
  releaseDate: string | null;
  cover: { url: string; width: number; height: number } | null;
  developers: string[];
  publishers: string[];
  platforms: string[];
  genres: string[];
  tags: string[];
};

const fromDetail = (g: GameDetail): View => ({
  title: g.titleKo ?? g.title,
  originalTitle: g.titleKo ? g.title : null,
  summary: g.summary,
  releaseDate: g.releaseDate,
  cover: g.coverUrl && g.coverWidth && g.coverHeight ? { url: g.coverUrl, width: g.coverWidth, height: g.coverHeight } : null,
  developers: g.developers.map((c) => c.name),
  publishers: g.publishers.map((c) => c.name),
  platforms: g.platforms.map((p) => p.name),
  genres: g.genres.map((x) => x.name),
  tags: g.tags.map((x) => x.name),
});

async function GameContent({ params }: Pick<PageProps<"/games/[slug]">, "params">) {
  const { slug } = await params;
  const preview = /^igdb-(\d+)$/.exec(slug);
  if (preview) return <PreviewContent igdbId={Number(preview[1])} />;

  const game = await getGameBySlug(appPool(), slug);
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

  // 장르·태그 이름은 내부 분류표에서 찾는다(IGDB 응답에는 슬러그만 변환돼 있다).
  const [genres, tags] = await Promise.all([
    pool.query<{ name: string }>("select name from genres where slug = any($1) order by id", [draft.genreSlugs]),
    pool.query<{ name: string }>("select name from tags where slug = any($1) order by name", [draft.tagSlugs]),
  ]);
  return (
    <GameView
      preview
      view={{
        title: draft.titleKo ?? draft.title,
        originalTitle: draft.titleKo ? draft.title : null,
        summary: draft.summary,
        releaseDate: draft.releaseDate,
        cover: draft.cover,
        developers: draft.developers.map((c) => c.name),
        publishers: draft.publishers.map((c) => c.name),
        platforms: draft.platforms.map((p) => p.name),
        genres: genres.rows.map((r) => r.name),
        tags: tags.rows.map((r) => r.name),
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

function GameView({ view, preview = false }: { view: View; preview?: boolean }) {
  const facts: [string, string | null][] = [
    ["출시일", view.releaseDate],
    ["개발사", view.developers.join(", ") || null],
    ["퍼블리셔", view.publishers.join(", ") || null],
    ["플랫폼", view.platforms.join(", ") || null],
    ["장르", view.genres.join(", ") || null],
    ["태그", view.tags.join(", ") || null],
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

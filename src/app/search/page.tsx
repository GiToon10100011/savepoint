import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { GameCard } from "@/components/game/game-card";
import { Button, buttonClasses } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GameGrid, MoreLink } from "@/features/games/components/game-grid";
import { searchCatalog, type Candidate } from "@/features/games/search";
import { appPool } from "@/server/db/client";
import { igdbSource } from "@/server/igdb";
import type { GameSource } from "@/server/igdb/source";

export const metadata: Metadata = { title: "검색" };

export default function SearchPage({ searchParams }: PageProps<"/search">) {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 lg:px-8">
      <h1 className="type-h1">검색</h1>
      {/* 검색어와 결과는 요청 시점 데이터라 Suspense 경계 안에서 읽는다(Cache Components). */}
      <Suspense fallback={null}>
        <SearchContent searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

const year = (date: string | null) => (date ? Number(date.slice(0, 4)) : null);

function candidateCard({ draft, internalSlug }: Candidate) {
  // 이미 가져온 게임이면 내부 페이지로, 아니면 DB에 쓰지 않는 미리보기로 연결한다.
  const href = internalSlug ? `/games/${internalSlug}` : `/games/igdb-${draft.igdbId}`;
  return <GameCard href={href} title={draft.titleKo ?? draft.title} year={year(draft.releaseDate)} cover={draft.cover ? { src: draft.cover.url, ...draft.cover } : null} hideRating />;
}

async function SearchContent({ searchParams }: Pick<PageProps<"/search">, "searchParams">) {
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.trim().slice(0, 100) : "";
  const cursor = typeof params.cursor === "string" ? params.cursor : null;

  // Twitch 키가 없거나 IGDB가 막혀도 내부 검색과 수동 등록은 동작해야 한다(기능 명세 B4).
  let source: GameSource | null = null;
  try {
    source = igdbSource();
  } catch {
    source = null;
  }
  const result = await searchCatalog(appPool(), source, q, { cursor });
  const empty = result.items.length === 0 && result.candidates.length === 0;
  const moreHref = result.nextCursor ? `/search?${new URLSearchParams({ ...(q ? { q } : {}), cursor: result.nextCursor })}` : null;

  return (
    <>
      <form action="/search" method="get" role="search" className="mt-6 flex gap-2">
        <Input name="q" type="search" defaultValue={q} aria-label="게임 검색" placeholder="게임 이름" autoComplete="off" />
        <Button type="submit">검색</Button>
        {q ? (
          <Link href="/search" className={buttonClasses({ variant: "ghost" })}>
            취소
          </Link>
        ) : null}
      </form>

      <h2 className="type-h2 mt-10">{q ? `‘${q}’ 검색 결과` : "인기 게임"}</h2>

      {empty ? <p className="type-body mt-6">{q ? "검색 결과가 없어요." : "아직 등록된 게임이 없어요."}</p> : null}

      {result.items.length > 0 ? <GameGrid items={result.items} /> : null}

      <MoreLink href={moreHref} />

      {result.candidates.length > 0 ? (
        <section aria-labelledby="igdb-candidates" className="mt-12">
          <h2 id="igdb-candidates" className="type-h3">
            IGDB에서 찾은 게임
          </h2>
          <p className="type-body-sm mt-2 text-muted">처음 기록하면 서비스에 등록돼요.</p>
          <ul className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4" aria-label="IGDB 후보 목록">
            {result.candidates.map((candidate) => (
              <li key={candidate.draft.igdbId}>{candidateCard(candidate)}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {result.igdbUnavailable ? (
        <p role="status" className="type-body-sm mt-8 text-muted">
          외부 게임 정보를 불러오지 못했어요. 등록된 게임만 보여 드려요.
        </p>
      ) : null}

      <p className="type-body mt-12">
        찾는 게임이 없나요?{" "}
        <Link href="/games/new" className="font-semibold underline underline-offset-4">
          게임 직접 등록하기
        </Link>
      </p>
    </>
  );
}

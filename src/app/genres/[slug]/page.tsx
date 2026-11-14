import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense, cache } from "react";
import { gamesByGenre, getGenreBySlug } from "@/features/games/browse";
import { FacetList } from "@/features/games/components/facet-list";
import { appPool } from "@/server/db/client";

// 메타데이터와 본문이 같은 장르를 두 번 읽지 않게 한 요청 안에서 묶는다.
const loadGenre = cache((slug: string) => getGenreBySlug(appPool(), slug));

export async function generateMetadata({ params }: PageProps<"/genres/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const genre = await loadGenre(slug);
  return { title: genre ? `${genre.name} 게임` : "장르" };
}

export default function GenrePage({ params, searchParams }: PageProps<"/genres/[slug]">) {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 lg:px-8">
      {/* 장르와 목록은 요청 시점 데이터라 Suspense 경계 안에서 읽는다(Cache Components). */}
      <Suspense fallback={null}>
        <GenreContent params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function GenreContent({ params, searchParams }: Pick<PageProps<"/genres/[slug]">, "params" | "searchParams">) {
  const { slug } = await params;
  const query = await searchParams;
  const cursor = typeof query.cursor === "string" ? query.cursor : null;

  const genre = await loadGenre(slug);
  if (!genre) notFound();
  const page = await gamesByGenre(appPool(), slug, { cursor });
  return <FacetList kind="장르" facet={genre} page={page} basePath={`/genres/${genre.slug}`} />;
}

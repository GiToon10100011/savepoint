import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense, cache } from "react";
import { gamesByTag, getTagBySlug } from "@/features/games/browse";
import { FacetList } from "@/features/games/components/facet-list";
import { appPool } from "@/server/db/client";

// 메타데이터와 본문이 같은 태그를 두 번 읽지 않게 한 요청 안에서 묶는다.
const loadTag = cache((slug: string) => getTagBySlug(appPool(), slug));

export async function generateMetadata({ params }: PageProps<"/tags/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const tag = await loadTag(slug);
  return { title: tag ? `${tag.name} 게임` : "태그" };
}

export default function TagPage({ params, searchParams }: PageProps<"/tags/[slug]">) {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 lg:px-8">
      {/* 태그와 목록은 요청 시점 데이터라 Suspense 경계 안에서 읽는다(Cache Components). */}
      <Suspense fallback={null}>
        <TagContent params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function TagContent({ params, searchParams }: Pick<PageProps<"/tags/[slug]">, "params" | "searchParams">) {
  const { slug } = await params;
  const query = await searchParams;
  const cursor = typeof query.cursor === "string" ? query.cursor : null;

  const tag = await loadTag(slug);
  if (!tag) notFound();
  const page = await gamesByTag(appPool(), slug, { cursor });
  return <FacetList kind="태그" facet={tag} page={page} basePath={`/tags/${tag.slug}`} />;
}

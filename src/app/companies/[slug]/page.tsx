import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense, cache } from "react";
import { buttonClasses } from "@/components/ui/button";
import { gamesByCompany, getCompanyBySlug } from "@/features/games/browse";
import { GameGrid, MoreLink } from "@/features/games/components/game-grid";
import { appPool } from "@/server/db/client";

// 메타데이터와 본문이 같은 회사를 두 번 읽지 않게 한 요청 안에서 묶는다.
const loadCompany = cache((slug: string) => getCompanyBySlug(appPool(), slug));

export async function generateMetadata({ params }: PageProps<"/companies/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const company = await loadCompany(slug);
  return { title: company ? (company.nameKo ?? company.name) : "게임회사" };
}

export default function CompanyPage({ params, searchParams }: PageProps<"/companies/[slug]">) {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 lg:px-8">
      {/* 회사와 목록은 요청 시점 데이터라 Suspense 경계 안에서 읽는다(Cache Components). */}
      <Suspense fallback={null}>
        <CompanyContent params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

type Role = "developer" | "publisher";

/** ISO 3166-1 alpha-2 코드를 한국어 나라 이름으로. 알 수 없는 코드는 그대로 보여 준다. */
function countryName(code: string | null): string | null {
  if (!code) return null;
  try {
    return new Intl.DisplayNames("ko", { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

async function CompanyContent({ params, searchParams }: Pick<PageProps<"/companies/[slug]">, "params" | "searchParams">) {
  const { slug } = await params;
  const query = await searchParams;
  const cursor = typeof query.cursor === "string" ? query.cursor : null;

  const company = await loadCompany(slug);
  if (!company) notFound();

  // 개발한 게임이 기본이고, 개발작이 없고 퍼블리싱작만 있으면 그쪽을 먼저 보여 준다.
  const requested: Role | null = query.role === "publisher" ? "publisher" : query.role === "developer" ? "developer" : null;
  const role: Role = requested ?? (company.developedCount === 0 && company.publishedCount > 0 ? "publisher" : "developer");
  const tabs: { role: Role; label: string; count: number }[] = [
    { role: "developer", label: "개발한 게임", count: company.developedCount },
    { role: "publisher", label: "퍼블리싱한 게임", count: company.publishedCount },
  ];

  const page = await gamesByCompany(appPool(), slug, role, { cursor });
  const moreHref = page.nextCursor ? `/companies/${company.slug}?${new URLSearchParams({ role, cursor: page.nextCursor })}` : null;
  const country = countryName(company.country);
  const activeLabel = tabs.find((tab) => tab.role === role)?.label ?? "";

  return (
    <>
      <p className="type-body-sm text-muted">게임회사</p>
      <h1 className="type-h1 mt-1">{company.nameKo ?? company.name}</h1>
      {company.nameKo ? <p className="type-body-sm mt-1 text-muted">{company.name}</p> : null}
      {country ? <p className="type-body-sm mt-1 text-muted">{country}</p> : null}

      <nav aria-label="회사의 게임" className="mt-6 flex flex-wrap gap-2">
        {tabs.map((tab) => (
          <Link
            key={tab.role}
            href={`/companies/${company.slug}?role=${tab.role}`}
            aria-current={tab.role === role ? "page" : undefined}
            className={buttonClasses({ variant: tab.role === role ? "primary" : "secondary" })}
          >
            {tab.label} <span className="type-mono ml-2">{tab.count.toLocaleString("en-US")}</span>
          </Link>
        ))}
      </nav>

      {page.items.length > 0 ? (
        <GameGrid items={page.items} label={activeLabel} />
      ) : (
        <p className="type-body mt-6">이 회사의 {activeLabel}이 아직 없어요.</p>
      )}
      <MoreLink href={moreHref} />
    </>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Button, buttonClasses } from "@/components/ui/button";
import { LibraryRow } from "@/features/library/components/library-row";
import {
  LIBRARY_SORTS,
  LIBRARY_SORT_LABELS,
  isLibraryFilter,
  isLibrarySort,
  listGenres,
  listLibrary,
  listPlatforms,
  type LibraryFilter,
  type LibrarySort,
} from "@/features/library/library";
import { PLAY_STATUSES, UNSET_STATUS_LABEL } from "@/lib/play-status";
import { appPool } from "@/server/db/client";
import { requireViewer } from "@/server/viewer";

export const metadata: Metadata = { title: "라이브러리" };

export default function LibraryPage({ searchParams }: PageProps<"/library">) {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 lg:px-8">
      <div className="flex items-center justify-between gap-4">
        <h1 className="type-h1">라이브러리</h1>
        <Link href="/search" className={buttonClasses({ variant: "secondary" })}>
          + 게임 추가
        </Link>
      </div>
      {/* 세션과 목록은 요청 시점 데이터라 Suspense 경계 안에서 읽는다(Cache Components). */}
      <Suspense fallback={null}>
        <LibraryContent searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

/** 빠른 전환 탭. 같은 `filter` 값을 아래 선택 상자도 쓴다(상태 7가지·미지정·평가함은 선택 상자에 모두 있다). */
const TABS: { value: LibraryFilter; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "playing", label: "플레이 중" },
  { value: "planned", label: "플레이 예정" },
  { value: "cleared", label: "엔딩 완료" },
  { value: "perfected", label: "100% 달성" },
  { value: "rated", label: "평가함" },
];

const FILTER_OPTIONS: { value: LibraryFilter; label: string }[] = [
  { value: "all", label: "전체" },
  ...PLAY_STATUSES.map((s) => ({ value: s.value as LibraryFilter, label: s.label })),
  { value: "unset", label: UNSET_STATUS_LABEL },
  { value: "rated", label: "평가함" },
];

const text = (value: string | string[] | undefined) => (typeof value === "string" ? value : undefined);

type View = { filter: LibraryFilter; sort: LibrarySort; genre?: string; platform?: string; cursor?: string };

/** 기본값은 주소에서 뺀다. 주소가 공유·새로고침에 안전하도록 화면 상태를 모두 담는다. */
function href({ filter, sort, genre, platform, cursor }: View): string {
  const query = new URLSearchParams();
  if (filter !== "all") query.set("filter", filter);
  if (sort !== "added") query.set("sort", sort);
  if (genre) query.set("genre", genre);
  if (platform) query.set("platform", platform);
  if (cursor) query.set("cursor", cursor);
  const qs = query.toString();
  return qs ? `/library?${qs}` : "/library";
}

const SELECT = "h-10 w-full border border-line-input bg-card px-3 text-sm font-normal text-fg focus:border-ink";

async function LibraryContent({ searchParams }: Pick<PageProps<"/library">, "searchParams">) {
  // proxy가 한 번 걸러 주지만 낙관적 검사일 뿐이라 화면에서도 확인한다(로그인하면 이 화면으로 돌아온다).
  const viewer = await requireViewer("/library");
  const params = await searchParams;
  const filterParam = text(params.filter);
  const sortParam = text(params.sort);
  const view: View = {
    filter: isLibraryFilter(filterParam) ? filterParam : "all",
    sort: isLibrarySort(sortParam) ? sortParam : "added",
    genre: text(params.genre)?.slice(0, 64),
    platform: text(params.platform)?.slice(0, 64),
    cursor: text(params.cursor),
  };

  const pool = appPool();
  const [page, genres, platforms] = await Promise.all([
    listLibrary(pool, { authUserId: viewer.user.id, profileId: viewer.profile.id }, view),
    listGenres(pool),
    listPlatforms(pool),
  ]);
  const filtered = view.filter !== "all" || Boolean(view.genre) || Boolean(view.platform);
  const moreHref = page.nextCursor ? href({ ...view, cursor: page.nextCursor }) : null;

  return (
    <>
      <nav aria-label="라이브러리 보기" className="mt-6 flex flex-wrap gap-2">
        {TABS.map((tab) => (
          <Link
            key={tab.value}
            href={href({ ...view, filter: tab.value, cursor: undefined })}
            aria-current={view.filter === tab.value ? "page" : undefined}
            className={buttonClasses({ variant: view.filter === tab.value ? "primary" : "secondary", size: "sm" })}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      {/* 주소(GET)에 담는 폼이라 JS 없이도 동작하고 결과를 공유·새로고침할 수 있다. */}
      <form action="/library" method="get" className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <label htmlFor="filter" className="mb-1 block text-xs text-muted">
            상태
          </label>
          <select id="filter" name="filter" defaultValue={view.filter} className={SELECT}>
            {FILTER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="genre" className="mb-1 block text-xs text-muted">
            장르
          </label>
          <select id="genre" name="genre" defaultValue={view.genre ?? ""} className={SELECT}>
            <option value="">전체</option>
            {genres.map((g) => (
              <option key={g.slug} value={g.slug}>
                {g.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="platform" className="mb-1 block text-xs text-muted">
            플랫폼
          </label>
          <select id="platform" name="platform" defaultValue={view.platform ?? ""} className={SELECT}>
            <option value="">전체</option>
            {platforms.map((p) => (
              <option key={p.slug} value={p.slug}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="sort" className="mb-1 block text-xs text-muted">
            정렬
          </label>
          <select id="sort" name="sort" defaultValue={view.sort} className={SELECT}>
            {LIBRARY_SORTS.map((s) => (
              <option key={s} value={s}>
                {LIBRARY_SORT_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
        <div className="col-span-2 sm:col-span-4">
          <Button type="submit" variant="secondary" size="sm">
            적용
          </Button>
        </div>
      </form>

      {page.items.length > 0 ? (
        <ul aria-label="라이브러리 목록" className="mt-6 border-t border-line">
          {page.items.map((item) => (
            <LibraryRow key={item.id} item={item} />
          ))}
        </ul>
      ) : filtered ? (
        <p className="type-body mt-8">
          조건에 맞는 게임이 없어요.{" "}
          <Link href="/library" className="font-semibold underline underline-offset-4">
            조건 지우기
          </Link>
        </p>
      ) : (
        <p className="type-body mt-8">
          라이브러리가 비었어요. 게임 화면에서 `라이브러리에 추가`를 눌러 보세요.{" "}
          <Link href="/search" className="font-semibold underline underline-offset-4">
            게임 검색하기
          </Link>
        </p>
      )}

      {moreHref ? (
        <p className="mt-8">
          <Link href={moreHref} className={buttonClasses({ variant: "secondary" })}>
            더 보기
          </Link>
        </p>
      ) : null}
    </>
  );
}

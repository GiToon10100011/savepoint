import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import { formatKoreanDate } from "@/lib/format-date";
import { formatStars, starsLabel } from "@/lib/rating";
import { appPool } from "@/server/db/client";
import { getViewer } from "@/server/viewer";
import { REVIEW_SORTS, REVIEW_SORT_LABELS, countPublicReviews, isReviewSort, listReviews, type ReviewListItem, type ReviewSort } from "../reviews";
import { LikeButton } from "./like-button";

const text = (value: string | string[] | undefined) => (typeof value === "string" ? value : undefined);

const BADGE = "inline-flex h-6 items-center border border-line-input px-2 text-xs font-normal text-fg";

/**
 * 게임 상세의 리뷰 목록. **공개 리뷰만** 나온다(내 비공개 리뷰는 `내 기록`에서 본다). 정렬(좋아요 순·최신순)과 `더 보기`는 주소에
 * 담겨 새로고침·공유에 안전하다. 세션과 목록은 요청 시점 데이터라 호출하는 쪽이 `<Suspense>`로 감싸야 한다(Cache Components).
 */
export async function ReviewSection({ gameId, slug, searchParams }: { gameId: string; slug: string; searchParams: PageProps<"/games/[slug]">["searchParams"] }) {
  const params = await searchParams;
  const sortParam = text(params.reviewSort);
  const sort: ReviewSort = isReviewSort(sortParam) ? sortParam : "likes";
  const cursor = text(params.reviewCursor);

  const viewer = await getViewer();
  const pool = appPool();
  const [page, total] = await Promise.all([
    listReviews(pool, viewer ? { authUserId: viewer.user.id, profileId: viewer.profile.id } : null, gameId, { sort, cursor }),
    countPublicReviews(pool, gameId),
  ]);

  /** 기본값은 주소에서 뺀다. 같은 화면 안의 `#reviews`로 돌아와 읽던 자리를 잃지 않는다. */
  const href = (target: { sort: ReviewSort; cursor?: string | null }) => {
    const query = new URLSearchParams();
    if (target.sort !== "likes") query.set("reviewSort", target.sort);
    if (target.cursor) query.set("reviewCursor", target.cursor);
    const qs = query.toString();
    return `/games/${slug}${qs ? `?${qs}` : ""}#reviews`;
  };
  const signInHref = `/auth/sign-in?redirectTo=${encodeURIComponent(`/games/${slug}`)}`;

  return (
    <section id="reviews" aria-labelledby="reviews-heading" className="mt-8">
      <h2 id="reviews-heading" className="type-h3">
        리뷰 <span className="type-mono text-muted">{total.toLocaleString("en-US")}</span>
      </h2>

      {total > 0 ? (
        <nav aria-label="리뷰 정렬" className="mt-3 flex flex-wrap gap-2">
          {REVIEW_SORTS.map((value) => (
            <Link
              key={value}
              href={href({ sort: value })}
              aria-current={sort === value ? "page" : undefined}
              className={buttonClasses({ variant: sort === value ? "primary" : "secondary", size: "sm" })}
            >
              {REVIEW_SORT_LABELS[value]}
            </Link>
          ))}
        </nav>
      ) : null}

      {page.items.length > 0 ? (
        <ul aria-label="리뷰 목록" className="mt-2 border-t border-line">
          {page.items.map((item) => (
            <ReviewCard key={item.id} item={item} signedIn={viewer !== null} signInHref={signInHref} />
          ))}
        </ul>
      ) : (
        <p className="type-body mt-3">{total > 0 ? "더 볼 리뷰가 없어요." : "아직 공개 리뷰가 없어요."}</p>
      )}

      {page.nextCursor ? (
        <p className="mt-6">
          <Link href={href({ sort, cursor: page.nextCursor })} className={buttonClasses({ variant: "secondary" })}>
            더 보기
          </Link>
        </p>
      ) : null}
    </section>
  );
}

function ReviewCard({ item, signedIn, signInHref }: { item: ReviewListItem; signedIn: boolean; signInHref: string }) {
  return (
    <li className="border-b border-line py-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-sm font-semibold">{item.author.nickname}</span>
        <span className="type-body-sm text-muted">@{item.author.handle}</span>
        {item.mine ? <span className={BADGE}>내 리뷰</span> : null}
        {item.authorStars !== null ? (
          <span className="type-mono">
            {/* 작성자가 이 게임에 남긴 별점(리뷰와 별개로 매긴 것). 시각 표시는 숫자만 읽히지 않게 읽는 문구를 따로 둔다. */}
            <span className="sr-only">작성자의 별점 {starsLabel(item.authorStars)}</span>
            <span aria-hidden="true">★ {formatStars(item.authorStars)}</span>
          </span>
        ) : null}
        <time dateTime={item.createdAt} className="type-body-sm text-muted">
          {formatKoreanDate(item.createdAt)}
        </time>
        {item.edited ? <span className="type-body-sm text-muted">수정됨</span> : null}
      </div>

      {item.hasSpoiler ? (
        <details className="mt-2 border border-line">
          <summary className="min-h-11 cursor-pointer px-3 py-3 text-sm">스포일러가 포함된 리뷰예요. 눌러서 보기</summary>
          <p className="type-body whitespace-pre-line border-t border-line px-3 py-2">{item.body}</p>
        </details>
      ) : (
        <p className="type-body mt-2 whitespace-pre-line">{item.body}</p>
      )}

      <div className="mt-3">
        {signedIn && !item.mine ? (
          // 서버가 아는 값이 바뀌면 다시 그린다(좋아요 버튼은 처음 받은 값을 상태로 쓴다).
          <LikeButton key={`${item.id}:${item.likedByMe}:${item.likeCount}`} reviewId={item.id} liked={item.likedByMe} count={item.likeCount} signInHref={signInHref} />
        ) : (
          <p className="type-body-sm text-muted">
            좋아요 <span className="type-mono">{item.likeCount}</span>
          </p>
        )}
      </div>
    </li>
  );
}

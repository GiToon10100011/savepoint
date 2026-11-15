import type { Pool } from "pg";
import { GameNotFoundError } from "@/features/ratings/ratings";
import { isRealTimestamp } from "@/lib/keyset";
import { storedToStars, type Stars } from "@/lib/rating";
import type { ReviewVisibility } from "@/lib/review";
import { runAsUser } from "@/server/db/with-user";
import type { ReviewInput } from "./review-form";

/** 리뷰를 쓰고 좋아요를 누르는 사용자. 세션의 인증 ID와 앱 프로필 ID가 모두 있어야 RLS를 통과한다. */
export type Reviewer = { authUserId: string; profileId: string };

export class ReviewNotFoundError extends Error {
  constructor() {
    super("review not found");
    this.name = "ReviewNotFoundError";
  }
}

export class OwnReviewError extends Error {
  constructor() {
    super("cannot like own review");
    this.name = "OwnReviewError";
  }
}

/** 내 리뷰. 비공개도 내 것은 읽을 수 있다. */
export type MyReview = {
  id: string;
  body: string;
  hasSpoiler: boolean;
  visibility: ReviewVisibility;
  likeCount: number;
};

type MyReviewRow = { id: string; body: string; has_spoiler: boolean; visibility: ReviewVisibility; like_count: number };
const MY_REVIEW_SELECT = "select id, body, has_spoiler, visibility, like_count from game_reviews";
const toMyReview = (row: MyReviewRow): MyReview => ({ id: row.id, body: row.body, hasSpoiler: row.has_spoiler, visibility: row.visibility, likeCount: row.like_count });

/** 내 리뷰. 쓰지 않았으면 null. 비공개 리뷰는 RLS가 작성자에게만 보여 주므로 세션 컨텍스트로 읽는다. */
export async function getMyReview(pool: Pool, user: Reviewer, gameId: string): Promise<MyReview | null> {
  return runAsUser(pool, user, async (_tx, client) => {
    const { rows } = await client.query<MyReviewRow>(`${MY_REVIEW_SELECT} where user_id = $1 and game_id = $2`, [user.profileId, gameId]);
    return rows[0] ? toMyReview(rows[0]) : null;
  });
}

/**
 * 리뷰를 쓰거나(없으면 만들고) 고친다. 사용자당 게임당 한 건이라 있으면 내용(본문·스포일러·공개 범위)을 바꾼다. 평가·라이브러리는 건드리지
 * 않는다. 값이 그대로면 UPDATE하지 않아 수정 시각이 바뀌지 않는다(저장을 한 번 더 눌러도 `수정됨`이 붙지 않는다).
 * 남의 리뷰는 RLS가 막는다: 사용자 ID는 항상 세션의 프로필 ID다. 없는 게임이면 GameNotFoundError.
 */
export async function saveReview(pool: Pool, user: Reviewer, gameId: string, input: ReviewInput): Promise<MyReview> {
  return runAsUser(pool, user, async (_tx, client) => {
    try {
      await client.query(
        `insert into game_reviews (user_id, game_id, body, has_spoiler, visibility) values ($1, $2, $3, $4, $5)
         on conflict (user_id, game_id) do update
           set body = excluded.body, has_spoiler = excluded.has_spoiler, visibility = excluded.visibility
           where (game_reviews.body, game_reviews.has_spoiler, game_reviews.visibility) is distinct from (excluded.body, excluded.has_spoiler, excluded.visibility)`,
        [user.profileId, gameId, input.body, input.hasSpoiler, input.visibility],
      );
    } catch (error) {
      // 23503: 없는 게임 ID(FK). 다른 오류는 그대로 올린다.
      if ((error as { code?: string }).code === "23503") throw new GameNotFoundError();
      throw error;
    }
    const { rows } = await client.query<MyReviewRow>(`${MY_REVIEW_SELECT} where user_id = $1 and game_id = $2`, [user.profileId, gameId]);
    return toMyReview(rows[0]);
  });
}

/** 내 리뷰를 지운다(좋아요도 함께 지워지고, 평가·라이브러리는 남는다). 지운 리뷰가 있었으면 true. */
export async function deleteReview(pool: Pool, user: Reviewer, gameId: string): Promise<boolean> {
  return runAsUser(pool, user, async (_tx, client) => {
    const { rowCount } = await client.query("delete from game_reviews where user_id = $1 and game_id = $2", [user.profileId, gameId]);
    return (rowCount ?? 0) > 0;
  });
}

/* ───────────────────────────── 목록 ───────────────────────────── */

export const REVIEW_PAGE_SIZE = 10;

/** 정렬 기준. 값은 URL에 담기므로 목록에 있는 것만 받는다. */
export const REVIEW_SORTS = ["likes", "recent"] as const;
export type ReviewSort = (typeof REVIEW_SORTS)[number];
export const REVIEW_SORT_LABELS: Record<ReviewSort, string> = { likes: "좋아요 순", recent: "최신순" };
export const isReviewSort = (value: unknown): value is ReviewSort => REVIEW_SORTS.includes(value as ReviewSort);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIKE_COUNT_KEY = /^\d{1,9}$/;

/**
 * 정렬마다 ORDER BY와 키셋 비교의 모양이다(이 파일의 상수만 SQL에 들어가고 값은 모두 매개변수다).
 * 좋아요 순은 같은 수끼리 최신순으로 가르고, 마지막에 id로 순서를 고정한다. 시각은 JS Date가 마이크로초를 잃으므로
 * PostgreSQL이 낸 텍스트로 주고받는다.
 */
const SORTS: Record<ReviewSort, { order: string; compare: string; casts: string[]; valid: (keys: string[]) => boolean }> = {
  likes: {
    order: "r.like_count desc, r.created_at desc, r.id desc",
    compare: "(r.like_count, r.created_at, r.id) < ",
    casts: ["int", "timestamptz", "uuid"],
    valid: ([likes, created, id]) => LIKE_COUNT_KEY.test(likes) && isRealTimestamp(created) && UUID.test(id),
  },
  recent: {
    order: "r.created_at desc, r.id desc",
    compare: "(r.created_at, r.id) < ",
    casts: ["timestamptz", "uuid"],
    valid: ([created, id]) => isRealTimestamp(created) && UUID.test(id),
  },
};

/** 키셋 커서: 마지막 항목의 정렬 키들(텍스트). 정렬마다 키의 개수와 형식이 달라 해석할 때 정렬을 함께 받는다. */
export function encodeReviewCursor(keys: string[]): string {
  return Buffer.from(JSON.stringify(keys)).toString("base64url");
}

/** 형식이 틀리거나 정렬과 맞지 않는 커서는 첫 페이지로 취급한다(오류로 끝내지 않는다). */
export function decodeReviewCursor(value: string | null | undefined, sort: ReviewSort): string[] | null {
  if (!value || value.length > 400) return null;
  try {
    const keys = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    const { casts, valid } = SORTS[sort];
    // 키는 쿼리에서 캐스트된다. 형식만 맞고 없는 값이면 DB가 거절해 목록이 오류로 끝나므로 여기서 거른다.
    if (!Array.isArray(keys) || keys.length !== casts.length || !keys.every((key) => typeof key === "string") || !valid(keys as string[])) return null;
    return keys as string[];
  } catch {
    return null;
  }
}

export type ReviewListItem = {
  id: string;
  body: string;
  hasSpoiler: boolean;
  likeCount: number;
  /** ISO 8601(UTC). 화면이 한국 날짜로 바꿔 보여 준다. */
  createdAt: string;
  /** 작성 뒤에 내용이 바뀌었다. */
  edited: boolean;
  author: { handle: string; nickname: string };
  /** 작성자가 같은 게임에 남긴 별점. 평가하지 않았으면 null(리뷰와 평가는 독립이다). */
  authorStars: Stars | null;
  likedByMe: boolean;
  mine: boolean;
};

export type ReviewPage = { items: ReviewListItem[]; nextCursor: string | null };

type ListRow = {
  id: string;
  body: string;
  has_spoiler: boolean;
  like_count: number;
  created_at: Date;
  created_text: string;
  edited: boolean;
  handle: string;
  nickname: string;
  rating: number | null;
  liked: boolean;
  mine: boolean;
};

export type ReviewQuery = { sort?: ReviewSort; cursor?: string | null; limit?: number };

/**
 * 한 게임의 **공개** 리뷰 목록. 비공개 리뷰는 목록에 나오지 않는다(내 비공개 리뷰는 `getMyReview`로 `내 기록`에서 본다).
 * 로그인하지 않은 방문자(`viewer`가 null)도 읽을 수 있고, 로그인했으면 내가 누른 좋아요와 내 리뷰 표시가 함께 온다.
 */
export async function listReviews(pool: Pool, viewer: Reviewer | null, gameId: string, query: ReviewQuery = {}): Promise<ReviewPage> {
  // URL에서 온 값이 타입을 우회해 들어와도 목록에 없는 정렬은 기본값으로 읽는다(SQL에 흘려보내지도, 오류로 끝내지도 않는다).
  const sortName: ReviewSort = isReviewSort(query.sort) ? query.sort : "likes";
  const sort = SORTS[sortName];
  const limit = Math.min(Math.max(query.limit ?? REVIEW_PAGE_SIZE, 1), 50);
  const params: unknown[] = [gameId, viewer?.profileId ?? null];
  const bind = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };

  const where = ["r.game_id = $1", "r.visibility = 'public'"];
  const cursor = decodeReviewCursor(query.cursor, sortName);
  if (cursor) where.push(`${sort.compare}(${cursor.map((key, i) => `${bind(key)}::${sort.casts[i]}`).join(", ")})`);

  const sql = `select r.id, r.body, r.has_spoiler, r.like_count, r.created_at, r.created_at::text as created_text,
                      (r.updated_at > r.created_at) as edited, p.handle, p.nickname, rt.rating,
                      exists (select 1 from game_review_likes l where l.review_id = r.id and l.user_id = $2::uuid) as liked,
                      coalesce(r.user_id = $2::uuid, false) as mine
               from game_reviews r
               join profiles p on p.id = r.user_id
               left join game_ratings rt on rt.user_id = r.user_id and rt.game_id = r.game_id
               where ${where.join(" and ")}
               order by ${sort.order}
               limit ${bind(limit + 1)}`;

  // 세션 컨텍스트 없이 읽는다: 공개 리뷰와 그 좋아요 행은 누구나 읽을 수 있고(RLS), 내가 눌렀는지·내 리뷰인지는 `$2`(내 프로필 id)로
  // 가려낸다. 방문자는 `$2`가 NULL이라 눌렀거나 내 것인 항목이 없다. 트랜잭션과 세션 설정 왕복이 필요 없다.
  const { rows } = await pool.query<ListRow>(sql, params);

  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    items: page.map((row) => ({
      id: row.id,
      body: row.body,
      hasSpoiler: row.has_spoiler,
      likeCount: row.like_count,
      createdAt: row.created_at.toISOString(),
      edited: row.edited,
      author: { handle: row.handle, nickname: row.nickname },
      authorStars: row.rating === null ? null : storedToStars(row.rating),
      likedByMe: row.liked,
      mine: row.mine,
    })),
    nextCursor: rows.length > limit && last ? encodeReviewCursor(sortName === "likes" ? [String(last.like_count), last.created_text, last.id] : [last.created_text, last.id]) : null,
  };
}

/** 한 게임의 공개 리뷰 수(비공개는 세지 않는다). */
export async function countPublicReviews(pool: Pool, gameId: string): Promise<number> {
  const { rows } = await pool.query<{ n: number }>("select count(*)::int as n from game_reviews where game_id = $1 and visibility = 'public'", [gameId]);
  return rows[0].n;
}

/* ───────────────────────────── 좋아요 ───────────────────────────── */

export type LikeState = { liked: boolean; likeCount: number };

/**
 * 좋아요를 누르거나(`liked = true`) 취소한다. 이미 누른 것을 또 눌러도, 누르지 않은 것을 취소해도 오류 없이 현재 상태를 돌려준다.
 * 카운터는 DB 트리거가 같은 문장 안에서 맞추므로 여기서 계산하지 않는다. 볼 수 없는 리뷰(없거나 남의 비공개)는 ReviewNotFoundError,
 * 자기 리뷰는 OwnReviewError다. RLS가 같은 규칙으로 한 번 더 막는다.
 */
export async function setReviewLike(pool: Pool, user: Reviewer, reviewId: string, liked: boolean): Promise<LikeState> {
  return runAsUser(pool, user, async (_tx, client) => {
    // RLS 덕에 이 조회는 내가 볼 수 있는 리뷰만 돌려준다(남의 비공개 리뷰는 없는 것과 같다).
    const target = await client.query<{ user_id: string }>("select user_id from game_reviews where id = $1", [reviewId]);
    if (!target.rows[0]) throw new ReviewNotFoundError();
    if (target.rows[0].user_id === user.profileId) throw new OwnReviewError();

    if (liked) {
      try {
        await client.query("insert into game_review_likes (review_id, user_id) values ($1, $2) on conflict do nothing", [reviewId, user.profileId]);
      } catch (error) {
        // 조회한 뒤 그 사이에 리뷰가 지워졌거나(23503) 비공개로 바뀌었다(42501, RLS).
        const code = (error as { code?: string }).code;
        if (code === "23503" || code === "42501") throw new ReviewNotFoundError();
        throw error;
      }
    } else {
      await client.query("delete from game_review_likes where review_id = $1 and user_id = $2", [reviewId, user.profileId]);
    }

    // 방금 한 일의 결과가 곧 내 상태다(누른 직후엔 눌렀고 취소한 직후엔 아니다). 수는 트리거가 맞춘 값을 읽는다.
    const { rows } = await client.query<{ like_count: number }>("select like_count from game_reviews where id = $1", [reviewId]);
    if (!rows[0]) throw new ReviewNotFoundError(); // 취소(delete)는 그 사이 지워진 리뷰여도 오류가 나지 않으므로 여기서 잡는다
    return { liked, likeCount: rows[0].like_count };
  });
}

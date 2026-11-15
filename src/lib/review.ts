/** 리뷰 공개 범위와 한도. 화면(클라이언트)과 서버가 함께 쓴다. DB의 `review_visibility`·본문 CHECK와 같은 값이다. */

export const REVIEW_VISIBILITIES = ["public", "private"] as const;
export type ReviewVisibility = (typeof REVIEW_VISIBILITIES)[number];

export const isReviewVisibility = (value: unknown): value is ReviewVisibility => value === "public" || value === "private";

export const REVIEW_VISIBILITY_LABELS: Record<ReviewVisibility, string> = {
  public: "공개",
  private: "비공개",
};

/** 본문 최대 글자 수(`game_reviews_body_length`). 이모지처럼 UTF-16 두 칸인 글자도 한 글자로 센다. */
export const MAX_REVIEW_LENGTH = 5000;

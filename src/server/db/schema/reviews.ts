import { boolean, integer, pgEnum, pgTable, primaryKey, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { games } from "./catalog";
import { profiles } from "./profiles";

/** 리뷰 공개 범위. 비공개는 작성자만 본다. */
export const reviewVisibility = pgEnum("review_visibility", ["public", "private"]);

/**
 * 게임 리뷰([데이터 모델 §4.3](../../../../docs/architecture/data-model.md)). 사용자당 게임당 한 건이다(UNIQUE).
 * 본문 길이 CHECK, RLS, 컬럼 권한, 인덱스, 좋아요 카운터 트리거는 `drizzle/0005_reviews.sql`에 있고,
 * 여기는 타입이 있는 쿼리를 위한 정의다. 평가·라이브러리와 FK로 묶지 않는다(서로 독립).
 */
export const gameReviews = pgTable(
  "game_reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
    gameId: uuid("game_id").notNull().references(() => games.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    hasSpoiler: boolean("has_spoiler").notNull().default(false),
    visibility: reviewVisibility("visibility").notNull().default("public"),
    /** 좋아요 수. 트리거가 유지하며 앱 역할은 직접 쓰지 못한다. */
    likeCount: integer("like_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("game_reviews_user_game_unique").on(t.userId, t.gameId)],
);

/** 리뷰 좋아요. 사용자당 리뷰당 한 번이다(PK). 자기 리뷰에는 누를 수 없다(RLS). */
export const gameReviewLikes = pgTable(
  "game_review_likes",
  {
    reviewId: uuid("review_id").notNull().references(() => gameReviews.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ name: "game_review_likes_pkey", columns: [t.reviewId, t.userId] })],
);

export type GameReview = typeof gameReviews.$inferSelect;

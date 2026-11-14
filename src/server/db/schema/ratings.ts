import { pgTable, primaryKey, smallint, timestamp, uuid } from "drizzle-orm/pg-core";
import { games } from "./catalog";
import { profiles } from "./profiles";

/**
 * 게임 평가([데이터 모델 §4.3](../../../../docs/architecture/data-model.md)). 사용자당 게임당 한 건이다(PK).
 * 별점 × 2를 1–10 정수로 저장한다(`lib/rating.ts`). 값 범위 CHECK, RLS, 컬럼 권한, 인덱스, 카운터 트리거는
 * `drizzle/0003_game_ratings.sql`에 있고, 여기는 타입이 있는 쿼리를 위한 정의다.
 * 평가는 라이브러리·리뷰와 FK로 묶지 않는다(서로 독립).
 */
export const gameRatings = pgTable(
  "game_ratings",
  {
    userId: uuid("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
    gameId: uuid("game_id").notNull().references(() => games.id, { onDelete: "cascade" }),
    rating: smallint("rating").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.gameId] })],
);

export type GameRating = typeof gameRatings.$inferSelect;

import { date, integer, pgEnum, pgTable, smallint, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { games, platforms } from "./catalog";
import { profiles } from "./profiles";

/** 플레이 상태 7가지(`lib/play-status.ts`와 같은 값). 상태를 지정하지 않은 등록은 컬럼이 NULL이다. */
export const playStatus = pgEnum("play_status", ["interested", "planned", "playing", "paused", "cleared", "perfected", "dropped"]);

/** 진행도 표시 방식. 지금은 `percent`만 쓰고 퍼센트·텍스트를 함께 저장한다. 챕터·체크리스트는 확장 여지다. */
export const progressKind = pgEnum("progress_kind", ["percent", "text"]);

/**
 * 라이브러리: 사용자가 등록한 게임과 진행 상황([데이터 모델 §4.3](../../../../docs/architecture/data-model.md)).
 * 값 범위 CHECK, RLS, 컬럼 권한, 인덱스, `last_played_on` 트리거는 `drizzle/0004_library.sql`에 있고,
 * 여기는 타입이 있는 쿼리를 위한 정의다. 평가·리뷰와는 FK로 묶지 않는다(서로 독립이라 라이브러리에서 지워도 평가는 남는다).
 * 날짜는 사용자가 정한 달력 날짜라 시각이 아니라 `YYYY-MM-DD` 문자열로 다룬다.
 */
export const userGames = pgTable(
  "user_games",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
    gameId: uuid("game_id").notNull().references(() => games.id, { onDelete: "cascade" }),
    status: playStatus("status"),
    platformId: integer("platform_id").references(() => platforms.id, { onDelete: "set null" }),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
    startedOn: date("started_on", { mode: "string" }),
    clearedOn: date("cleared_on", { mode: "string" }),
    perfectedOn: date("perfected_on", { mode: "string" }),
    lastPlayedOn: date("last_played_on", { mode: "string" }),
    playtimeMinutes: integer("playtime_minutes"),
    progressKind: progressKind("progress_kind").notNull().default("percent"),
    progressPercent: smallint("progress_percent"),
    progressText: text("progress_text"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("user_games_user_game_unique").on(t.userId, t.gameId)],
);

/** 개인 메모. 소유자에게만 보인다(RLS). 비우면 행을 지운다. */
export const userGameNotes = pgTable("user_game_notes", {
  userGameId: uuid("user_game_id").primaryKey().references(() => userGames.id, { onDelete: "cascade" }),
  note: text("note").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type UserGame = typeof userGames.$inferSelect;

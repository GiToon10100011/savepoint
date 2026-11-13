import {
  date,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { profiles } from "./profiles";

/**
 * 게임 메타데이터([데이터 모델 §4.2](../../../../docs/architecture/data-model.md)). 길이·형식 CHECK, RLS, 컬럼 권한,
 * 인덱스, 시드는 `drizzle/0001_games.sql`에 있고, 여기는 타입이 있는 쿼리를 위한 정의다.
 */
export const gameSource = pgEnum("game_source", ["igdb", "manual"]);

export const platforms = pgTable("platforms", {
  // integer: ON CONFLICT DO NOTHING도 식별 값을 소모해 smallint는 32,767에서 막힌다(0002_platform_id_integer).
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  igdbId: integer("igdb_id").unique(),
});

export const genres = pgTable("genres", {
  id: smallint("id").primaryKey().generatedByDefaultAsIdentity(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
});

export const tags = pgTable("tags", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  source: gameSource("source").notNull(),
});

/** 게임과 별도 테이블. 개발사·퍼블리셔는 `gameDevelopers`·`gamePublishers`가 구분한다. */
export const gameCompanies = pgTable("game_companies", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  nameKo: text("name_ko"),
  igdbId: integer("igdb_id").unique(),
  /** ISO 3166-1 alpha-2(예: `JP`). 모르면 비운다. */
  country: text("country"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const games = pgTable("games", {
  id: uuid("id").primaryKey().defaultRandom(),
  source: gameSource("source").notNull(),
  /** IGDB 게임 ID(문자열). 수동 등록 게임은 없다. */
  externalId: text("external_id"),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  titleKo: text("title_ko"),
  summary: text("summary"),
  releaseDate: date("release_date", { mode: "string" }),
  coverUrl: text("cover_url"),
  coverWidth: integer("cover_width"),
  coverHeight: integer("cover_height"),
  createdBy: uuid("created_by").references(() => profiles.id, { onDelete: "set null" }),
  /** 평가 카운터. 평가 트리거가 유지한다(점수는 1–10 정수, 평균 = sum / count / 2). */
  ratingCount: integer("rating_count").notNull().default(0),
  ratingSum: integer("rating_sum").notNull().default(0),
  metadataSyncedAt: timestamp("metadata_synced_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const gameGenres = pgTable(
  "game_genres",
  {
    gameId: uuid("game_id").notNull().references(() => games.id, { onDelete: "cascade" }),
    genreId: smallint("genre_id").notNull().references(() => genres.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.gameId, t.genreId] })],
);

export const gameTags = pgTable(
  "game_tags",
  {
    gameId: uuid("game_id").notNull().references(() => games.id, { onDelete: "cascade" }),
    tagId: integer("tag_id").notNull().references(() => tags.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.gameId, t.tagId] })],
);

export const gamePlatforms = pgTable(
  "game_platforms",
  {
    gameId: uuid("game_id").notNull().references(() => games.id, { onDelete: "cascade" }),
    platformId: integer("platform_id").notNull().references(() => platforms.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.gameId, t.platformId] })],
);

export const gameDevelopers = pgTable(
  "game_developers",
  {
    gameId: uuid("game_id").notNull().references(() => games.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").notNull().references(() => gameCompanies.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.gameId, t.companyId] })],
);

export const gamePublishers = pgTable(
  "game_publishers",
  {
    gameId: uuid("game_id").notNull().references(() => games.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").notNull().references(() => gameCompanies.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.gameId, t.companyId] })],
);

export type Game = typeof games.$inferSelect;
export type GameCompany = typeof gameCompanies.$inferSelect;

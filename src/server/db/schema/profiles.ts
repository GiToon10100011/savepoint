import { customType, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// 대소문자를 구분하지 않고 비교하는 문자열(핸들의 `Foo`와 `foo`를 같은 값으로 본다). 확장은 마이그레이션이 만든다.
const citext = customType<{ data: string }>({ dataType: () => "citext" });

/**
 * Neon Auth 사용자와 1:1인 앱 프로필([데이터 모델 §4.1](../../../../docs/architecture/data-model.md)).
 * 길이·형식 제약(CHECK)과 RLS는 마이그레이션 SQL에 있고, 여기는 타입이 있는 쿼리를 위한 정의다.
 */
export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Neon Auth 사용자 ID. 타입이 달라질 수 있어 uuid PK와 분리하고 FK도 걸지 않는다.
  authUserId: text("auth_user_id").notNull().unique(),
  handle: citext("handle").notNull().unique(),
  nickname: text("nickname").notNull(),
  bio: text("bio"),
  avatarUrl: text("avatar_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Profile = typeof profiles.$inferSelect;

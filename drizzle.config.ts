import { defineConfig } from "drizzle-kit";

// 마이그레이션은 손으로 쓴 SQL이 원본이다(RLS 정책·트리거·GRANT는 스키마 비교로 만들 수 없다).
// 새 마이그레이션은 항상 `npx drizzle-kit generate --custom --name=<이름>`으로 빈 파일을 만들어 채운다.
// `src/server/db/schema`의 TypeScript 정의는 타입이 있는 쿼리용이며, DB 테스트가 실제 컬럼과 일치하는지 검사한다.
// 적용은 `npm run db:migrate -- <env 파일>`(소유자 직접 연결, 앱 런타임에서는 쓰지 않는다).
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schema",
  out: "./drizzle",
});

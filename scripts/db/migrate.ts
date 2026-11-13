/**
 * drizzle/ 아래 마이그레이션을 소유자 연결로 적용한다. 앱 런타임 역할(app_user)은 스키마를 바꿀 수 없다.
 *
 *   npm run db:migrate -- .env.local        # dev 브랜치
 *   npm run db:migrate -- .env.test.local   # test 브랜치
 *
 * 여러 번 실행해도 안전하다(이미 적용한 마이그레이션은 건너뛴다). 대상 호스트와 DB 이름만 출력한다.
 */
import { readFileSync } from "node:fs";
import { parse } from "dotenv";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";
import { withVerifyFull } from "../../src/server/db/connection";

async function main() {
  const envFile = process.argv[2];
  if (!envFile) throw new Error("사용법: npm run db:migrate -- <env 파일>");

  const rawUrl = parse(readFileSync(envFile))["DATABASE_URL_ADMIN"];
  if (!rawUrl) throw new Error(`${envFile}에 DATABASE_URL_ADMIN(소유자 직접 연결 URL)이 없다`);

  const url = withVerifyFull(rawUrl);
  const target = new URL(url);
  console.log(`migrate -> ${target.hostname}${target.pathname}`);

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await migrate(drizzle(client), { migrationsFolder: "drizzle" });
    console.log("migrations: ok");
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

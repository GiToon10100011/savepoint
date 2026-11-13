/**
 * 개발용 샘플 게임을 IGDB에서 가져와 카탈로그에 넣는다(데이터 모델 §8). 운영·테스트 브랜치가 아니라 개발 브랜치용이다.
 *
 *   npm run db:seed -- .env.local
 *
 * 게임 ID를 적어 두지 않고 제목으로 검색해 **제목이 정확히 같은** 결과만 가져온다(ID를 잘못 적어 엉뚱한 게임이
 * 들어가는 것을 막는다). 여러 번 실행해도 안전하다(이미 있으면 메타데이터만 갱신한다). 키는 출력하지 않는다.
 */
import { readFileSync } from "node:fs";
import { parse } from "dotenv";
import { Pool } from "pg";
import { importIgdbGame } from "../../src/features/games/import-igdb";
import { withVerifyFull } from "../../src/server/db/connection";
import { createIgdbClient } from "../../src/server/igdb/client";
import { createGameSource } from "../../src/server/igdb/source";

const TITLES = [
  "Elden Ring", "Hades", "Celeste", "Stardew Valley", "Hollow Knight", "Persona 5 Royal", "Dark Souls III",
  "Baldur's Gate III", "Disco Elysium", "Undertale", "Portal 2", "The Witcher 3: Wild Hunt", "Red Dead Redemption 2",
  "God of War", "Super Mario Odyssey", "Animal Crossing: New Horizons", "Bloodborne", "Sekiro: Shadows Die Twice",
  "The Legend of Zelda: Breath of the Wild", "Monster Hunter: World", "Tetris Effect: Connected", "Slay the Spire",
];

async function main() {
  const envFile = process.argv[2];
  if (!envFile) throw new Error("사용법: npm run db:seed -- <env 파일>");
  const env = parse(readFileSync(envFile));
  for (const key of ["TWITCH_CLIENT_ID", "TWITCH_CLIENT_SECRET", "DATABASE_URL_CATALOG"]) {
    if (!env[key]) throw new Error(`${envFile}에 ${key}가 없다`);
  }

  const source = createGameSource(createIgdbClient({ clientId: env.TWITCH_CLIENT_ID.trim(), clientSecret: env.TWITCH_CLIENT_SECRET.trim() }));
  const pool = new Pool({ connectionString: withVerifyFull(env.DATABASE_URL_CATALOG), max: 2 });
  const target = new URL(env.DATABASE_URL_CATALOG);
  console.log(`seed -> ${target.hostname}${target.pathname} (${TITLES.length}개 제목)`);

  let created = 0;
  let updated = 0;
  const missing: string[] = [];
  try {
    for (const title of TITLES) {
      const found = (await source.search(title, { limit: 10 })).find((d) => d.title.toLowerCase() === title.toLowerCase());
      if (!found) {
        missing.push(title);
        continue;
      }
      const result = await importIgdbGame(pool, found);
      if (result.created) created += 1;
      else updated += 1;
      console.log(`  ${result.created ? "+" : "="} ${found.titleKo ?? found.title} (${result.slug})`);
    }
  } finally {
    await pool.end();
  }
  console.log(`완료: 새로 ${created}개, 갱신 ${updated}개${missing.length ? `, 못 찾음 ${missing.length}개(${missing.join(", ")})` : ""}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

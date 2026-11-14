import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { parse } from "dotenv";
import { Client } from "pg";
import { withVerifyFull } from "../../../src/server/db/connection";

// E2E가 직접 만드는 카탈로그 데이터. 이 접두어의 행만 정리한다.
const PREFIX = "e2e-fx-";

type Named = { slug: string; name: string };
export type GameFixture = {
  title: string;
  slug: string;
  tag: Named;
  /** 개발만 한 회사 */
  developer: Named;
  /** 퍼블리싱만 한 회사 */
  publisher: Named;
  /** 개발과 퍼블리싱을 모두 한 회사 */
  both: Named;
};

// 워커(프로세스)마다 자기가 만든 것만 기억해, 모바일·데스크톱 워커가 서로의 진행 중인 데이터를 지우지 않게 한다.
const tokens: string[] = [];
const importedIgdbIds: string[] = [];

/**
 * 시험이 처음 평가하면서 서비스에 가져온 IGDB 게임을 정리 대상으로 기억한다. 남겨 두면 다음 실행에서 "아직 가져오지 않은
 * 후보"가 점점 줄어든다. 가져오기는 시험 사용자의 평가 하나가 전부이므로 평가가 1개 이하일 때만 지운다.
 */
export function trackImportedIgdbGame(igdbId: number) {
  importedIgdbIds.push(String(igdbId));
}

async function withAdmin<T>(run: (client: Client) => Promise<T>): Promise<T> {
  const adminUrl = parse(readFileSync(".env.local"))["DATABASE_URL_ADMIN"];
  if (!adminUrl) throw new Error(".env.local에 DATABASE_URL_ADMIN이 없다");
  const client = new Client({ connectionString: withVerifyFull(adminUrl) });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

/**
 * 게임 하나와 그것에 붙은 태그·회사를 한 트랜잭션으로 만든다(다른 워커의 정리가 중간 상태를 보지 않게).
 * 장르는 새로 만들지 않고 시드된 `rpg`에 연결한다: 장르 ID는 smallint 식별 컬럼이라 시험마다 만들면 소진된다.
 * 평점 카운터를 주면 평균·평가 수 표시를 시험할 수 있다(CHECK: 개수 ≤ 합 ≤ 개수 × 10).
 */
export async function createGameFixture({ ratingCount = 0, ratingSum = 0 }: { ratingCount?: number; ratingSum?: number } = {}): Promise<GameFixture> {
  const token = randomUUID().slice(0, 8); // 소문자 16진수라 슬러그에 그대로 들어간다
  tokens.push(token);
  const named = (kind: string): Named => ({ slug: `${PREFIX}${token}-${kind}`, name: `Fixture ${kind} ${token}` });
  const fixture: GameFixture = {
    title: `Fixture Game ${token}`,
    slug: `${PREFIX}${token}-game`,
    tag: named("tag"),
    developer: named("dev"),
    publisher: named("pub"),
    both: named("both"),
  };
  await withAdmin(async (client) => {
    await client.query("begin");
    try {
      const game = await client.query<{ id: string }>(
        "insert into games (source, slug, title, rating_count, rating_sum) values ('manual', $1, $2, $3, $4) returning id",
        [fixture.slug, fixture.title, ratingCount, ratingSum],
      );
      const gameId = game.rows[0].id;
      const tag = await client.query<{ id: number }>("insert into tags (slug, name, source) values ($1, $2, 'manual') returning id", [fixture.tag.slug, fixture.tag.name]);
      const companyIds: Record<string, string> = {};
      for (const company of [fixture.developer, fixture.publisher, fixture.both]) {
        const row = await client.query<{ id: string }>("insert into game_companies (slug, name) values ($1, $2) returning id", [company.slug, company.name]);
        companyIds[company.slug] = row.rows[0].id;
      }
      await client.query("insert into game_genres (game_id, genre_id) select $1, id from genres where slug = 'rpg'", [gameId]);
      await client.query("insert into game_tags (game_id, tag_id) values ($1, $2)", [gameId, tag.rows[0].id]);
      for (const company of [fixture.developer, fixture.both]) {
        await client.query("insert into game_developers (game_id, company_id) values ($1, $2)", [gameId, companyIds[company.slug]]);
      }
      for (const company of [fixture.publisher, fixture.both]) {
        await client.query("insert into game_publishers (game_id, company_id) values ($1, $2)", [gameId, companyIds[company.slug]]);
      }
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  });
  return fixture;
}

/** 한 태그에 게임을 `count`개 붙여 만든다(한 페이지를 넘는 목록의 `더 보기`를 시험하려고). 제목은 만든 순서대로 번호가 붙는다. */
export async function createTaggedGames(count: number): Promise<{ tag: Named; titles: string[] }> {
  const token = randomUUID().slice(0, 8);
  tokens.push(token);
  const tag = { slug: `${PREFIX}${token}-tag`, name: `Fixture tag ${token}` };
  const titles = Array.from({ length: count }, (_, i) => `Fixture Tagged ${token} ${String(i).padStart(2, "0")}`);
  await withAdmin(async (client) => {
    await client.query("begin");
    try {
      const row = await client.query<{ id: number }>("insert into tags (slug, name, source) values ($1, $2, 'manual') returning id", [tag.slug, tag.name]);
      // 평가 수를 모두 달리해 정렬이 정해진 순서(번호가 작을수록 위)가 되게 한다.
      const games = await client.query<{ id: string }>(
        `insert into games (source, slug, title, rating_count, rating_sum)
         select 'manual', $1::text || '-g' || (t.n - 1), t.title, $3::int - (t.n - 1)::int, ($3::int - (t.n - 1)::int) * 6
         from unnest($2::text[]) with ordinality as t(title, n)
         returning id`,
        [`${PREFIX}${token}`, titles, count],
      );
      for (const game of games.rows) await client.query("insert into game_tags (game_id, tag_id) values ($1, $2)", [game.id, row.rows[0].id]);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  });
  return { tag, titles };
}

/** 이 워커가 만든 데이터와, 비정상 종료로 남은 한 시간 넘은 데이터를 지운다. */
export async function cleanupCatalogFixtures() {
  try {
    await withAdmin(async (client) => {
      const patterns = tokens.map((token) => `${PREFIX}${token}-%`);
      // 게임을 지우면 태그·회사 연결은 함께 지워진다. 그 뒤 더 이상 어디에도 붙지 않은 시험용 태그·회사만 지운다.
      await client.query("delete from games where slug like any($1) or (slug like $2 and created_at < now() - interval '1 hour')", [patterns, `${PREFIX}%`]);
      await client.query("delete from games where source = 'igdb' and external_id = any($1) and rating_count <= 1", [importedIgdbIds]);
      await client.query(
        `delete from tags t where t.slug like $1 and not exists (select 1 from game_tags l where l.tag_id = t.id)`,
        [`${PREFIX}%`],
      );
      await client.query(
        `delete from game_companies c where c.slug like $1 and c.igdb_id is null
         and not exists (select 1 from game_developers d where d.company_id = c.id)
         and not exists (select 1 from game_publishers p where p.company_id = c.id)`,
        [`${PREFIX}%`],
      );
    });
  } catch (error) {
    // 정리가 실패해도 시험 결과를 가리지 않는다. 남은 행은 다음 실행의 정리가 지운다.
    console.warn("카탈로그 시험 데이터 정리에 실패했다:", error instanceof Error ? error.message : error);
  }
}

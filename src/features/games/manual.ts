import type { Pool, PoolClient } from "pg";
import { runAsUser } from "@/server/db/with-user";
import { slugCandidate, withSuffix } from "./slug";

export type ManualGameInput = {
  title: string;
  titleKo: string | null;
  summary: string | null;
  /** `YYYY-MM-DD` */
  releaseDate: string | null;
  platformSlugs: string[];
  genreSlugs: string[];
  tagSlugs: string[];
  /** 회사 이름. 이미 있는 회사면 새로 만들지 않고 그것을 쓴다. */
  developers: string[];
  publishers: string[];
};

/** 한 사용자가 한 시간에 수동으로 등록할 수 있는 게임 수. 아무나 등록할 수 있어 카탈로그가 쓰레기로 차는 것을 막는다. */
export const MANUAL_GAMES_PER_HOUR = 10;

export class RateLimitError extends Error {
  constructor() {
    super(`수동 등록은 한 시간에 ${MANUAL_GAMES_PER_HOUR}건까지 할 수 있다`);
    this.name = "RateLimitError";
  }
}

export type CreatedGame = { id: string; slug: string };

/** 이미 쓰이지 않는 슬러그를 고른다. 겹치면 무작위 접미사를 붙여 몇 번 더 시도한다. */
async function freeSlug(client: PoolClient, table: "games" | "game_companies", candidate: string): Promise<string> {
  let slug = candidate;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { rowCount } = await client.query(`select 1 from ${table} where slug = $1`, [slug]);
    if (!rowCount) return slug;
    slug = withSuffix(candidate);
  }
  return slug;
}

/** 이름(한국어 이름 포함)이 같은 회사가 있으면 그것을, 없으면 IGDB와 무관한 새 회사를 만든다. */
async function findOrCreateCompany(client: PoolClient, name: string): Promise<string> {
  const found = await client.query<{ id: string }>("select id from game_companies where lower(name) = lower($1) or lower(name_ko) = lower($1) limit 1", [name]);
  if (found.rows[0]) return found.rows[0].id;
  const slug = await freeSlug(client, "game_companies", slugCandidate(name, "company"));
  const created = await client.query<{ id: string }>("insert into game_companies (slug, name) values ($1, $2) returning id", [slug, name]);
  return created.rows[0].id;
}

const unique = (names: string[]) => [...new Map(names.map((n) => [n.toLowerCase(), n])).values()];

/**
 * 로그인한 사용자가 게임을 직접 등록한다(기능 B3). `app_user` 권한으로 한 트랜잭션 안에서 실행하며, RLS가
 * `source = 'manual'`이고 `created_by`가 본인인 행만 허용한다. 중간에 실패하면 전부 되돌린다.
 * 커버는 받지 않는다(업로드 저장소가 생기기 전에는 외부 이미지 주소를 허용하지 않는다).
 */
export async function createManualGame(
  pool: Pool,
  user: { authUserId: string; profileId: string },
  input: ManualGameInput,
): Promise<CreatedGame> {
  return runAsUser(pool, user, async (_tx, client) => {
    // 같은 사용자의 동시 등록이 한도 확인을 함께 통과하지 못하게 사용자별로 줄 세운다. READ COMMITTED에서는 서로의
    // 아직 커밋되지 않은 INSERT가 보이지 않아, 잠금 없이 세면 여러 요청이 모두 한도 아래로 보고 통과한다(확인-후-삽입 경쟁).
    // 트랜잭션 단위 잠금이라 커밋·롤백 때 풀리고, 트랜잭션 모드 풀링에서도 안전하다.
    await client.query("select pg_advisory_xact_lock(hashtext('manual_game'), hashtext($1))", [user.profileId]);
    const recent = await client.query<{ n: number }>(
      "select count(*)::int as n from games where created_by = $1 and created_at > now() - interval '1 hour'",
      [user.profileId],
    );
    if (recent.rows[0].n >= MANUAL_GAMES_PER_HOUR) throw new RateLimitError();

    const slug = await freeSlug(client, "games", slugCandidate(input.title));
    const { rows } = await client.query<CreatedGame>(
      `insert into games (source, slug, title, title_ko, summary, release_date, created_by)
       values ('manual', $1, $2, $3, $4, $5, $6) returning id, slug`,
      [slug, input.title, input.titleKo, input.summary, input.releaseDate, user.profileId],
    );
    const game = rows[0];

    const links: [string, string, string, string[]][] = [
      ["game_genres", "genre_id", "genres", input.genreSlugs],
      ["game_tags", "tag_id", "tags", input.tagSlugs],
      ["game_platforms", "platform_id", "platforms", input.platformSlugs],
    ];
    for (const [table, column, source, slugs] of links) {
      if (slugs.length === 0) continue;
      // 목록에 없는 슬러그는 무시한다(분류는 시드된 것만 고를 수 있다).
      await client.query(`insert into ${table} (game_id, ${column}) select $1, id from ${source} where slug = any($2)`, [game.id, slugs]);
    }

    for (const [table, names] of [["game_developers", input.developers], ["game_publishers", input.publishers]] as const) {
      const ids = new Set<string>();
      for (const name of unique(names)) ids.add(await findOrCreateCompany(client, name));
      if (ids.size > 0) await client.query(`insert into ${table} (game_id, company_id) select $1, unnest($2::uuid[])`, [game.id, [...ids]]);
    }
    return game;
  });
}

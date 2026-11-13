import type { Pool, PoolClient } from "pg";
import type { GameDraft } from "@/server/igdb/mapper";

export type ImportedGame = {
  id: string;
  slug: string;
  /** 이번 호출이 새로 만들었으면 true, 이미 있던 게임을 갱신했으면 false */
  created: boolean;
};

/**
 * 슬러그가 이미 다른 행에서 쓰이면 IGDB ID를 붙여 피한다(예: 같은 이름으로 수동 등록된 게임).
 * 같은 IGDB 항목 자신이 쓰는 슬러그는 충돌이 아니다(다시 가져오는 경우).
 */
async function freeSlug(client: PoolClient, table: "games" | "game_companies", slug: string, igdbId: number): Promise<string> {
  const ownerColumn = table === "games" ? "external_id" : "igdb_id";
  const owner = table === "games" ? String(igdbId) : igdbId;
  const { rowCount } = await client.query(`select 1 from ${table} where slug = $1 and ${ownerColumn} is distinct from $2`, [slug, owner]);
  return rowCount ? `${slug}-igdb-${igdbId}` : slug;
}

/** 연결 테이블을 새 값으로 통째로 바꾼다(다시 가져올 때 사라진 장르·플랫폼이 남지 않게). */
async function replaceLinks(client: PoolClient, table: string, column: string, gameId: string, ids: (number | string)[]) {
  await client.query(`delete from ${table} where game_id = $1`, [gameId]);
  if (ids.length === 0) return;
  const arrayType = typeof ids[0] === "string" ? "uuid" : "int";
  await client.query(`insert into ${table} (game_id, ${column}) select $1, unnest($2::${arrayType}[])`, [gameId, ids]);
}

/**
 * IGDB에서 가져온 게임을 카탈로그에 넣는다. `catalog_writer` 풀로 한 트랜잭션 안에서 실행하며, 같은 게임을 여러 번
 * (동시에도) 가져와도 한 행만 남고 메타데이터와 연결은 최신 값으로 맞춰진다(`UNIQUE (source, external_id)`로 멱등).
 * 중간에 실패하면 전부 되돌린다.
 *
 * 호출하는 쪽의 책임: 로그인한 사용자의 첫 쓰기 동작에서만 부르고, **클라이언트가 보낸 메타데이터가 아니라
 * IGDB ID로 서버가 직접 조회한 `draft`만** 넘긴다(아키텍처 §4.3).
 */
export async function importIgdbGame(catalogPool: Pool, draft: GameDraft): Promise<ImportedGame> {
  const client = await catalogPool.connect();
  let discard = false;
  try {
    await client.query("begin");

    const slug = await freeSlug(client, "games", draft.slug, draft.igdbId);
    const { rows } = await client.query<{ id: string; slug: string; created: boolean }>(
      `insert into games (source, external_id, slug, title, title_ko, summary, release_date, cover_url, cover_width, cover_height, metadata_synced_at)
       values ('igdb', $1, $2, $3, $4, $5, $6, $7, $8, $9, now())
       on conflict (source, external_id) where external_id is not null do update set
         title = excluded.title, title_ko = excluded.title_ko, summary = excluded.summary, release_date = excluded.release_date,
         cover_url = excluded.cover_url, cover_width = excluded.cover_width, cover_height = excluded.cover_height,
         metadata_synced_at = now()
       returning id, slug, (xmax = 0) as created`,
      [
        String(draft.igdbId), slug, draft.title, draft.titleKo, draft.summary, draft.releaseDate,
        draft.cover?.url ?? null, draft.cover?.width ?? null, draft.cover?.height ?? null,
      ],
    );
    const game = rows[0];

    // 회사: IGDB ID로 합치고, 개발사와 퍼블리셔는 각자의 연결 테이블에 넣는다.
    const companyIds = new Map<number, string>();
    for (const company of [...draft.developers, ...draft.publishers]) {
      if (companyIds.has(company.igdbId)) continue;
      const companySlug = await freeSlug(client, "game_companies", company.slug, company.igdbId);
      const saved = await client.query<{ id: string }>(
        `insert into game_companies (slug, name, igdb_id, country) values ($1, $2, $3, $4)
         on conflict (igdb_id) do update set name = excluded.name, country = excluded.country
         returning id`,
        [companySlug, company.name, company.igdbId, company.country],
      );
      companyIds.set(company.igdbId, saved.rows[0].id);
    }

    // 플랫폼: 시드에 없는 것만 IGDB 정보로 추가한다. 이미 있는 것은 INSERT를 시도하지 않는다 — `ON CONFLICT DO NOTHING`도
    // 충돌하기 전에 식별 컬럼의 기본값(nextval)을 평가해 값을 소모하기 때문이다(게임마다 반복하면 시퀀스가 계속 간다).
    // 동시에 같은 새 플랫폼을 넣는 경우를 위해 `ON CONFLICT DO NOTHING`은 남기고, 슬러그가 겹쳐 건너뛴 것은 연결하지 않는다.
    const known = await client.query<{ igdb_id: number }>("select igdb_id from platforms where igdb_id = any($1)", [
      draft.platforms.map((p) => p.igdbId),
    ]);
    const knownIds = new Set(known.rows.map((r) => r.igdb_id));
    for (const platform of draft.platforms.filter((p) => !knownIds.has(p.igdbId))) {
      await client.query("insert into platforms (slug, name, igdb_id) values ($1, $2, $3) on conflict do nothing", [
        platform.slug, platform.name, platform.igdbId,
      ]);
    }
    const platformRows = await client.query<{ id: number }>("select id from platforms where igdb_id = any($1)", [
      draft.platforms.map((p) => p.igdbId),
    ]);

    // 분류는 마이그레이션이 시드한 목록에서 슬러그로 찾는다(없는 슬러그는 무시한다).
    const genreRows = await client.query<{ id: number }>("select id from genres where slug = any($1)", [draft.genreSlugs]);
    const tagRows = await client.query<{ id: number }>("select id from tags where slug = any($1)", [draft.tagSlugs]);

    await replaceLinks(client, "game_genres", "genre_id", game.id, genreRows.rows.map((r) => r.id));
    await replaceLinks(client, "game_tags", "tag_id", game.id, tagRows.rows.map((r) => r.id));
    await replaceLinks(client, "game_platforms", "platform_id", game.id, platformRows.rows.map((r) => r.id));
    await replaceLinks(client, "game_developers", "company_id", game.id, draft.developers.map((c) => companyIds.get(c.igdbId) as string));
    await replaceLinks(client, "game_publishers", "company_id", game.id, draft.publishers.map((c) => companyIds.get(c.igdbId) as string));

    await client.query("commit");
    return { id: game.id, slug: game.slug, created: game.created };
  } catch (error) {
    // 되돌리기까지 실패하면 연결 상태를 알 수 없으므로 풀로 돌려보내지 않고 폐기한다.
    await client.query("rollback").catch(() => {
      discard = true;
    });
    throw error;
  } finally {
    client.release(discard);
  }
}

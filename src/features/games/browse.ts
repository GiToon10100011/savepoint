import type { Pool } from "pg";
import { COLUMNS, PAGE_SIZE, decodeCursor, encodeCursor, toHit, type Page, type Row } from "./search";

type Options = { cursor?: string | null; limit?: number };

/** 장르·태그. `gameCount`는 연결된 게임 수다. */
export type Facet = { slug: string; name: string; gameCount: number };

export type Company = {
  slug: string;
  name: string;
  nameKo: string | null;
  /** ISO 3166-1 alpha-2. 모르면 null. */
  country: string | null;
  developedCount: number;
  publishedCount: number;
};

type FacetRow = { slug: string; name: string; game_count: number };
const toFacet = (row: FacetRow): Facet => ({ slug: row.slug, name: row.name, gameCount: row.game_count });

export async function getGenreBySlug(pool: Pool, slug: string): Promise<Facet | null> {
  const { rows } = await pool.query<FacetRow>(
    `select x.slug, x.name, (select count(*)::int from game_genres l where l.genre_id = x.id) as game_count
     from genres x where x.slug = $1`,
    [slug],
  );
  return rows[0] ? toFacet(rows[0]) : null;
}

export async function getTagBySlug(pool: Pool, slug: string): Promise<Facet | null> {
  const { rows } = await pool.query<FacetRow>(
    `select x.slug, x.name, (select count(*)::int from game_tags l where l.tag_id = x.id) as game_count
     from tags x where x.slug = $1`,
    [slug],
  );
  return rows[0] ? toFacet(rows[0]) : null;
}

export async function getCompanyBySlug(pool: Pool, slug: string): Promise<Company | null> {
  const { rows } = await pool.query<{
    slug: string; name: string; name_ko: string | null; country: string | null; developed_count: number; published_count: number;
  }>(
    `select c.slug, c.name, c.name_ko, c.country,
       (select count(*)::int from game_developers l where l.company_id = c.id) as developed_count,
       (select count(*)::int from game_publishers l where l.company_id = c.id) as published_count
     from game_companies c where c.slug = $1`,
    [slug],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    slug: row.slug, name: row.name, nameKo: row.name_ko, country: row.country,
    developedCount: row.developed_count, publishedCount: row.published_count,
  };
}

/**
 * `filter`는 `games g`에 거는 조건이고 `$1`이 분류·회사 슬러그다(이 파일의 상수만 넘기며 사용자 입력은 항상 매개변수다).
 * 인기 목록과 같은 순서·커서를 쓴다: 평가 수 내림차순, 같으면 id 내림차순. 없는 슬러그는 빈 페이지다.
 */
async function listBy(pool: Pool, filter: string, slug: string, options: Options): Promise<Page> {
  const limit = Math.min(Math.max(options.limit ?? PAGE_SIZE, 1), 50);
  const cursor = decodeCursor(options.cursor);
  const { rows } = await pool.query<Row>(
    `select ${COLUMNS} from games g
     where ${filter}
       and ($2::int is null or (g.rating_count, g.id) < ($2::int, $3::uuid))
     order by g.rating_count desc, g.id desc limit $4`,
    [slug, cursor?.ratingCount ?? null, cursor?.id ?? null, limit + 1],
  );
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    items: page.map(toHit),
    nextCursor: rows.length > limit && last ? encodeCursor({ score: 0, ratingCount: last.rating_count, id: last.id }) : null,
  };
}

export function gamesByGenre(pool: Pool, slug: string, options: Options = {}): Promise<Page> {
  return listBy(pool, "g.id in (select l.game_id from game_genres l where l.genre_id = (select id from genres where slug = $1))", slug, options);
}

export function gamesByTag(pool: Pool, slug: string, options: Options = {}): Promise<Page> {
  return listBy(pool, "g.id in (select l.game_id from game_tags l where l.tag_id = (select id from tags where slug = $1))", slug, options);
}

/** 개발사와 퍼블리셔는 다른 연결 테이블이라 `role`로 구분한다. 한 게임이 양쪽에 있으면 둘 다에 나온다. */
export function gamesByCompany(pool: Pool, slug: string, role: "developer" | "publisher", options: Options = {}): Promise<Page> {
  const table = role === "developer" ? "game_developers" : "game_publishers";
  return listBy(pool, `g.id in (select l.game_id from ${table} l where l.company_id = (select id from game_companies where slug = $1))`, slug, options);
}

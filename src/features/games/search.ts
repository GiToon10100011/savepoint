import type { Pool } from "pg";
import type { GameSource } from "@/server/igdb/source";
import type { GameDraft } from "@/server/igdb/mapper";

export const PAGE_SIZE = 20;

export type GameHit = {
  id: string;
  slug: string;
  title: string;
  titleKo: string | null;
  releaseDate: string | null;
  coverUrl: string | null;
  coverWidth: number | null;
  coverHeight: number | null;
  ratingCount: number;
  ratingSum: number;
  /** 대표 장르 이름(없으면 null) */
  genre: string | null;
};

/** 키셋 커서: 마지막 항목의 (점수, 평가 수, id). 정렬이 모두 내림차순이라 `(점수, 평가 수, id) < 커서`로 이어 간다. */
type Cursor = { score: number; ratingCount: number; id: string };

const MAX_INT = 2_147_483_647;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify([cursor.score, cursor.ratingCount, cursor.id])).toString("base64url");
}

/** 형식이 틀린 커서는 첫 페이지로 취급한다(오류로 끝내지 않는다). */
export function decodeCursor(value: string | null | undefined): Cursor | null {
  if (!value || value.length > 200) return null;
  try {
    const [score, ratingCount, id] = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown[];
    if (!Number.isInteger(score) || !Number.isInteger(ratingCount) || typeof id !== "string" || !UUID.test(id)) return null;
    // 평가 수는 쿼리에서 `::int`로 비교하므로 int 범위(0–2,147,483,647)를 넘으면 DB가 "out of range"로 실패한다.
    if ((score as number) < 0 || (score as number) > 10_000 || (ratingCount as number) < 0 || (ratingCount as number) > MAX_INT) return null;
    return { score: score as number, ratingCount: ratingCount as number, id };
  } catch {
    return null;
  }
}

/** `ILIKE` 패턴의 특수 문자(`\`, `%`, `_`)를 글자 그대로 찾도록 이스케이프한다. */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, "\\$&");
}

export type Row = {
  id: string; slug: string; title: string; title_ko: string | null; release_date: string | null; cover_url: string | null;
  cover_width: number | null; cover_height: number | null; rating_count: number; rating_sum: number; genre: string | null; score?: number;
};

export const toHit = (row: Row): GameHit => ({
  id: row.id, slug: row.slug, title: row.title, titleKo: row.title_ko, releaseDate: row.release_date, coverUrl: row.cover_url,
  coverWidth: row.cover_width, coverHeight: row.cover_height, ratingCount: row.rating_count, ratingSum: row.rating_sum, genre: row.genre,
});

export const COLUMNS = `g.id, g.slug, g.title, g.title_ko, to_char(g.release_date, 'YYYY-MM-DD') as release_date, g.cover_url, g.cover_width, g.cover_height,
  g.rating_count, g.rating_sum,
  (select gen.name from game_genres gg join genres gen on gen.id = gg.genre_id where gg.game_id = g.id order by gen.id limit 1) as genre`;

export type Page = { items: GameHit[]; nextCursor: string | null };

/** 검색어가 없을 때 보여 주는 인기 게임(평가 수 기준). */
export async function popularGames(pool: Pool, options: { cursor?: string | null; limit?: number } = {}): Promise<Page> {
  const limit = Math.min(Math.max(options.limit ?? PAGE_SIZE, 1), 50);
  const cursor = decodeCursor(options.cursor);
  const { rows } = await pool.query<Row>(
    `select ${COLUMNS} from games g
     where ($1::int is null or (g.rating_count, g.id) < ($1::int, $2::uuid))
     order by g.rating_count desc, g.id desc limit $3`,
    [cursor?.ratingCount ?? null, cursor?.id ?? null, limit + 1],
  );
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    items: page.map(toHit),
    nextCursor: rows.length > limit && last ? encodeCursor({ score: 0, ratingCount: last.rating_count, id: last.id }) : null,
  };
}

/**
 * 내부 DB 검색. 점수 = 일치 단계(정확 3000 > 앞부분 2000 > 포함 1000 > 유사도만 0) + 유사도(0–100).
 * 한국어 제목(`title_ko`)과 원제를 함께 본다. 동점은 평가 수, id 순이다.
 */
export async function searchGames(pool: Pool, text: string, options: { cursor?: string | null; limit?: number } = {}): Promise<Page> {
  const query = text.trim().slice(0, 100);
  if (query === "") return popularGames(pool, options);

  const limit = Math.min(Math.max(options.limit ?? PAGE_SIZE, 1), 50);
  const cursor = decodeCursor(options.cursor);
  const escaped = escapeLike(query);
  const { rows } = await pool.query<Row>(
    `select ${COLUMNS}, s.score
     from games g
     cross join lateral (select (
       case
         when lower(g.title) = lower($1) or lower(g.title_ko) = lower($1) then 3000
         when g.title ilike $3 or g.title_ko ilike $3 then 2000
         when g.title ilike $2 or g.title_ko ilike $2 then 1000
         else 0
       end
       + floor(greatest(similarity(g.title, $1), similarity(coalesce(g.title_ko, ''), $1)) * 100)::int
     ) as score) s
     where (g.title ilike $2 or g.title_ko ilike $2 or g.title % $1 or g.title_ko % $1)
       and ($4::int is null or (s.score, g.rating_count, g.id) < ($4::int, $5::int, $6::uuid))
     order by s.score desc, g.rating_count desc, g.id desc
     limit $7`,
    [query, `%${escaped}%`, `${escaped}%`, cursor?.score ?? null, cursor?.ratingCount ?? null, cursor?.id ?? null, limit + 1],
  );
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    items: page.map(toHit),
    nextCursor:
      rows.length > limit && last ? encodeCursor({ score: last.score as number, ratingCount: last.rating_count, id: last.id }) : null,
  };
}

export type Candidate = {
  draft: GameDraft;
  /** 이미 내부 DB에 가져온 게임이면 그 슬러그. 아니면 null(미리보기 `/games/igdb-{id}`로 연결한다). */
  internalSlug: string | null;
};

export type SearchResult = Page & {
  /** 아직 가져오지 않은 IGDB 후보(첫 페이지에서 내부 결과가 부족할 때만). */
  candidates: Candidate[];
  /** IGDB를 부르지 못했다. 내부 결과와 수동 등록은 그대로 동작한다(기능 명세 B4). */
  igdbUnavailable: boolean;
};

/**
 * 내부 결과를 먼저 보여 주고, 첫 페이지가 한 쪽을 채우지 못하면 IGDB 후보를 덧붙인다. 이미 가져온 게임은
 * 후보에서 빼서 같은 게임이 두 번 보이지 않게 한다. IGDB가 실패해도 오류로 끝내지 않는다.
 */
export async function searchCatalog(
  pool: Pool,
  source: GameSource | null,
  text: string,
  options: { cursor?: string | null } = {},
): Promise<SearchResult> {
  const page = await searchGames(pool, text, options);
  const query = text.trim();
  const needsCandidates = query !== "" && !options.cursor && page.items.length < PAGE_SIZE;
  if (!needsCandidates) return { ...page, candidates: [], igdbUnavailable: false };
  // 키가 설정되지 않은 환경도 IGDB 장애와 같게 다룬다. 외부 게임이 왜 안 나오는지 사용자가 알 수 있다.
  if (source === null) return { ...page, candidates: [], igdbUnavailable: true };

  let drafts: GameDraft[];
  try {
    drafts = await source.search(query, { limit: PAGE_SIZE });
  } catch {
    return { ...page, candidates: [], igdbUnavailable: true };
  }
  if (drafts.length === 0) return { ...page, candidates: [], igdbUnavailable: false };

  const known = await pool.query<{ external_id: string; slug: string }>(
    "select external_id, slug from games where source = 'igdb' and external_id = any($1)",
    [drafts.map((d) => String(d.igdbId))],
  );
  const slugByIgdbId = new Map(known.rows.map((r) => [r.external_id, r.slug]));
  const shown = new Set(page.items.map((item) => item.slug));
  const candidates = drafts
    .map((draft) => ({ draft, internalSlug: slugByIgdbId.get(String(draft.igdbId)) ?? null }))
    .filter((candidate) => !candidate.internalSlug || !shown.has(candidate.internalSlug))
    .slice(0, PAGE_SIZE - page.items.length);
  return { ...page, candidates, igdbUnavailable: false };
}

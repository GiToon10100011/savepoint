import type { Pool } from "pg";

type Named = { slug: string; name: string };

export type GameDetail = {
  id: string;
  slug: string;
  source: "igdb" | "manual";
  title: string;
  titleKo: string | null;
  summary: string | null;
  releaseDate: string | null;
  coverUrl: string | null;
  coverWidth: number | null;
  coverHeight: number | null;
  ratingCount: number;
  ratingSum: number;
  genres: Named[];
  tags: Named[];
  platforms: Named[];
  /** 개발사와 퍼블리셔는 서로 다른 목록이다(같은 회사가 양쪽에 있을 수 있다). 이름은 한국어 이름이 있으면 그것이다. */
  developers: Named[];
  publishers: Named[];
};

type Row = Omit<GameDetail, "titleKo" | "releaseDate" | "coverUrl" | "coverWidth" | "coverHeight" | "ratingCount" | "ratingSum"> & {
  title_ko: string | null; release_date: string | null; cover_url: string | null; cover_width: number | null; cover_height: number | null;
  rating_count: number; rating_sum: number;
};

const list = (sql: string) => `coalesce((${sql}), '[]'::json)`;

/** 슬러그로 게임 한 건과 분류·회사를 한 번에 읽는다. 없으면 null. */
export async function getGameBySlug(pool: Pool, slug: string): Promise<GameDetail | null> {
  const { rows } = await pool.query<Row>(
    `select g.id, g.slug, g.source, g.title, g.title_ko, g.summary, to_char(g.release_date, 'YYYY-MM-DD') as release_date,
       g.cover_url, g.cover_width, g.cover_height, g.rating_count, g.rating_sum,
       ${list(`select json_agg(json_build_object('slug', x.slug, 'name', x.name) order by x.id)
               from game_genres l join genres x on x.id = l.genre_id where l.game_id = g.id`)} as genres,
       ${list(`select json_agg(json_build_object('slug', x.slug, 'name', x.name) order by x.name)
               from game_tags l join tags x on x.id = l.tag_id where l.game_id = g.id`)} as tags,
       ${list(`select json_agg(json_build_object('slug', x.slug, 'name', x.name) order by x.name)
               from game_platforms l join platforms x on x.id = l.platform_id where l.game_id = g.id`)} as platforms,
       ${list(`select json_agg(json_build_object('slug', x.slug, 'name', coalesce(x.name_ko, x.name)) order by x.name)
               from game_developers l join game_companies x on x.id = l.company_id where l.game_id = g.id`)} as developers,
       ${list(`select json_agg(json_build_object('slug', x.slug, 'name', coalesce(x.name_ko, x.name)) order by x.name)
               from game_publishers l join game_companies x on x.id = l.company_id where l.game_id = g.id`)} as publishers
     from games g where g.slug = $1`,
    [slug],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id, slug: row.slug, source: row.source, title: row.title, titleKo: row.title_ko, summary: row.summary,
    releaseDate: row.release_date, coverUrl: row.cover_url, coverWidth: row.cover_width, coverHeight: row.cover_height,
    ratingCount: row.rating_count, ratingSum: row.rating_sum,
    genres: row.genres, tags: row.tags, platforms: row.platforms, developers: row.developers, publishers: row.publishers,
  };
}

/** 이미 가져온 IGDB 게임이면 그 슬러그를 돌려준다(미리보기 주소를 내부 주소로 바꿀 때 쓴다). */
export async function findSlugByIgdbId(pool: Pool, igdbId: number): Promise<string | null> {
  const { rows } = await pool.query<{ slug: string }>("select slug from games where source = 'igdb' and external_id = $1", [String(igdbId)]);
  return rows[0]?.slug ?? null;
}

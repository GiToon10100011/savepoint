import type { Pool } from "pg";
import { GameNotFoundError } from "@/features/ratings/ratings";
import { isPlayStatus, type PlayStatus } from "@/lib/play-status";
import { storedToStars, type Stars } from "@/lib/rating";
import { runAsUser } from "@/server/db/with-user";
import type { EntryInput } from "./entry-form";

/** 라이브러리를 쓰는 사용자. 세션의 인증 ID와 앱 프로필 ID가 모두 있어야 RLS를 통과한다. */
export type LibraryUser = { authUserId: string; profileId: string };

/** 내 라이브러리의 한 항목(내 메모 포함). 날짜는 `YYYY-MM-DD`, 등록 시각은 DB가 낸 텍스트다. */
export type LibraryEntry = EntryInput & { id: string; addedAt: string; lastPlayedOn: string | null };

/** 라이브러리에 없는 게임을 저장하려 했다(다른 탭에서 지운 경우 등). */
export class NotInLibraryError extends Error {
  constructor() {
    super("not in library");
    this.name = "NotInLibraryError";
  }
}

/** 존재하지 않는 플랫폼 ID가 왔다. */
export class InvalidPlatformError extends Error {
  constructor() {
    super("invalid platform");
    this.name = "InvalidPlatformError";
  }
}

type EntryRow = {
  id: string; status: PlayStatus | null; platform_id: number | null; added_at: string;
  started_on: string | null; cleared_on: string | null; perfected_on: string | null; last_played_on: string | null;
  playtime_minutes: number | null; progress_percent: number | null; progress_text: string | null; note: string | null;
};

const ENTRY_SELECT = `select ug.id, ug.status, ug.platform_id, ug.added_at::text as added_at,
    to_char(ug.started_on, 'YYYY-MM-DD') as started_on, to_char(ug.cleared_on, 'YYYY-MM-DD') as cleared_on,
    to_char(ug.perfected_on, 'YYYY-MM-DD') as perfected_on, to_char(ug.last_played_on, 'YYYY-MM-DD') as last_played_on,
    ug.playtime_minutes, ug.progress_percent, ug.progress_text, n.note
  from user_games ug left join user_game_notes n on n.user_game_id = ug.id`;

const toEntry = (row: EntryRow): LibraryEntry => ({
  id: row.id, status: row.status, platformId: row.platform_id, addedAt: row.added_at,
  startedOn: row.started_on, clearedOn: row.cleared_on, perfectedOn: row.perfected_on, lastPlayedOn: row.last_played_on,
  playtimeMinutes: row.playtime_minutes, progressPercent: row.progress_percent, progressText: row.progress_text, note: row.note,
});

/** 내 라이브러리 항목(메모 포함). 없으면 null. */
export async function getLibraryEntry(pool: Pool, user: LibraryUser, gameId: string): Promise<LibraryEntry | null> {
  return runAsUser(pool, user, async (_tx, client) => {
    const { rows } = await client.query<EntryRow>(`${ENTRY_SELECT} where ug.user_id = $1 and ug.game_id = $2`, [user.profileId, gameId]);
    return rows[0] ? toEntry(rows[0]) : null;
  });
}

/**
 * 라이브러리에 추가한다(상태 미지정). 이미 있으면 그대로 두고 그 항목을 돌려준다 — 같은 게임을 두 번 등록할 수 없고,
 * 버튼을 두 번 눌러도 오류가 나지 않는다. 평가는 건드리지 않는다.
 */
export async function addToLibrary(pool: Pool, user: LibraryUser, gameId: string): Promise<LibraryEntry> {
  return runAsUser(pool, user, async (_tx, client) => {
    try {
      await client.query("insert into user_games (user_id, game_id) values ($1, $2) on conflict (user_id, game_id) do nothing", [user.profileId, gameId]);
    } catch (error) {
      if ((error as { code?: string }).code === "23503") throw new GameNotFoundError(); // 없는 게임 ID(FK)
      throw error;
    }
    const { rows } = await client.query<EntryRow>(`${ENTRY_SELECT} where ug.user_id = $1 and ug.game_id = $2`, [user.profileId, gameId]);
    return toEntry(rows[0]);
  });
}

/**
 * 사용자가 고칠 수 있는 칸을 모두 새 값으로 바꾼다(메모는 비우면 지운다). 마지막 플레이일은 진행도·플레이 시간이 바뀔 때
 * DB 트리거가 채운다. 상태·날짜를 바꿔도 평가·리뷰는 만들어지지 않는다. 라이브러리에 없으면 `NotInLibraryError`다.
 */
export async function saveLibraryEntry(pool: Pool, user: LibraryUser, gameId: string, input: EntryInput): Promise<LibraryEntry> {
  return runAsUser(pool, user, async (_tx, client) => {
    let id: string | undefined;
    try {
      const updated = await client.query<{ id: string }>(
        `update user_games set status = $3, platform_id = $4, started_on = $5, cleared_on = $6, perfected_on = $7,
           playtime_minutes = $8, progress_percent = $9, progress_text = $10
         where user_id = $1 and game_id = $2 returning id`,
        [user.profileId, gameId, input.status, input.platformId, input.startedOn, input.clearedOn, input.perfectedOn, input.playtimeMinutes, input.progressPercent, input.progressText],
      );
      id = updated.rows[0]?.id;
    } catch (error) {
      if ((error as { code?: string }).code === "23503") throw new InvalidPlatformError(); // 없는 플랫폼 ID(FK)
      throw error;
    }
    if (!id) throw new NotInLibraryError();

    if (input.note === null) {
      await client.query("delete from user_game_notes where user_game_id = $1", [id]);
    } else {
      await client.query(
        "insert into user_game_notes (user_game_id, note) values ($1, $2) on conflict (user_game_id) do update set note = excluded.note",
        [id, input.note],
      );
    }
    const { rows } = await client.query<EntryRow>(`${ENTRY_SELECT} where ug.id = $1`, [id]);
    return toEntry(rows[0]);
  });
}

/** 라이브러리에서 지운다(메모도 함께 지워지고, 평가·리뷰는 남는다). 지운 항목이 있었으면 true. */
export async function removeFromLibrary(pool: Pool, user: LibraryUser, gameId: string): Promise<boolean> {
  return runAsUser(pool, user, async (_tx, client) => {
    const { rowCount } = await client.query("delete from user_games where user_id = $1 and game_id = $2", [user.profileId, gameId]);
    return (rowCount ?? 0) > 0;
  });
}

/* ───────────────────────────── 목록 ───────────────────────────── */

export const LIBRARY_PAGE_SIZE = 20;

/** 정렬 기준. 값은 URL에 담기므로 목록에 있는 것만 받는다. */
export const LIBRARY_SORTS = ["added", "played", "cleared", "rating", "title"] as const;
export type LibrarySort = (typeof LIBRARY_SORTS)[number];
export const LIBRARY_SORT_LABELS: Record<LibrarySort, string> = {
  added: "최근 등록",
  played: "최근 플레이",
  cleared: "엔딩 달성일",
  rating: "내 평점",
  title: "가나다",
};
export const isLibrarySort = (value: unknown): value is LibrarySort => LIBRARY_SORTS.includes(value as LibrarySort);

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 정렬마다 SQL 식(이 파일의 상수만 쓴다, 사용자 입력은 들어가지 않는다)과 키셋 커서의 키 형식이다.
 * 값이 없는 날짜·평점은 가장 오래된 값으로 바꿔(1970-01-01·0) NULL 처리 없이 맨 뒤로 보낸다. DB가 1970-01-01 이전 날짜를 막으므로
 * 실제 값과 섞이지 않는다. 같은 키는 항목 id로 가른다.
 */
const SORTS: Record<LibrarySort, { expr: string; cast: string; dir: "desc" | "asc"; valid: (key: string) => boolean }> = {
  // 시각은 JS Date가 마이크로초를 잃으므로 PostgreSQL이 낸 텍스트(`2026-11-14 07:21:34.123456+00`)를 그대로 주고받는다.
  added: { expr: "ug.added_at", cast: "timestamptz", dir: "desc", valid: (k) => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?[+-]\d{2}(:\d{2})?$/.test(k) },
  played: { expr: "coalesce(ug.last_played_on, date '1970-01-01')", cast: "date", dir: "desc", valid: (k) => DATE.test(k) },
  cleared: { expr: "coalesce(ug.cleared_on, date '1970-01-01')", cast: "date", dir: "desc", valid: (k) => DATE.test(k) },
  rating: { expr: "coalesce(r.rating, 0)", cast: "int", dir: "desc", valid: (k) => /^\d{1,2}$/.test(k) },
  title: { expr: "lower(coalesce(g.title_ko, g.title))", cast: "text", dir: "asc", valid: (k) => k.length <= 400 },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 키셋 커서: 마지막 항목의 (정렬 키 텍스트, 항목 id). 정렬마다 키 형식이 달라 해석할 때 정렬을 함께 받는다. */
export function encodeLibraryCursor(key: string, id: string): string {
  return Buffer.from(JSON.stringify([key, id])).toString("base64url");
}

/** 형식이 틀리거나 정렬과 맞지 않는 커서는 첫 페이지로 취급한다(오류로 끝내지 않는다). */
export function decodeLibraryCursor(value: string | null | undefined, sort: LibrarySort): { key: string; id: string } | null {
  // 제목 정렬의 키는 400자까지이고 한글·이모지는 글자당 3–4바이트라 base64 커서가 2,200자 가까이 된다. 상한이 이보다 작으면
  // 긴 제목에서 정당한 커서가 버려져 `더 보기`가 첫 페이지를 다시 보여 준다.
  if (!value || value.length > 2400) return null;
  try {
    const [key, id] = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown[];
    if (typeof key !== "string" || typeof id !== "string" || !UUID.test(id) || !SORTS[sort].valid(key)) return null;
    // 날짜 형식은 맞지만 없는 날짜(2026-13-45)이면 DB가 캐스팅에서 실패한다. 실제 날짜인지도 확인한다.
    if (SORTS[sort].cast === "date" && Number.isNaN(Date.parse(`${key}T00:00:00Z`))) return null;
    return { key, id };
  } catch {
    return null;
  }
}

/** 목록 필터. 한 번에 하나만 건다(탭·상태 선택이 같은 자리다). `unset`은 상태 미지정, `rated`는 내가 평가한 게임이다. */
export type LibraryFilter = PlayStatus | "unset" | "rated" | "all";
export const isLibraryFilter = (value: unknown): value is LibraryFilter => value === "all" || value === "unset" || value === "rated" || isPlayStatus(value);

export type LibraryQuery = {
  filter?: LibraryFilter;
  /** 장르 슬러그 */
  genre?: string;
  /** 플랫폼 슬러그 */
  platform?: string;
  sort?: LibrarySort;
  cursor?: string | null;
  limit?: number;
};

export type LibraryItem = {
  id: string;
  gameId: string;
  slug: string;
  title: string;
  titleKo: string | null;
  coverUrl: string | null;
  coverWidth: number | null;
  coverHeight: number | null;
  status: PlayStatus | null;
  progressPercent: number | null;
  progressText: string | null;
  platformName: string | null;
  /** 내가 매긴 별점. 평가하지 않았으면 null. */
  myRating: Stars | null;
  lastPlayedOn: string | null;
  clearedOn: string | null;
  addedAt: string;
};

export type LibraryPage = { items: LibraryItem[]; nextCursor: string | null };

type ListRow = {
  id: string; game_id: string; slug: string; title: string; title_ko: string | null;
  cover_url: string | null; cover_width: number | null; cover_height: number | null;
  status: PlayStatus | null; progress_percent: number | null; progress_text: string | null; platform_name: string | null;
  my_rating: number | null; last_played_on: string | null; cleared_on: string | null; added_at: string; sort_key: string;
};

/** 한 사용자의 라이브러리 목록. 필터·정렬은 URL에서 오는 값이라 목록에 있는 것만 SQL에 반영하고, 값은 모두 매개변수다. */
export async function listLibrary(pool: Pool, user: LibraryUser, query: LibraryQuery = {}): Promise<LibraryPage> {
  // URL에서 온 값이 타입을 우회해 들어와도 목록에 없는 정렬·필터는 기본값으로 읽는다(SQL에 흘려보내지도, 오류로 끝내지도 않는다).
  const sortName: LibrarySort = isLibrarySort(query.sort) ? query.sort : "added";
  const sort = SORTS[sortName];
  const limit = Math.min(Math.max(query.limit ?? LIBRARY_PAGE_SIZE, 1), 50);
  const params: unknown[] = [user.profileId];
  const bind = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };

  const where = ["ug.user_id = $1"];
  const filter: LibraryFilter = isLibraryFilter(query.filter) ? query.filter : "all";
  if (filter === "unset") where.push("ug.status is null");
  else if (filter === "rated") where.push("r.rating is not null");
  else if (filter !== "all") where.push(`ug.status = ${bind(filter)}::play_status`);
  if (query.genre) where.push(`exists (select 1 from game_genres gg join genres x on x.id = gg.genre_id where gg.game_id = ug.game_id and x.slug = ${bind(query.genre)})`);
  if (query.platform) where.push(`ug.platform_id = (select id from platforms where slug = ${bind(query.platform)})`);

  const cursor = decodeLibraryCursor(query.cursor, sortName);
  if (cursor) {
    const op = sort.dir === "desc" ? "<" : ">";
    where.push(`(${sort.expr}, ug.id) ${op} (${bind(cursor.key)}::${sort.cast}, ${bind(cursor.id)}::uuid)`);
  }

  const { rows } = await pool.query<ListRow>(
    `select ug.id, ug.game_id, g.slug, g.title, g.title_ko, g.cover_url, g.cover_width, g.cover_height,
            ug.status, ug.progress_percent, ug.progress_text, p.name as platform_name, r.rating as my_rating,
            to_char(ug.last_played_on, 'YYYY-MM-DD') as last_played_on, to_char(ug.cleared_on, 'YYYY-MM-DD') as cleared_on,
            ug.added_at::text as added_at, (${sort.expr})::text as sort_key
     from user_games ug
     join games g on g.id = ug.game_id
     left join platforms p on p.id = ug.platform_id
     left join game_ratings r on r.user_id = ug.user_id and r.game_id = ug.game_id
     where ${where.join(" and ")}
     order by ${sort.expr} ${sort.dir}, ug.id ${sort.dir}
     limit ${bind(limit + 1)}`,
    params,
  );

  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    items: page.map((row) => ({
      id: row.id, gameId: row.game_id, slug: row.slug, title: row.title, titleKo: row.title_ko,
      coverUrl: row.cover_url, coverWidth: row.cover_width, coverHeight: row.cover_height,
      status: row.status, progressPercent: row.progress_percent, progressText: row.progress_text, platformName: row.platform_name,
      myRating: row.my_rating === null ? null : storedToStars(row.my_rating),
      lastPlayedOn: row.last_played_on, clearedOn: row.cleared_on, addedAt: row.added_at,
    })),
    nextCursor: rows.length > limit && last ? encodeLibraryCursor(last.sort_key, last.id) : null,
  };
}

/** 폼의 선택지. 플랫폼은 ID(저장용)와 슬러그(필터용)를 함께 준다. */
export async function listPlatforms(pool: Pool): Promise<{ id: number; slug: string; name: string }[]> {
  const { rows } = await pool.query<{ id: number; slug: string; name: string }>("select id, slug, name from platforms order by name");
  return rows;
}

export async function listGenres(pool: Pool): Promise<{ slug: string; name: string }[]> {
  const { rows } = await pool.query<{ slug: string; name: string }>("select slug, name from genres order by id");
  return rows;
}

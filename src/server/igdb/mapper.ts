/**
 * IGDB 응답을 내부 모델(`GameDraft`)로 바꾼다. 순수 함수라 네트워크 없이 시험한다.
 * 변환표의 ID는 IGDB가 실제로 돌려주는 값을 조회해 확인한 것이다(2026-11-13).
 * 장르는 내부 15개, 태그는 마이그레이션이 시드한 목록 안에서만 고른다(표에 없는 키워드는 버린다 —
 * 한 게임에 키워드가 60개 넘게 달려 전부 태그로 만들면 의미가 없다).
 */

export type IgdbRaw = {
  id: number;
  name?: string;
  slug?: string;
  summary?: string;
  first_release_date?: number;
  cover?: { image_id?: string; width?: number; height?: number };
  platforms?: { id: number; name?: string; slug?: string }[];
  genres?: { id: number }[];
  themes?: { id: number }[];
  keywords?: { id: number }[];
  player_perspectives?: { id: number }[];
  game_modes?: { id: number }[];
  involved_companies?: {
    developer?: boolean;
    publisher?: boolean;
    company?: { id: number; name?: string; slug?: string; country?: number };
  }[];
  game_localizations?: { name?: string; region?: { identifier?: string } }[];
};

export type DraftCompany = { igdbId: number; slug: string; name: string; country: string | null };
export type DraftPlatform = { igdbId: number; slug: string; name: string };

export type GameDraft = {
  igdbId: number;
  slug: string;
  title: string;
  titleKo: string | null;
  summary: string | null;
  /** `YYYY-MM-DD`(UTC). 모르거나 DB가 받는 범위(1940–2100) 밖이면 null. */
  releaseDate: string | null;
  cover: { url: string; width: number; height: number } | null;
  platforms: DraftPlatform[];
  genreSlugs: string[];
  tagSlugs: string[];
  developers: DraftCompany[];
  publishers: DraftCompany[];
};

// 장르: IGDB 장르 → 내부 장르. 슈터는 시점으로 FPS/TPS를 가른다.
const GENRE_BY_GENRE: Record<number, string> = {
  12: "rpg", 4: "action", 25: "action", 8: "action", 31: "adventure", 2: "adventure",
  15: "strategy", 11: "strategy", 16: "strategy", 24: "strategy", 13: "simulation",
  9: "puzzle", 10: "racing", 14: "sports", 34: "visual-novel",
};
const SHOOTER = 5;
const FIRST_PERSON = 1;
const THIRD_PERSON = 2;
const GENRE_BY_THEME: Record<number, string> = { 38: "open-world", 41: "strategy", 1: "action" };
const GENRE_BY_KEYWORD: Record<number, string> = {
  521: "jrpg", 416: "roguelike", 17292: "roguelike", 17326: "soulslike", 58746: "soulslike",
};

// 태그: 테마·플레이 모드·플레이어 시점은 닫힌 목록이라 전부 변환하고, 키워드는 고른 것만 변환한다.
const TAG_BY_THEME: Record<number, string> = {
  17: "fantasy", 18: "sci-fi", 19: "horror", 20: "thriller", 21: "survival", 22: "historical", 23: "stealth",
  27: "comedy", 31: "drama", 33: "sandbox", 39: "warfare", 40: "party", 43: "mystery", 44: "romance",
  35: "kids", 34: "educational",
};
const TAG_BY_MODE: Record<number, string> = {
  1: "single-player", 2: "multiplayer", 3: "co-op", 4: "split-screen", 5: "mmo", 6: "battle-royale",
};
const TAG_BY_PERSPECTIVE: Record<number, string> = {
  1: "first-person", 2: "third-person", 3: "isometric", 4: "side-view", 5: "text-based", 7: "vr",
};
const TAG_BY_KEYWORD: Record<number, string> = { 415: "turn-based", 2399: "turn-based", 2377: "party-based", 2426: "story-rich" };

/** 매퍼가 만들어 낼 수 있는 모든 장르·태그 슬러그(마이그레이션 시드와 맞는지 시험한다). */
export const MAPPED_GENRE_SLUGS = [
  ...new Set([...Object.values(GENRE_BY_GENRE), ...Object.values(GENRE_BY_THEME), ...Object.values(GENRE_BY_KEYWORD), "fps", "tps"]),
];
export const MAPPED_TAG_SLUGS = [
  ...new Set([...Object.values(TAG_BY_THEME), ...Object.values(TAG_BY_MODE), ...Object.values(TAG_BY_PERSPECTIVE), ...Object.values(TAG_BY_KEYWORD)]),
];

// IGDB는 회사 국가를 ISO 3166-1 숫자 코드로 준다.
const COUNTRY_BY_NUMERIC: Record<number, string> = {
  392: "JP", 840: "US", 410: "KR", 826: "GB", 250: "FR", 276: "DE", 124: "CA", 156: "CN", 752: "SE",
  616: "PL", 380: "IT", 724: "ES", 643: "RU", 203: "CZ", 528: "NL", 246: "FI", 208: "DK", 36: "AU",
  158: "TW", 344: "HK",
};

const SLUG = /^[a-z0-9]([a-z0-9-]{0,118}[a-z0-9])?$/;
/** DB의 슬러그 규칙(`games_slug_format`)과 같다: 형식이 맞고 `new`·`igdb-숫자`가 아니어야 한다. */
function usableSlug(slug: string | undefined): slug is string {
  return typeof slug === "string" && SLUG.test(slug) && slug !== "new" && !/^igdb-[0-9]+$/.test(slug);
}

function releaseDate(epochSeconds: number | undefined): string | null {
  if (typeof epochSeconds !== "number" || !Number.isFinite(epochSeconds)) return null;
  const iso = new Date(epochSeconds * 1000).toISOString().slice(0, 10);
  return iso >= "1940-01-01" && iso <= "2100-12-31" ? iso : null;
}

function companies(raw: IgdbRaw, role: "developer" | "publisher"): DraftCompany[] {
  const seen = new Set<number>();
  const out: DraftCompany[] = [];
  for (const involved of raw.involved_companies ?? []) {
    const company = involved.company;
    if (!involved[role] || !company?.name || seen.has(company.id)) continue;
    seen.add(company.id);
    const slug = usableSlug(company.slug) ? company.slug : `company-${company.id}`;
    out.push({ igdbId: company.id, slug, name: company.name, country: COUNTRY_BY_NUMERIC[company.country ?? -1] ?? null });
  }
  return out;
}

export function mapIgdbGame(raw: IgdbRaw): GameDraft {
  const ids = (list?: { id: number }[]) => (list ?? []).map((item) => item.id);
  const perspectives = ids(raw.player_perspectives);
  const genres = new Set<string>();
  const tags = new Set<string>();

  for (const id of ids(raw.genres)) {
    if (id === SHOOTER) {
      genres.add(perspectives.includes(FIRST_PERSON) ? "fps" : perspectives.includes(THIRD_PERSON) ? "tps" : "action");
    } else if (GENRE_BY_GENRE[id]) genres.add(GENRE_BY_GENRE[id]);
  }
  for (const id of ids(raw.themes)) {
    if (GENRE_BY_THEME[id]) genres.add(GENRE_BY_THEME[id]);
    if (TAG_BY_THEME[id]) tags.add(TAG_BY_THEME[id]);
  }
  for (const id of ids(raw.keywords)) {
    if (GENRE_BY_KEYWORD[id]) genres.add(GENRE_BY_KEYWORD[id]);
    if (TAG_BY_KEYWORD[id]) tags.add(TAG_BY_KEYWORD[id]);
  }
  for (const id of ids(raw.game_modes)) if (TAG_BY_MODE[id]) tags.add(TAG_BY_MODE[id]);
  for (const id of perspectives) if (TAG_BY_PERSPECTIVE[id]) tags.add(TAG_BY_PERSPECTIVE[id]);

  const title = (raw.name ?? "").trim();
  const korean = raw.game_localizations?.find((l) => l.region?.identifier === "ko-KR")?.name?.trim();
  const cover = raw.cover;
  const hasCover = cover?.image_id && cover.width && cover.height && cover.width > 0 && cover.height > 0;

  return {
    igdbId: raw.id,
    slug: usableSlug(raw.slug) ? raw.slug : `game-${raw.id}`,
    title,
    titleKo: korean && korean !== title ? korean : null,
    summary: raw.summary?.trim() ? raw.summary.trim().slice(0, 5000) : null,
    releaseDate: releaseDate(raw.first_release_date),
    cover: hasCover
      ? { url: `https://images.igdb.com/igdb/image/upload/t_cover_big/${cover.image_id}.jpg`, width: cover.width as number, height: cover.height as number }
      : null,
    platforms: (raw.platforms ?? [])
      .filter((p) => p.name && usableSlug(p.slug?.replace(/-+$/, "")))
      .map((p) => ({ igdbId: p.id, slug: p.slug as string, name: p.name as string })),
    genreSlugs: [...genres],
    tagSlugs: [...tags],
    developers: companies(raw, "developer"),
    publishers: companies(raw, "publisher"),
  };
}

import type { IgdbClient } from "./client";
import { mapIgdbGame, type GameDraft, type IgdbRaw } from "./mapper";

/** 매퍼가 쓰는 필드만 요청한다. */
export const IGDB_FIELDS = [
  "name", "slug", "summary", "first_release_date",
  "cover.image_id", "cover.width", "cover.height",
  "platforms.id", "platforms.name", "platforms.slug",
  "genres.id", "themes.id", "keywords.id", "player_perspectives.id", "game_modes.id",
  "involved_companies.developer", "involved_companies.publisher",
  "involved_companies.company.id", "involved_companies.company.name",
  "involved_companies.company.slug", "involved_companies.company.country",
  "game_localizations.name", "game_localizations.region.identifier",
].join(",");

// 검색에 보여 줄 게임 종류: 본편(0), 독립 확장(4), 리메이크(8), 리마스터(9), 확장판(10). DLC·번들·모드·포트 등은 뺀다.
const SEARCHABLE_TYPES = "(0,4,8,9,10)";
const MAX_TEXT_LENGTH = 100;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

export type SearchOptions = { limit?: number; offset?: number };

export type GameSource = {
  search(text: string, options?: SearchOptions): Promise<GameDraft[]>;
  /** IGDB ID로 한 게임을 가져온다. 없거나 ID가 올바르지 않으면 null. */
  get(igdbId: number): Promise<GameDraft | null>;
};

/**
 * 사용자 입력을 Apicalypse의 큰따옴표 문자열 안에 넣을 수 있게 바꾼다. 역슬래시와 큰따옴표를 이스케이프하고
 * 제어 문자는 공백으로 바꾼다. 이렇게 하지 않으면 `x"; where id = 1; "` 같은 입력이 질의를 바꿀 수 있다.
 */
export function quoteApicalypse(text: string): string {
  const cleaned = text.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, MAX_TEXT_LENGTH);
  return `"${cleaned.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

const clamp = (value: number | undefined, min: number, max: number, fallback: number) =>
  Number.isFinite(value) ? Math.min(Math.max(Math.floor(value as number), min), max) : fallback;

export function createGameSource(client: IgdbClient): GameSource {
  const toDrafts = (rows: IgdbRaw[]) => rows.map(mapIgdbGame).filter((draft) => draft.title !== "");

  return {
    async search(text, options = {}) {
      if (text.replace(/[\u0000-\u001f\u007f]/g, " ").trim() === "") return [];
      const limit = clamp(options.limit, 1, MAX_LIMIT, DEFAULT_LIMIT);
      const offset = clamp(options.offset, 0, 10_000, 0);
      const body = `search ${quoteApicalypse(text)}; fields ${IGDB_FIELDS}; where game_type = ${SEARCHABLE_TYPES}; limit ${limit}; offset ${offset};`;
      return toDrafts(await client.query<IgdbRaw>("games", body));
    },

    async get(igdbId) {
      if (!Number.isSafeInteger(igdbId) || igdbId <= 0) return null;
      const rows = await client.query<IgdbRaw>("games", `fields ${IGDB_FIELDS}; where id = ${igdbId};`);
      return toDrafts(rows)[0] ?? null;
    },
  };
}

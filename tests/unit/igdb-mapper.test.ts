import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MAPPED_GENRE_SLUGS, MAPPED_TAG_SLUGS, mapIgdbGame, type IgdbRaw } from "@/server/igdb/mapper";

// 실제 응답과 같은 모양의 가상 게임이다(제3자 데이터를 저장소에 넣지 않는다).
const full: IgdbRaw = {
  id: 900001,
  name: "Test Quest",
  slug: "test-quest",
  summary: "  A test summary.  ",
  first_release_date: 1645747200, // 2022-02-25 UTC
  cover: { image_id: "co0000", width: 1851, height: 2468 },
  platforms: [
    { id: 6, name: "PC (Microsoft Windows)", slug: "win" },
    { id: 48, name: "PlayStation 4", slug: "ps4--1" },
  ],
  genres: [{ id: 12 }, { id: 31 }, { id: 99999 }],
  themes: [{ id: 17 }, { id: 38 }, { id: 42 }],
  keywords: [{ id: 521 }, { id: 415 }, { id: 72 }],
  player_perspectives: [{ id: 3 }],
  game_modes: [{ id: 1 }, { id: 3 }],
  involved_companies: [
    { developer: false, publisher: true, company: { id: 248, name: "Big Publisher", slug: "big-publisher", country: 392 } },
    { developer: true, publisher: true, company: { id: 1012, name: "Studio", slug: "studio", country: 392 } },
  ],
  game_localizations: [
    { name: "ネームJP", region: { identifier: "ja-JP" } },
    { name: "테스트 퀘스트", region: { identifier: "ko-KR" } },
  ],
};

describe("mapIgdbGame", () => {
  it("기본 정보를 내부 모델로 바꾼다", () => {
    const draft = mapIgdbGame(full);
    expect(draft).toMatchObject({
      igdbId: 900001,
      slug: "test-quest",
      title: "Test Quest",
      titleKo: "테스트 퀘스트",
      summary: "A test summary.",
      releaseDate: "2022-02-25",
      cover: { url: "https://images.igdb.com/igdb/image/upload/t_cover_big/co0000.jpg", width: 1851, height: 2468 },
    });
  });

  it("장르·태그를 변환하고 표에 없는 값은 버린다", () => {
    const draft = mapIgdbGame(full);
    expect(draft.genreSlugs.sort()).toEqual(["adventure", "jrpg", "open-world", "rpg"]);
    expect(draft.tagSlugs.sort()).toEqual(["co-op", "fantasy", "isometric", "single-player", "turn-based"]);
  });

  it("개발사와 퍼블리셔를 구분하고, 둘 다인 회사는 양쪽에 넣는다", () => {
    const draft = mapIgdbGame(full);
    expect(draft.developers.map((c) => c.name)).toEqual(["Studio"]);
    expect(draft.publishers.map((c) => c.name).sort()).toEqual(["Big Publisher", "Studio"]);
    expect(draft.developers[0]).toEqual({ igdbId: 1012, slug: "studio", name: "Studio", country: "JP" });
  });

  it("플랫폼은 IGDB ID·슬러그·이름을 그대로 옮긴다", () => {
    expect(mapIgdbGame(full).platforms).toEqual([
      { igdbId: 6, slug: "win", name: "PC (Microsoft Windows)" },
      { igdbId: 48, slug: "ps4--1", name: "PlayStation 4" },
    ]);
  });

  it.each([
    ["1인칭 슈터", [{ id: 5 }], [{ id: 1 }], ["fps"]],
    ["3인칭 슈터", [{ id: 5 }], [{ id: 2 }], ["tps"]],
    ["시점 없는 슈터", [{ id: 5 }], [], ["action"]],
  ])("슈터는 시점으로 장르를 가른다: %s", (_name, genres, perspectives, expected) => {
    expect(mapIgdbGame({ id: 1, name: "S", genres, player_perspectives: perspectives }).genreSlugs).toEqual(expected);
  });

  it("값이 없는 필드는 null이나 빈 목록이 된다", () => {
    const draft = mapIgdbGame({ id: 2, name: "Bare" });
    expect(draft).toMatchObject({
      slug: "game-2",
      titleKo: null,
      summary: null,
      releaseDate: null,
      cover: null,
      platforms: [],
      genreSlugs: [],
      tagSlugs: [],
      developers: [],
      publishers: [],
    });
  });

  it("한국어 제목이 원제와 같으면 비운다", () => {
    const raw = { id: 3, name: "Same", game_localizations: [{ name: "Same", region: { identifier: "ko-KR" } }] };
    expect(mapIgdbGame(raw).titleKo).toBeNull();
  });

  it.each([
    ["예약어 new", "new"],
    ["IGDB 미리보기 경로와 같은 모양", "igdb-123"],
    ["대문자", "Upper"],
    ["빈 값", ""],
  ])("DB가 거절할 슬러그는 `game-<id>`로 대신한다: %s", (_name, slug) => {
    expect(mapIgdbGame({ id: 7, name: "X", slug }).slug).toBe("game-7");
  });

  it.each([
    ["범위 밖(너무 옛날)", -5_000_000_000],
    ["범위 밖(먼 미래)", 5_000_000_000],
    ["숫자가 아님", Number.NaN],
  ])("출시일이 DB 범위 밖이면 null이다: %s", (_name, epoch) => {
    expect(mapIgdbGame({ id: 8, name: "X", first_release_date: epoch }).releaseDate).toBeNull();
  });

  it("커버는 이미지 ID와 크기가 모두 있어야 쓴다(DB는 한쪽만 있는 크기를 거절한다)", () => {
    expect(mapIgdbGame({ id: 9, name: "X", cover: { image_id: "co1" } }).cover).toBeNull();
    expect(mapIgdbGame({ id: 9, name: "X", cover: { width: 10, height: 10 } }).cover).toBeNull();
  });

  it("알 수 없는 국가 코드는 null이다", () => {
    const raw: IgdbRaw = { id: 10, name: "X", involved_companies: [{ developer: true, company: { id: 5, name: "C", slug: "c", country: 999 } }] };
    expect(mapIgdbGame(raw).developers[0].country).toBeNull();
  });
});

describe("변환표와 마이그레이션 시드의 일치", () => {
  const sql = readFileSync("drizzle/0001_games.sql", "utf8");
  const slugsOf = (table: string) => {
    const block = sql.slice(sql.indexOf(`INSERT INTO "${table}"`));
    const values = block.slice(0, block.indexOf("ON CONFLICT"));
    return [...values.matchAll(/\('([a-z0-9-]+)',/g)].map((m) => m[1]);
  };

  it("매퍼가 만들 수 있는 장르는 모두 시드에 있다", () => {
    const seeded = slugsOf("genres");
    expect(seeded).toHaveLength(15);
    expect(MAPPED_GENRE_SLUGS.filter((slug) => !seeded.includes(slug))).toEqual([]);
  });

  it("매퍼가 만들 수 있는 태그는 모두 시드에 있다", () => {
    const seeded = slugsOf("tags");
    expect(MAPPED_TAG_SLUGS.length).toBeGreaterThan(25);
    expect(MAPPED_TAG_SLUGS.filter((slug) => !seeded.includes(slug))).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { slugCandidate, slugify, withSuffix } from "@/features/games/slug";

// 마이그레이션의 games_slug_format과 같은 규칙.
const DB_FORMAT = /^[a-z0-9]([a-z0-9-]{0,118}[a-z0-9])?$/;
const usable = (slug: string) => DB_FORMAT.test(slug) && slug !== "new" && !/^igdb-[0-9]+$/.test(slug);

describe("slugify", () => {
  it.each([
    ["Elden Ring", "elden-ring"],
    ["Elden Ring: Nightreign", "elden-ring-nightreign"],
    ["  Spaces   and---dashes  ", "spaces-and-dashes"],
    ["Pokémon Légende Z-A", "pokemon-legende-z-a"],
    ["Hades II (2024)", "hades-ii-2024"],
    ["Ｆｕｌｌｗｉｄｔｈ ９", "fullwidth-9"],
  ])("%s → %s", (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });

  it.each(["한글 제목", "エルデンリング", "!!!", "", "   "])("영문으로 바꿀 수 없으면 빈 문자열이다: %j", (input) => {
    expect(slugify(input)).toBe("");
  });

  it("너무 길면 자르고 끝에 하이픈을 남기지 않는다", () => {
    const slug = slugify(`${"a".repeat(59)} b`); // 60자 경계에서 하이픈이 끝에 걸린다
    expect(slug.length).toBeLessThanOrEqual(60);
    expect(slug.endsWith("-")).toBe(false);
  });
});

describe("slugCandidate", () => {
  it("제목에서 슬러그를 만든다", () => {
    expect(slugCandidate("Elden Ring")).toBe("elden-ring");
  });

  it.each(["한글 제목", "!!!", ""])("만들 수 없으면 game-<무작위>를 쓴다: %j", (title) => {
    expect(slugCandidate(title)).toMatch(/^game-[0-9a-f]{8}$/);
  });

  it.each(["new", "New", "igdb-123"])("예약어(%s)는 슬러그로 쓰지 않는다", (title) => {
    expect(slugCandidate(title)).toMatch(/^game-[0-9a-f]{8}$/);
  });

  it("어떤 입력이든 DB 규칙을 만족한다", () => {
    for (const title of ["Elden Ring", "한글", "new", "igdb-9", "a", "A".repeat(500), "---", "Ünï¢ödé ✨ 2025", "x".repeat(59) + "-y"]) {
      expect(usable(slugCandidate(title)), title).toBe(true);
    }
  });

  it("무작위 대체값은 호출마다 다르다", () => {
    expect(slugCandidate("한글")).not.toBe(slugCandidate("한글"));
  });
});

describe("withSuffix", () => {
  it("접미사를 붙여도 DB 규칙을 만족한다", () => {
    for (const base of ["elden-ring", "a", "x".repeat(60), "game-1a2b3c4d"]) {
      const slug = withSuffix(base);
      expect(slug).toMatch(/-[0-9a-f]{4}$/);
      expect(usable(slug), slug).toBe(true);
    }
  });
});

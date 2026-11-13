import { describe, expect, it } from "vitest";
import { MAX_COMPANIES, parseManualForm, parseNames } from "@/features/games/manual-form";

function form(fields: Record<string, string | string[]>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) for (const v of Array.isArray(value) ? value : [value]) data.append(key, v);
  return data;
}

describe("parseNames", () => {
  it("줄바꿈·쉼표로 나누고 공백을 다듬는다", () => {
    expect(parseNames("Tiny Studio\n Other Co ,Third,, \n")).toEqual(["Tiny Studio", "Other Co", "Third"]);
  });

  it("대소문자만 다른 이름은 첫 번째만 남긴다", () => {
    expect(parseNames("Nintendo, NINTENDO, nintendo")).toEqual(["Nintendo"]);
  });

  it("빈 입력은 빈 목록이다", () => {
    expect(parseNames("")).toEqual([]);
    expect(parseNames(" , \n ,")).toEqual([]);
  });
});

describe("parseManualForm", () => {
  it("올바른 입력을 등록용 데이터로 바꾼다(값은 다듬는다)", () => {
    const result = parseManualForm(
      form({
        title: "  My Game ", titleKo: " 내 게임 ", summary: " 소개 ", releaseDate: "2024-05-01",
        developers: "Tiny Studio\nOther Co", publishers: "Pub", genre: ["rpg", "puzzle", "rpg"], tag: "single-player", platform: ["pc"],
      }),
    );
    expect(result).toMatchObject({
      ok: true,
      data: {
        title: "My Game", titleKo: "내 게임", summary: "소개", releaseDate: "2024-05-01",
        genreSlugs: ["rpg", "puzzle"], tagSlugs: ["single-player"], platformSlugs: ["pc"],
        developers: ["Tiny Studio", "Other Co"], publishers: ["Pub"],
      },
    });
  });

  it("제목만 있으면 나머지는 null이거나 빈 목록이다", () => {
    expect(parseManualForm(form({ title: "Only Title" }))).toMatchObject({
      ok: true,
      data: { titleKo: null, summary: null, releaseDate: null, genreSlugs: [], tagSlugs: [], platformSlugs: [], developers: [], publishers: [] },
    });
  });

  it.each([
    ["빈 제목", { title: "   " }, "title", "제목을 입력해 주세요."],
    ["너무 긴 제목", { title: "a".repeat(201) }, "title", "제목은 200자 이하여야 해요."],
    ["너무 긴 소개", { title: "x", summary: "가".repeat(5001) }, "summary", "소개는 5000자 이하여야 해요."],
    ["달력에 없는 날짜", { title: "x", releaseDate: "2022-02-30" }, "releaseDate", "출시일은 올바른 날짜(예: 2024-05-01)여야 해요."],
    ["형식이 다른 날짜", { title: "x", releaseDate: "2022/02/25" }, "releaseDate", "출시일은 올바른 날짜(예: 2024-05-01)여야 해요."],
    ["범위 밖 날짜", { title: "x", releaseDate: "1900-01-01" }, "releaseDate", "출시일은 올바른 날짜(예: 2024-05-01)여야 해요."],
    ["회사가 너무 많음", { title: "x", developers: "a,b,c,d,e,f" }, "developers", `개발사는 ${MAX_COMPANIES}곳까지, 이름은 200자 이하로 적어 주세요.`],
    ["회사 이름이 너무 김", { title: "x", publishers: "z".repeat(201) }, "publishers", `퍼블리셔는 ${MAX_COMPANIES}곳까지, 이름은 200자 이하로 적어 주세요.`],
  ])("거절한다: %s", (_name, fields, field, message) => {
    const result = parseManualForm(form(fields));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[field as keyof typeof result.errors]).toBe(message);
  });

  it("이모지도 한 글자로 센다(제목 200자)", () => {
    expect(parseManualForm(form({ title: "😀".repeat(200) })).ok).toBe(true);
    expect(parseManualForm(form({ title: "😀".repeat(201) })).ok).toBe(false);
  });

  it("오류가 나도 입력한 값은 그대로 돌려준다", () => {
    const result = parseManualForm(form({ title: "", summary: "남겨야 하는 소개", genre: ["rpg"] }));
    expect(result.ok).toBe(false);
    expect(result.values).toMatchObject({ summary: "남겨야 하는 소개", genres: ["rpg"] });
  });

  it("체크박스 값은 문자열만, 너무 긴 값은 버리고, 30개까지만 받는다", () => {
    const many = Array.from({ length: 50 }, (_, i) => `g${i}`);
    const result = parseManualForm(form({ title: "x", genre: [...many, "z".repeat(65), ""] }));
    expect(result.ok && result.data.genreSlugs).toHaveLength(30);
    const file = new FormData();
    file.set("title", "x");
    file.set("genre", new File(["x"], "x.txt"));
    expect(parseManualForm(file)).toMatchObject({ ok: true, data: { genreSlugs: [] } });
  });
});

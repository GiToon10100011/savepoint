import { describe, expect, it, vi } from "vitest";
import type { IgdbClient } from "@/server/igdb/client";
import { IGDB_FIELDS, createGameSource, quoteApicalypse } from "@/server/igdb/source";

function fakeClient(rows: unknown[] = []) {
  const query = vi.fn(async () => rows);
  return { client: { query } as unknown as IgdbClient, query };
}
const bodyOf = (query: ReturnType<typeof vi.fn>) => String(query.mock.calls[0][1]);

describe("quoteApicalypse", () => {
  it("큰따옴표와 역슬래시를 이스케이프한다", () => {
    expect(quoteApicalypse('a"b\\c')).toBe('"a\\"b\\\\c"');
  });

  it("제어 문자는 공백으로 바꾸고 앞뒤 공백을 지운다", () => {
    expect(quoteApicalypse("  zelda\n\tbreath  ")).toBe('"zelda  breath"');
  });

  it("너무 길면 100자로 자른다", () => {
    expect(quoteApicalypse("가".repeat(300))).toBe(`"${"가".repeat(100)}"`);
  });

  it("질의를 바꾸려는 입력이 따옴표 밖으로 나가지 못한다", () => {
    const quoted = quoteApicalypse('x"; where id = 1; fields *; "');
    // 이스케이프되지 않은 큰따옴표는 양 끝의 두 개뿐이다.
    expect(quoted.replace(/\\"/g, "").match(/"/g)).toHaveLength(2);
    expect(quoted).toBe('"x\\"; where id = 1; fields *; \\""');
  });
});

describe("search", () => {
  it("검색어·필드·게임 종류·페이지 범위로 질의를 만든다", async () => {
    const { client, query } = fakeClient();
    await createGameSource(client).search("zelda");
    expect(query).toHaveBeenCalledWith("games", expect.any(String));
    const body = bodyOf(query);
    expect(body).toContain('search "zelda";');
    expect(body).toContain(`fields ${IGDB_FIELDS};`);
    expect(body).toContain("where game_type = (0,4,8,9,10);"); // DLC·번들·모드는 검색에서 뺀다
    expect(body).toContain("limit 20; offset 0;");
  });

  it.each([
    ["빈 문자열", ""],
    ["공백", "   "],
    ["제어 문자만", "\n\t"],
  ])("검색어가 비어 있으면 IGDB를 부르지 않는다: %s", async (_name, text) => {
    const { client, query } = fakeClient();
    await expect(createGameSource(client).search(text)).resolves.toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });

  it.each([
    [{ limit: 1000 }, "limit 50; offset 0;"],
    [{ limit: 0 }, "limit 1; offset 0;"],
    [{ limit: 7.9, offset: -5 }, "limit 7; offset 0;"],
    [{ limit: Number.NaN, offset: Number.NaN }, "limit 20; offset 0;"],
    [{ offset: 40 }, "limit 20; offset 40;"],
    [{ offset: 999_999 }, "limit 20; offset 10000;"],
  ])("limit·offset은 범위로 고정한다: %j", async (options, expected) => {
    const { client, query } = fakeClient();
    await createGameSource(client).search("x", options);
    expect(bodyOf(query)).toContain(expected);
  });

  it("결과를 내부 모델로 바꾸고 이름 없는 항목은 버린다", async () => {
    const { client } = fakeClient([
      { id: 1, name: "Game One", slug: "game-one" },
      { id: 2 },
      { id: 3, name: "  ", slug: "blank" },
    ]);
    const drafts = await createGameSource(client).search("game");
    expect(drafts.map((d) => [d.igdbId, d.title])).toEqual([[1, "Game One"]]);
  });
});

describe("get", () => {
  it("ID로 한 게임을 가져와 내부 모델로 돌려준다", async () => {
    const { client, query } = fakeClient([{ id: 119133, name: "Some Game", slug: "some-game" }]);
    const draft = await createGameSource(client).get(119133);
    expect(bodyOf(query)).toContain("where id = 119133;");
    expect(draft).toMatchObject({ igdbId: 119133, title: "Some Game", slug: "some-game" });
  });

  it("없으면 null이다", async () => {
    const { client } = fakeClient([]);
    await expect(createGameSource(client).get(5)).resolves.toBeNull();
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 60])("올바르지 않은 ID(%s)는 IGDB를 부르지 않고 null이다", async (id) => {
    const { client, query } = fakeClient([{ id: 1, name: "x" }]);
    await expect(createGameSource(client).get(id)).resolves.toBeNull();
    expect(query).not.toHaveBeenCalled();
  });
});

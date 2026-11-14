import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { LIBRARY_SORTS, decodeLibraryCursor, encodeLibraryCursor, isLibraryFilter, isLibrarySort, type LibrarySort } from "@/features/library/library";

const ID = randomUUID();
const raw = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

/** 정렬마다 실제로 DB가 낼 법한 키. */
const KEYS: Record<LibrarySort, string> = {
  added: "2026-11-14 07:21:34.123456+00",
  played: "2026-05-01",
  cleared: "1970-01-01",
  rating: "8",
  title: "엘든 링 'elden' ring; drop table",
};

describe("라이브러리 커서", () => {
  it.each(LIBRARY_SORTS)("%s 정렬의 커서를 그대로 해석한다", (sort) => {
    expect(decodeLibraryCursor(encodeLibraryCursor(KEYS[sort], ID), sort)).toEqual({ key: KEYS[sort], id: ID });
  });

  it("시각 키는 소수 초가 없거나 +09:00 같은 오프셋이어도 받는다", () => {
    for (const key of ["2026-11-14 07:21:34+00", "2026-11-14 16:21:34.5+09", "2026-11-14 16:21:34.123456+09:00"]) {
      expect(decodeLibraryCursor(encodeLibraryCursor(key, ID), "added"), key).toEqual({ key, id: ID });
    }
  });

  it.each([
    ["빈 값", ""],
    ["null", null],
    ["undefined", undefined],
    ["base64가 아닌 값", "%%%"],
    ["JSON이 아닌 값", Buffer.from("not json").toString("base64url")],
    ["배열이 아닌 JSON", raw({ key: "x" })],
    ["키 타입이 다름", raw([5, ID])],
    ["id 타입이 다름", raw(["2026-05-01", 5])],
    ["uuid가 아닌 id", raw(["2026-05-01", "not-a-uuid"])],
    ["너무 긴 값", "a".repeat(800)],
  ])("올바르지 않은 커서는 null이다(첫 페이지로 취급): %s", (_name, value) => {
    for (const sort of LIBRARY_SORTS) expect(decodeLibraryCursor(value as string | null | undefined, sort)).toBeNull();
  });

  it("정렬과 맞지 않는 키는 거절한다(다른 정렬의 커서를 가져온 경우)", () => {
    expect(decodeLibraryCursor(encodeLibraryCursor(KEYS.added, ID), "played")).toBeNull();
    expect(decodeLibraryCursor(encodeLibraryCursor(KEYS.played, ID), "added")).toBeNull();
    expect(decodeLibraryCursor(encodeLibraryCursor(KEYS.played, ID), "rating")).toBeNull();
    expect(decodeLibraryCursor(encodeLibraryCursor(KEYS.rating, ID), "cleared")).toBeNull();
  });

  it.each([
    ["없는 날짜", "2026-13-45"],
    ["SQL을 흉내 낸 값", "2026-05-01'; drop table user_games;--"],
    ["날짜 뒤에 덧붙인 값", "2026-05-01 00:00:00"],
  ])("날짜 정렬 커서는 형식과 실제 날짜를 모두 본다: %s", (_name, key) => {
    expect(decodeLibraryCursor(encodeLibraryCursor(key, ID), "played")).toBeNull();
    expect(decodeLibraryCursor(encodeLibraryCursor(key, ID), "cleared")).toBeNull();
  });

  it.each([["abc"], ["100"], ["-1"], ["1.5"]])("평점 정렬 커서는 0–99 정수만 받는다: %s", (key) => {
    expect(decodeLibraryCursor(encodeLibraryCursor(key, ID), "rating")).toBeNull();
  });

  it("긴 한글 제목도 커서가 버려지지 않는다(버려지면 `더 보기`가 첫 페이지를 다시 보여 준다)", () => {
    // 게임 제목은 최대 200자이고 한글은 글자당 3바이트라 base64 커서가 700자를 훌쩍 넘는다.
    for (const key of ["가".repeat(200), "🎮".repeat(200)]) {
      const cursor = encodeLibraryCursor(key, ID);
      expect(cursor.length, `${key.length}자 제목의 커서 길이`).toBeGreaterThan(700);
      expect(decodeLibraryCursor(cursor, "title")).toEqual({ key, id: ID });
    }
  });

  it("제목 정렬 커서는 어떤 글자든 받지만 400자까지다(값은 항상 매개변수로 쓰인다)", () => {
    expect(decodeLibraryCursor(encodeLibraryCursor("가".repeat(400), ID), "title")).not.toBeNull();
    expect(decodeLibraryCursor(encodeLibraryCursor("가".repeat(401), ID), "title")).toBeNull();
  });
});

describe("정렬·필터 값", () => {
  it("정렬은 목록에 있는 값만 받는다", () => {
    for (const sort of LIBRARY_SORTS) expect(isLibrarySort(sort)).toBe(true);
    for (const bad of ["", "ADDED", "added; drop", "id", null, undefined, 3]) expect(isLibrarySort(bad), String(bad)).toBe(false);
  });

  it("필터는 7가지 상태와 all·unset·rated만 받는다", () => {
    for (const ok of ["all", "unset", "rated", "interested", "planned", "playing", "paused", "cleared", "perfected", "dropped"]) expect(isLibraryFilter(ok), ok).toBe(true);
    for (const bad of ["", "PLAYING", "reviewed", "finished", null, undefined, 1]) expect(isLibraryFilter(bad), String(bad)).toBe(false);
  });
});

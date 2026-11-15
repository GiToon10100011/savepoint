import { describe, expect, it } from "vitest";
import { parseReviewForm } from "@/features/reviews/review-form";
import { MAX_REVIEW_LENGTH } from "@/lib/review";

const form = (entries: Record<string, string | File>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
};

const valid = { body: "엔딩까지 재미있게 했어요.", visibility: "public" };

describe("parseReviewForm", () => {
  it("올바른 값은 그대로 받는다(스포일러 체크 상자가 없으면 false)", () => {
    expect(parseReviewForm(form(valid))).toEqual({
      ok: true,
      data: { body: "엔딩까지 재미있게 했어요.", hasSpoiler: false, visibility: "public" },
      values: { body: "엔딩까지 재미있게 했어요.", hasSpoiler: false, visibility: "public" },
    });
  });

  it("체크 상자는 `on`일 때만 스포일러다", () => {
    expect(parseReviewForm(form({ ...valid, hasSpoiler: "on" }))).toMatchObject({ ok: true, data: { hasSpoiler: true } });
    for (const other of ["", "true", "1", "off", "ON"]) {
      expect(parseReviewForm(form({ ...valid, hasSpoiler: other })), other).toMatchObject({ ok: true, data: { hasSpoiler: false } });
    }
  });

  it("공개 범위는 public·private만 받는다", () => {
    expect(parseReviewForm(form({ ...valid, visibility: "private" }))).toMatchObject({ ok: true, data: { visibility: "private" } });
    for (const bad of ["", "friends", "PUBLIC", "public ", "0"]) {
      const result = parseReviewForm(form({ ...valid, visibility: bad }));
      expect(result, JSON.stringify(bad)).toMatchObject({ ok: false, errors: { visibility: "공개 범위를 골라 주세요." } });
    }
  });

  it("공개 범위가 아예 없으면 공개로 가정하지 않고 거절한다", () => {
    const data = new FormData();
    data.set("body", valid.body);
    expect(parseReviewForm(data)).toMatchObject({ ok: false, errors: { visibility: "공개 범위를 골라 주세요." } });
  });

  it("본문의 앞뒤 공백을 자르고 줄바꿈을 `\\n`으로 통일한다(안쪽 줄바꿈은 지키되 CRLF·CR도 한 줄바꿈으로 센다)", () => {
    const result = parseReviewForm(form({ ...valid, body: "  첫 줄\r\n둘째 줄\r셋째 줄\n\n  " }));
    expect(result).toMatchObject({ ok: true, data: { body: "첫 줄\n둘째 줄\n셋째 줄" } });
  });

  it.each([
    ["빈 값", ""],
    ["공백만", "   "],
    ["줄바꿈만", "\n\r\n\t "],
  ])("본문이 비어 있으면 거절한다: %s", (_name, body) => {
    expect(parseReviewForm(form({ ...valid, body }))).toMatchObject({ ok: false, errors: { body: "리뷰 내용을 입력해 주세요." } });
  });

  it("본문이 없는 폼도 거절한다", () => {
    const data = new FormData();
    data.set("visibility", "public");
    expect(parseReviewForm(data)).toMatchObject({ ok: false, errors: { body: "리뷰 내용을 입력해 주세요." } });
  });

  it("파일이 들어와도 글이 아니라서 빈 본문으로 본다", () => {
    expect(parseReviewForm(form({ ...valid, body: new File(["x"], "x.txt") }))).toMatchObject({ ok: false, errors: { body: "리뷰 내용을 입력해 주세요." } });
  });

  it("글자 수는 5,000자까지다(경계: 5,000자는 받고 5,001자는 거절)", () => {
    expect(parseReviewForm(form({ ...valid, body: "가".repeat(MAX_REVIEW_LENGTH) })).ok).toBe(true);
    const over = parseReviewForm(form({ ...valid, body: "가".repeat(MAX_REVIEW_LENGTH + 1) }));
    expect(over).toMatchObject({ ok: false, errors: { body: "리뷰는 5,000자까지 쓸 수 있어요. (지금 5,001자)" } });
  });

  it("글자 수는 UTF-16 칸이 아니라 글자 단위다(이모지 5,000개는 받는다)", () => {
    expect(parseReviewForm(form({ ...valid, body: "🎮".repeat(MAX_REVIEW_LENGTH) })).ok).toBe(true);
    expect(parseReviewForm(form({ ...valid, body: "🎮".repeat(MAX_REVIEW_LENGTH + 1) })).ok).toBe(false);
  });

  it("글자 수는 CRLF가 두 칸으로 세어지지 않게 통일한 뒤 센다", () => {
    // 줄바꿈이 CRLF이면 그대로 셀 때 한도를 넘지만, 한 줄바꿈으로 세면 정확히 한도다.
    const body = `${"가".repeat(MAX_REVIEW_LENGTH - 2)}\r\n가`;
    expect(parseReviewForm(form({ ...valid, body })).ok).toBe(true);
  });

  it("오류가 나도 입력한 값을 돌려줘 폼을 다시 채울 수 있다(둘 다 틀려도 오류는 각각 낸다)", () => {
    const result = parseReviewForm(form({ body: "  ", visibility: "x", hasSpoiler: "on" }));
    expect(result).toEqual({
      ok: false,
      errors: { body: "리뷰 내용을 입력해 주세요.", visibility: "공개 범위를 골라 주세요." },
      values: { body: "", hasSpoiler: true, visibility: "x" },
    });
  });

  it("본문에 든 HTML·SQL 조각은 값으로만 다룬다(그대로 돌려준다)", () => {
    const body = "<script>alert(1)</script> '; drop table game_reviews;--";
    expect(parseReviewForm(form({ ...valid, body }))).toMatchObject({ ok: true, data: { body } });
  });
});

import { describe, expect, it } from "vitest";
import { formatKoreanDate } from "@/lib/format-date";

describe("formatKoreanDate", () => {
  it("한국 날짜 YYYY.MM.DD로 보여 준다", () => {
    expect(formatKoreanDate("2026-11-15T03:00:00.000Z")).toBe("2026.11.15");
    expect(formatKoreanDate("2026-01-05T03:00:00Z")).toBe("2026.01.05"); // 한 자리 월·일은 0으로 채운다
  });

  it("기준은 Asia/Seoul이다: UTC로는 전날인 한국 오전 시간이 한국 날짜로 보인다", () => {
    // 2026-11-14 15:00Z = 한국 2026-11-15 00:00. UTC 날짜로 자르면 하루 전(14일)으로 틀린다.
    expect(formatKoreanDate("2026-11-14T15:00:00Z")).toBe("2026.11.15");
    expect(formatKoreanDate("2026-11-14T14:59:59.999Z")).toBe("2026.11.14");
  });

  it("해와 달이 바뀌는 경계도 한국 기준이다", () => {
    expect(formatKoreanDate("2026-12-31T15:00:00Z")).toBe("2027.01.01");
    expect(formatKoreanDate("2024-02-28T15:00:00Z")).toBe("2024.02.29"); // 윤년
  });

  it("오프셋이 붙은 시각도 같은 순간이면 같은 날짜다", () => {
    expect(formatKoreanDate("2026-11-15T00:00:00+09:00")).toBe("2026.11.15");
    expect(formatKoreanDate("2026-11-14T10:00:00-05:00")).toBe("2026.11.15"); // = 15:00Z
  });

  it("올바르지 않은 시각은 오류다(조용히 틀린 날짜를 보여 주지 않는다)", () => {
    expect(() => formatKoreanDate("not a date")).toThrow(RangeError);
  });
});

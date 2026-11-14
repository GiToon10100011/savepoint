import { describe, expect, it } from "vitest";
import {
  averageLabel,
  averageTenths,
  clampStars,
  formatAverage,
  formatStars,
  isValidStars,
  nextStars,
  starFill,
  starsFromPointer,
  starsLabel,
  starsToStored,
  storedToStars,
} from "@/lib/rating";

describe("저장값 변환", () => {
  it("3.5점은 7로 저장한다 (REA에서 확인한 값)", () => {
    expect(starsToStored(3.5)).toBe(7);
    expect(storedToStars(7)).toBe(3.5);
  });

  it("0.5 단위 전체(1–10)에서 왕복해도 같다", () => {
    for (let stored = 1; stored <= 10; stored += 1) {
      expect(starsToStored(storedToStars(stored))).toBe(stored);
    }
  });

  it("범위나 단위가 틀리면 거부한다", () => {
    for (const bad of [0, 0.25, 5.5, -1, Number.NaN, Infinity]) {
      expect(isValidStars(bad)).toBe(false);
      expect(() => starsToStored(bad)).toThrow(RangeError);
    }
    for (const bad of [0, 11, 3.5, Number.NaN]) {
      expect(() => storedToStars(bad)).toThrow(RangeError);
    }
  });
});

describe("clampStars", () => {
  it("가장 가까운 0.5 단위로 맞추고 범위 안으로 가둔다", () => {
    expect(clampStars(3.2)).toBe(3);
    expect(clampStars(3.3)).toBe(3.5);
    expect(clampStars(0)).toBe(0.5);
    expect(clampStars(9)).toBe(5);
  });
});

describe("starFill", () => {
  it("3.5점이면 별 3개가 차고 4번째는 반만 찬다", () => {
    expect([0, 1, 2, 3, 4].map((i) => starFill(i, 3.5))).toEqual([1, 1, 1, 0.5, 0]);
  });

  it("평가하지 않았으면 모두 비어 있다", () => {
    expect([0, 1, 2, 3, 4].map((i) => starFill(i, null))).toEqual([0, 0, 0, 0, 0]);
  });

  it("0.5점은 첫 별의 반만 찬다", () => {
    expect([0, 1].map((i) => starFill(i, 0.5))).toEqual([0.5, 0]);
  });
});

describe("starsFromPointer", () => {
  it("별의 왼쪽 절반은 x.5, 오른쪽 절반은 정수다 (4번째 별 왼쪽 → 3.5)", () => {
    expect(starsFromPointer(3, true)).toBe(3.5);
    expect(starsFromPointer(3, false)).toBe(4);
    expect(starsFromPointer(0, true)).toBe(0.5);
    expect(starsFromPointer(4, false)).toBe(5);
  });
});

describe("nextStars (키보드)", () => {
  it("오른쪽/위로 0.5씩 올리고 5에서 멈춘다", () => {
    expect(nextStars(3, "ArrowRight")).toBe(3.5);
    expect(nextStars(3, "ArrowUp")).toBe(3.5);
    expect(nextStars(5, "ArrowRight")).toBe(5);
  });

  it("평가하지 않은 상태에서 올리면 0.5부터 시작한다", () => {
    expect(nextStars(null, "ArrowRight")).toBe(0.5);
  });

  it("왼쪽/아래로 내려도 0.5 아래로는 가지 않는다(취소는 Delete)", () => {
    expect(nextStars(1, "ArrowLeft")).toBe(0.5);
    expect(nextStars(0.5, "ArrowLeft")).toBe(0.5);
    expect(nextStars(null, "ArrowLeft")).toBeNull();
  });

  it("Home/End/PageUp/PageDown", () => {
    expect(nextStars(3, "Home")).toBe(0.5);
    expect(nextStars(3, "End")).toBe(5);
    expect(nextStars(3, "PageUp")).toBe(4);
    expect(nextStars(3, "PageDown")).toBe(2);
    expect(nextStars(0.5, "PageDown")).toBe(0.5);
  });

  it("숫자 1–5는 정수 별점이다", () => {
    expect(nextStars(null, "4")).toBe(4);
    expect(nextStars(null, "0")).toBeUndefined();
    expect(nextStars(null, "6")).toBeUndefined();
  });

  it("Delete·Backspace는 평가를 취소한다", () => {
    expect(nextStars(3.5, "Delete")).toBeNull();
    expect(nextStars(3.5, "Backspace")).toBeNull();
  });

  it("처리하지 않는 키는 undefined다(preventDefault를 하지 않기 위해)", () => {
    expect(nextStars(3, "Tab")).toBeUndefined();
    expect(nextStars(3, "a")).toBeUndefined();
  });
});

describe("표시", () => {
  it("숫자와 스크린리더 문구", () => {
    expect(formatStars(3.5)).toBe("3.5");
    expect(formatStars(4)).toBe("4.0");
    expect(formatStars(null)).toBe("—");
    expect(starsLabel(3.5)).toBe("3.5점");
    expect(starsLabel(null)).toBe("평가하지 않음");
  });
});

describe("평균 평점", () => {
  // `games.rating_sum`은 저장값(1–10)의 합이라 평균 별점 = sum / count / 2 이다.
  it("0.1 단위로 반올림한다(소수 둘째 자리가 정확히 5면 올린다)", () => {
    expect(averageTenths(17, 4)).toBe(21); // 2.125 → 2.1
    expect(averageTenths(9, 2)).toBe(23); // 2.25 → 2.3
    expect(averageTenths(7, 2)).toBe(18); // 1.75 → 1.8
    expect(averageTenths(5, 2)).toBe(13); // 1.25 → 1.3
  });

  it("한 명의 평가는 그대로다(0.5 단위의 양 끝도 포함)", () => {
    expect(averageTenths(1, 1)).toBe(5); // 0.5점
    expect(averageTenths(7, 1)).toBe(35); // 3.5점
    expect(averageTenths(10, 1)).toBe(50); // 5.0점
  });

  it("평가가 없으면 null이다", () => {
    expect(averageTenths(0, 0)).toBeNull();
    expect(formatAverage(0, 0)).toBeNull();
    expect(averageLabel(0, 0)).toBeNull();
  });

  it("`4.2 (1,234)` 형식으로 보여 준다", () => {
    expect(formatAverage(5_183, 1_234)).toBe("2.1 (1,234)");
    expect(formatAverage(10, 1)).toBe("5.0 (1)");
    expect(formatAverage(84_000, 20_000)).toBe("2.1 (20,000)");
    expect(formatAverage(2_147_483_647, 2_147_483_647)).toBe("0.5 (2,147,483,647)"); // 모두 최저점(int 최대 개수)
  });

  it("스크린리더용 문구", () => {
    expect(averageLabel(5_183, 1_234)).toBe("평균 2.1점, 1,234명이 평가");
  });

  it.each([
    ["음수 개수", -1, -1],
    ["정수가 아닌 개수", 3, 1.5],
    ["개수보다 작은 합(최소 점수 1 미만)", 1, 2],
    ["개수 × 10보다 큰 합(최대 점수 10 초과)", 21, 2],
    ["평가가 없는데 합이 있음", 5, 0],
    ["NaN", Number.NaN, 1],
  ])("카운터가 어긋난 값은 거부한다: %s", (_name, sum, count) => {
    expect(() => averageTenths(sum, count)).toThrow(RangeError);
  });
});

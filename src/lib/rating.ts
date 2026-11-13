/**
 * 별점 로직. UI와 분리해 테스트할 수 있게 순수 함수로 둔다.
 *
 * 별점은 0.5 단위(0.5–5.0)이고 DB에는 정수 1–10(별점 × 2)으로 저장한다.
 * 왓챠피디아에서 확인한 저장값은 3.5점 → 7 한 건이며, 이 변환은 SavePoint의 설계 결정이다.
 */

export const MIN_STARS = 0.5;
export const MAX_STARS = 5;
export const STAR_COUNT = 5;
const STEP = 0.5;

export type Stars = number;

export function isValidStars(value: number): boolean {
  return Number.isFinite(value) && value >= MIN_STARS && value <= MAX_STARS && Number.isInteger(value * 2);
}

/** 별점(0.5 단위)을 저장값(정수 1–10)으로 바꾼다. */
export function starsToStored(stars: Stars): number {
  if (!isValidStars(stars)) throw new RangeError(`invalid stars: ${stars}`);
  return stars * 2;
}

/** 저장값(정수 1–10)을 별점으로 되돌린다. */
export function storedToStars(stored: number): Stars {
  if (!Number.isInteger(stored) || stored < 1 || stored > 10) {
    throw new RangeError(`invalid stored rating: ${stored}`);
  }
  return stored / 2;
}

/** 임의의 숫자를 가장 가까운 0.5 단위로 맞추고 범위 안으로 가둔다. */
export function clampStars(value: number): Stars {
  const rounded = Math.round(value / STEP) * STEP;
  return Math.min(MAX_STARS, Math.max(MIN_STARS, rounded));
}

/** `index`번째(0부터) 별이 얼마나 채워지는지: 0, 0.5, 1. */
export function starFill(index: number, value: Stars | null): 0 | 0.5 | 1 {
  if (value === null) return 0;
  const filled = value - index;
  if (filled >= 1) return 1;
  if (filled >= 0.5) return 0.5;
  return 0;
}

/** 별의 왼쪽 절반을 누르면 x.5, 오른쪽 절반을 누르면 정수 별점이다. */
export function starsFromPointer(index: number, isLeftHalf: boolean): Stars {
  return clampStars(index + (isLeftHalf ? 0.5 : 1));
}

const INCREASE = new Set(["ArrowRight", "ArrowUp"]);
const DECREASE = new Set(["ArrowLeft", "ArrowDown"]);

/**
 * 키보드 입력에 따른 다음 값. 처리하지 않는 키는 `undefined`를 돌려줘서 호출한 쪽이
 * `preventDefault`를 하지 않게 한다. 평가 취소는 `Delete`·`Backspace`(→ null)다.
 */
export function nextStars(value: Stars | null, key: string): Stars | null | undefined {
  if (INCREASE.has(key)) return value === null ? MIN_STARS : clampStars(value + STEP);
  if (DECREASE.has(key)) return value === null ? null : clampStars(value - STEP);
  if (key === "PageUp") return value === null ? 1 : clampStars(value + 1);
  if (key === "PageDown") return value === null ? null : clampStars(value - 1);
  if (key === "Home") return MIN_STARS;
  if (key === "End") return MAX_STARS;
  if (key === "Delete" || key === "Backspace") return null;
  if (/^[1-5]$/.test(key)) return Number(key);
  return undefined;
}

/** 화면에 표시하는 숫자. 평가하지 않았으면 대시를 쓴다. */
export function formatStars(value: Stars | null): string {
  return value === null ? "—" : value.toFixed(1);
}

/** 스크린리더용 값 설명. */
export function starsLabel(value: Stars | null): string {
  return value === null ? "평가하지 않음" : `${formatStars(value)}점`;
}

/**
 * 평균 별점을 0.1 단위 정수(4.2점 → 42)로 돌려준다. 평가가 없으면 null.
 * `sum`은 `games.rating_sum`(저장값 1–10의 합)이라 평균 별점은 sum / count / 2 다. 부동소수점 오차 없이
 * 소수 둘째 자리가 정확히 5일 때 올리도록(half-up) 정수로만 계산한다.
 * 카운터는 트리거가 유지하므로, 있을 수 없는 조합(합이 개수 × 1–10을 벗어남)은 조용히 보여 주지 않고 거부한다.
 */
export function averageTenths(sum: number, count: number): number | null {
  if (!Number.isInteger(count) || !Number.isInteger(sum) || count < 0) {
    throw new RangeError(`invalid rating counters: sum=${sum}, count=${count}`);
  }
  if (count === 0) {
    if (sum !== 0) throw new RangeError(`invalid rating counters: sum=${sum}, count=0`);
    return null;
  }
  if (sum < count || sum > count * 10) throw new RangeError(`invalid rating counters: sum=${sum}, count=${count}`);
  return Math.floor((sum * 10 + count) / (count * 2));
}

const COUNT_FORMAT = new Intl.NumberFormat("en-US");

/** `4.2 (1,234)`. 평가가 없으면 null이라 호출한 쪽이 "아직 평가가 없어요" 같은 문구를 정한다. */
export function formatAverage(sum: number, count: number): string | null {
  const tenths = averageTenths(sum, count);
  return tenths === null ? null : `${(tenths / 10).toFixed(1)} (${COUNT_FORMAT.format(count)})`;
}

/** 스크린리더용 평균 평점 설명. 평가가 없으면 null. */
export function averageLabel(sum: number, count: number): string | null {
  const tenths = averageTenths(sum, count);
  return tenths === null ? null : `평균 ${(tenths / 10).toFixed(1)}점, ${COUNT_FORMAT.format(count)}명이 평가`;
}

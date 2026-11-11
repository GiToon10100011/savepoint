/**
 * 달력 날짜 계산. 시간대·일광절약시간의 영향을 받지 않도록 모든 계산을 UTC로 한다.
 * 날짜는 `YYYY-MM-DD` 문자열(DateKey)로 주고받는다.
 */

export type DateKey = string;

export type GridCell = { key: DateKey; day: number } | null;

const pad = (n: number) => String(n).padStart(2, "0");

export function toDateKey(year: number, month: number, day: number): DateKey {
  return `${year}-${pad(month)}-${pad(day)}`;
}

export function parseDateKey(key: DateKey): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) throw new RangeError(`invalid date key: ${key}`);
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  // 2월 30일 같은 값을 거른다.
  if (toDateKey(...fromUtc(Date.UTC(year, month - 1, day))) !== key) {
    throw new RangeError(`invalid date key: ${key}`);
  }
  return { year, month, day };
}

function fromUtc(ms: number): [number, number, number] {
  const d = new Date(ms);
  return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()];
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** 0 = 일요일 … 6 = 토요일 */
export function weekdayOf(key: DateKey): number {
  const { year, month, day } = parseDateKey(key);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function addDays(key: DateKey, delta: number): DateKey {
  const { year, month, day } = parseDateKey(key);
  return toDateKey(...fromUtc(Date.UTC(year, month - 1, day + delta)));
}

export function addMonths(year: number, month: number, delta: number): { year: number; month: number } {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

export function monthOf(key: DateKey): { year: number; month: number } {
  const { year, month } = parseDateKey(key);
  return { year, month };
}

/** 다른 달로 옮길 때 일(day)이 그 달 길이를 넘지 않게 맞춘다 (1월 31일 → 2월 28일). */
export function clampDayToMonth(year: number, month: number, day: number): number {
  return Math.min(day, daysInMonth(year, month));
}

/** 일요일 시작 주 단위 격자. 달 밖의 칸은 null이다. 4–6주가 나온다. */
export function buildMonthGrid(year: number, month: number): GridCell[][] {
  const lead = weekdayOf(toDateKey(year, month, 1));
  const cells: GridCell[] = Array.from({ length: lead }, () => null);
  for (let day = 1; day <= daysInMonth(year, month); day += 1) {
    cells.push({ key: toDateKey(year, month, day), day });
  }
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks: GridCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

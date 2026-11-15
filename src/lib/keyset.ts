/**
 * 날짜·시각 문자열이 DB 캐스트(`::date`, `::timestamptz`)를 통과할 값인지 본다. 폼 입력과 키셋 커서가 함께 쓴다.
 * 형식만 맞고 없는 값(`2026-02-30`, `25:00`)이면 쿼리가 `date/time field value out of range`로 실패해 요청이 오류로 끝난다.
 * JS `Date`는 없는 날짜를 다음 달로 밀어 받아들이고 0000년도 받지만 PostgreSQL은 거절하므로 `Date.parse`만으로는 부족하다.
 */

// DB가 받는 날짜 범위(`user_games_dates_range`와 같다). 이 범위 밖의 값은 DB에 있을 수 없다.
const MIN_DATE = "1970-01-01";
const MAX_DATE = "2100-12-31";

/** `YYYY-MM-DD` 형식이고 실제로 있는 날짜이며 DB가 받는 범위 안인가. */
export function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value && value >= MIN_DATE && value <= MAX_DATE;
}

const TIMESTAMP = /^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?[+-](\d{2})(?::(\d{2}))?$/;

/**
 * 시각 키가 형식뿐 아니라 실제 날짜·시각인가. PostgreSQL이 내는 값(시 0–23, 분·초 0–59, 오프셋 ±15:59)만 받는다.
 * 시각은 JS `Date`가 마이크로초를 잃으므로 DB가 낸 텍스트(`2026-11-14 07:21:34.123456+00`)를 그대로 주고받는다.
 */
export function isRealTimestamp(key: string): boolean {
  const match = TIMESTAMP.exec(key);
  if (!match) return false;
  const [, date, hour, minute, second, offsetHour, offsetMinute] = match;
  return isRealDate(date) && +hour <= 23 && +minute <= 59 && +second <= 59 && +offsetHour <= 15 && (offsetMinute === undefined || +offsetMinute <= 59);
}

const KOREA_DATE = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" });

/**
 * 시각(ISO 8601)을 한국 날짜 `2026.11.15`로 바꾼다. 서비스의 기준 시간대는 Asia/Seoul이라 서버·브라우저의 시간대와 상관없이
 * 같은 날짜가 나온다(UTC 기준으로 자르면 한국 오전 9시 전에 쓴 글이 하루 전 날짜로 보인다).
 */
export function formatKoreanDate(iso: string): string {
  const parts = Object.fromEntries(KOREA_DATE.formatToParts(new Date(iso)).map((part) => [part.type, part.value]));
  return `${parts.year}.${parts.month}.${parts.day}`;
}

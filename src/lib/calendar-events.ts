/**
 * 달력 이벤트 종류. 값은 DB의 `play_event_type` 열거형과 같다(라이브러리 등록은 피드용이라 달력에서는 쓰지 않는다).
 * 이벤트는 색만으로 구분하지 않는다: 글리프(모양) + 레이블이 항상 함께 나온다. 색은 `--event-*` 토큰이 정한다.
 */
export const CALENDAR_EVENT_TYPES = [
  "play_started",
  "ending_reached",
  "completed_100",
  "reviewed",
  "rated",
  "play_session",
] as const;

export type CalendarEventType = (typeof CALENDAR_EVENT_TYPES)[number];

export const CALENDAR_EVENT_META: Record<
  CalendarEventType,
  { label: string; short: string; cssVar: string }
> = {
  play_started: { label: "플레이 시작", short: "시작", cssVar: "--event-play-start" },
  ending_reached: { label: "엔딩 달성", short: "엔딩", cssVar: "--event-ending" },
  completed_100: { label: "100% 달성", short: "100%", cssVar: "--event-complete" },
  reviewed: { label: "리뷰 작성", short: "리뷰", cssVar: "--event-review" },
  rated: { label: "게임 평가", short: "평가", cssVar: "--event-rating" },
  play_session: { label: "플레이 기록", short: "기록", cssVar: "--event-session" },
};

/** 하루의 이벤트 종류별 건수. */
export type DayEvents = Partial<Record<CalendarEventType, number>>;

/** 이벤트가 있는 종류를 고정된 순서로 돌려준다(건수 0은 제외). */
export function presentEventTypes(events: DayEvents | undefined): CalendarEventType[] {
  return CALENDAR_EVENT_TYPES.filter((type) => (events?.[type] ?? 0) > 0);
}

export function totalEvents(events: DayEvents | undefined): number {
  return presentEventTypes(events).reduce((sum, type) => sum + (events?.[type] ?? 0), 0);
}

/** 스크린리더용 설명. 예: "엔딩 달성 1건, 게임 평가 2건" */
export function describeDayEvents(events: DayEvents | undefined): string {
  const types = presentEventTypes(events);
  if (types.length === 0) return "기록 없음";
  return types.map((type) => `${CALENDAR_EVENT_META[type].label} ${events?.[type]}건`).join(", ");
}

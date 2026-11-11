import type { ReactNode } from "react";
import { CALENDAR_EVENT_META, CALENDAR_EVENT_TYPES, type CalendarEventType } from "@/lib/calendar-events";
import { cn } from "@/lib/cn";

/**
 * 이벤트별 글리프. 색이 없어도 구분되도록 모양이 모두 다르다(직각 도형만 쓴다):
 * 시작=삼각형 외곽선, 엔딩=채운 사각형, 100%=채운 마름모, 리뷰=세 줄, 평가=별 외곽선, 기록=짧은 막대.
 */
const GLYPHS: Record<CalendarEventType, ReactNode> = {
  play_started: <path d="M7 5l11 7-11 7V5z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="miter" />,
  ending_reached: <rect x="6" y="6" width="12" height="12" fill="currentColor" />,
  completed_100: <path d="M12 3l9 9-9 9-9-9 9-9z" fill="currentColor" />,
  reviewed: <path d="M5 7h14M5 12h14M5 17h9" fill="none" stroke="currentColor" strokeWidth="2" />,
  rated: (
    <path
      d="M12 3l2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9-4.3-4.1 5.9-.8L12 3z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinejoin="miter"
    />
  ),
  play_session: <path d="M6 12h12" fill="none" stroke="currentColor" strokeWidth="3" />,
};

/** 글리프 하나. 색은 `--event-*` 토큰이 정하는 보조 수단이다(구분은 모양이 한다). 접근성 이름은 쓰는 쪽의 레이블이 맡는다. */
export function EventGlyph({ type, className }: { type: CalendarEventType; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={cn("h-3 w-3 shrink-0", className)}
      style={{ color: `var(${CALENDAR_EVENT_META[type].cssVar})` }}
    >
      {GLYPHS[type]}
    </svg>
  );
}

/** 글리프 + 레이블(+ 건수). 일별 기록 목록 등 공간이 넉넉한 곳에서 쓴다. */
export function CalendarEventMark({
  type,
  count,
  short = false,
}: {
  type: CalendarEventType;
  count?: number;
  /** true면 줄인 이름(시작·엔딩…)을 쓴다. */
  short?: boolean;
}) {
  const meta = CALENDAR_EVENT_META[type];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-normal">
      <EventGlyph type={type} />
      <span>{short ? meta.short : meta.label}</span>
      {count !== undefined ? <span className="type-mono">{count}</span> : null}
    </span>
  );
}

/** 범례. 이벤트를 색이 아니라 모양과 이름으로 구분할 수 있게 항상 함께 보여 준다. */
export function CalendarLegend() {
  return (
    <ul aria-label="이벤트 종류" className="flex flex-wrap gap-x-4 gap-y-2">
      {CALENDAR_EVENT_TYPES.map((type) => (
        <li key={type}>
          <CalendarEventMark type={type} />
        </li>
      ))}
    </ul>
  );
}

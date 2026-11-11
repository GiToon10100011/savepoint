"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import {
  addDays,
  addMonths,
  buildMonthGrid,
  clampDayToMonth,
  monthOf,
  parseDateKey,
  toDateKey,
  weekdayOf,
  type DateKey,
} from "@/lib/calendar";
import { describeDayEvents, presentEventTypes, totalEvents, type DayEvents } from "@/lib/calendar-events";
import { cn } from "@/lib/cn";
import { hasModifier } from "@/lib/keyboard";
import { EventGlyph } from "../calendar-event";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const MAX_GLYPHS = 3;

function Chevron({ direction }: { direction: "left" | "right" }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
      <path d={direction === "left" ? "M15 5l-7 7 7 7" : "M9 5l7 7-7 7"} strokeLinejoin="miter" />
    </svg>
  );
}

type CalendarHeaderProps = {
  year: number;
  month: number;
  onMonthChange: (year: number, month: number) => void;
  /** 있으면 `이번 달` 버튼을 보여 준다. */
  onToday?: () => void;
  /** 월 제목의 제목 수준. 달력이 다른 섹션 안에 들어가면 계층에 맞게 바꾼다. */
  headingLevel?: "h2" | "h3";
};

/** `← 2026년 11월 →` + 이번 달. 월 이동 버튼은 아이콘이라 접근 가능한 이름을 따로 둔다. */
export function CalendarHeader({ year, month, onMonthChange, onToday, headingLevel: Heading = "h2" }: CalendarHeaderProps) {
  const prev = addMonths(year, month, -1);
  const next = addMonths(year, month, 1);
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="sm" aria-label="이전 달" onClick={() => onMonthChange(prev.year, prev.month)}>
          <Chevron direction="left" />
        </Button>
        <Heading className="type-h3 min-w-32 text-center" aria-live="polite">
          {year}년 {month}월
        </Heading>
        <Button variant="ghost" size="sm" aria-label="다음 달" onClick={() => onMonthChange(next.year, next.month)}>
          <Chevron direction="right" />
        </Button>
      </div>
      {onToday ? (
        <Button variant="secondary" size="sm" onClick={onToday}>
          이번 달
        </Button>
      ) : null}
    </div>
  );
}

type CalendarGridProps = {
  year: number;
  /** 1–12 */
  month: number;
  /** 날짜(YYYY-MM-DD)별 이벤트 건수. 한 달 범위만 넘기면 된다. */
  events?: Record<DateKey, DayEvents>;
  selected?: DateKey | null;
  /** 오늘 날짜. 서버/클라이언트 시간대 차이로 어긋나지 않도록 호출하는 쪽이 정해서 넘긴다. */
  today?: DateKey;
  onSelect?: (key: DateKey) => void;
  onMonthChange?: (year: number, month: number) => void;
};

/**
 * 월간 달력(role="grid"). 키보드: ←→ ±1일, ↑↓ ±7일, Home/End 주의 처음·끝, PageUp/PageDown 이전·다음 달,
 * Enter/Space 선택. 한 번에 한 칸만 탭 순서에 들어간다(roving tabindex).
 * 이벤트는 색이 아니라 글리프로 나타내고, 각 칸의 접근 가능한 이름에 날짜와 이벤트 설명이 들어간다.
 */
export function CalendarGrid({ year, month, events = {}, selected = null, today, onSelect, onMonthChange }: CalendarGridProps) {
  const weeks = buildMonthGrid(year, month);
  const gridId = useId();
  const gridRef = useRef<HTMLDivElement>(null);
  const moveFocus = useRef(false);

  const inThisMonth = (key: DateKey) => {
    const m = monthOf(key);
    return m.year === year && m.month === month;
  };
  const [focusKey, setFocusKey] = useState<DateKey>(() => {
    if (selected && inThisMonth(selected)) return selected;
    if (today && inThisMonth(today)) return today;
    return toDateKey(year, month, 1);
  });
  // 달이 바뀌어 포커스 후보가 달 밖으로 나가면, 같은 일(day)을 새 달 안으로 맞춰 쓴다(상태를 고치지 않고 파생한다).
  const activeKey = inThisMonth(focusKey)
    ? focusKey
    : toDateKey(year, month, clampDayToMonth(year, month, parseDateKey(focusKey).day));

  // 키보드로 옮긴 직후에만 실제 포커스를 이동한다(사용자가 클릭하거나 다른 곳을 보는 중에는 빼앗지 않는다).
  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-date="${activeKey}"]`)?.focus();
  });

  function moveTo(target: DateKey) {
    moveFocus.current = true;
    setFocusKey(target);
    const m = monthOf(target);
    if ((m.year !== year || m.month !== month) && onMonthChange) onMonthChange(m.year, m.month);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    // Alt+←(뒤로 가기), Ctrl/Cmd+방향키 같은 브라우저·OS 단축키는 건드리지 않는다.
    if (hasModifier(event)) return;
    const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    let target: DateKey | null = null;
    if (event.key in step) target = addDays(activeKey, step[event.key]);
    else if (event.key === "Home") target = addDays(activeKey, -weekdayOf(activeKey));
    else if (event.key === "End") target = addDays(activeKey, 6 - weekdayOf(activeKey));
    else if (event.key === "PageUp" || event.key === "PageDown") {
      const m = addMonths(year, month, event.key === "PageUp" ? -1 : 1);
      target = toDateKey(m.year, m.month, clampDayToMonth(m.year, m.month, parseDateKey(activeKey).day));
    }
    if (!target) return;
    event.preventDefault();
    moveTo(target);
  }

  return (
    <div ref={gridRef} role="grid" aria-label={`${year}년 ${month}월 달력`} onKeyDown={handleKeyDown}>
      <div role="row" className="grid grid-cols-7">
        {WEEKDAYS.map((weekday) => (
          <div key={weekday} role="columnheader" className="py-2 text-center text-xs text-muted">
            {weekday}
          </div>
        ))}
      </div>
      {weeks.map((week, weekIndex) => (
        <div key={weekIndex} role="row" className="grid grid-cols-7">
          {week.map((cell, index) => {
            if (!cell) return <div key={`blank-${index}`} role="gridcell" aria-hidden="true" />;
            const dayEvents = events[cell.key];
            const types = presentEventTypes(dayEvents);
            const total = totalEvents(dayEvents);
            const isToday = cell.key === today;
            const isSelected = cell.key === selected;
            return (
              <div key={cell.key} role="gridcell" aria-selected={isSelected}>
                <button
                  type="button"
                  data-date={cell.key}
                  tabIndex={cell.key === activeKey ? 0 : -1}
                  // 이름 = 보이는 날짜 숫자 + 숨은 설명. 보이는 글자가 이름의 첫 단어로 들어가야 한다(WCAG 2.5.3).
                  aria-labelledby={`${gridId}-${cell.key}-n ${gridId}-${cell.key}-d`}
                  aria-current={isToday ? "date" : undefined}
                  // 포커스가 키보드 이동·클릭 외의 경로(프로그램, 음성 제어, 보조 기술)로 들어와도 기준 위치가 따라가게 한다.
                  onFocus={() => setFocusKey(cell.key)}
                  onClick={() => {
                    setFocusKey(cell.key);
                    onSelect?.(cell.key);
                  }}
                  className={cn(
                    "flex min-h-14 w-full cursor-pointer flex-col items-start gap-1 border p-1.5 text-left lg:min-h-20",
                    isSelected ? "border-ink" : "border-transparent hover:border-line-hover",
                  )}
                >
                  <span id={`${gridId}-${cell.key}-n`} className={cn("type-mono", isToday && "underline decoration-2 underline-offset-4")}>
                    {cell.day}
                  </span>
                  <span id={`${gridId}-${cell.key}-d`} className="sr-only">
                    일, {year}년 {month}월, {describeDayEvents(dayEvents)}
                  </span>
                  {types.length > 0 ? (
                    // 건수(+N, 총 건수)는 DOM 텍스트가 아니라 CSS 가상 요소로 그린다. 텍스트로 두면 "보이는 글자"가
                    // 날짜 숫자 + 건수가 되어 접근 가능한 이름에 통째로 들어가지 못한다(WCAG 2.5.3). 건수 정보는
                    // 이미 이름("게임 평가 2건")에 있으므로 스크린리더에는 중복되지 않는다.
                    <span
                      aria-hidden="true"
                      // `+1`은 글리프로 다 보여 주지 못한 종류 수, `×6`은 그날의 전체 건수다(구분자처럼 보이지 않게 ×를 붙인다).
                      data-extra={[types.length > MAX_GLYPHS ? `+${types.length - MAX_GLYPHS}` : null, total > 1 ? `×${total}` : null]
                        .filter(Boolean)
                        .join(" ")}
                      className="flex flex-wrap items-center gap-1 after:type-mono after:text-muted after:content-[attr(data-extra)]"
                    >
                      {types.slice(0, MAX_GLYPHS).map((type) => (
                        <EventGlyph key={type} type={type} />
                      ))}
                    </span>
                  ) : null}
                </button>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

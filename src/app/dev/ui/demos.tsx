"use client";

import { useState } from "react";
import { CalendarEventMark } from "@/components/calendar/calendar-event";
import { CalendarGrid, CalendarHeader } from "@/components/calendar/calendar-grid";
import { GameRating } from "@/components/game/game-rating";
import { GameStatusBadge, GameStatusPicker } from "@/components/game/game-status";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Chip } from "@/components/ui/chip";
import { Radio } from "@/components/ui/radio";
import { Tooltip } from "@/components/ui/tooltip";
import { parseDateKey, type DateKey } from "@/lib/calendar";
import { presentEventTypes, type DayEvents } from "@/lib/calendar-events";
import type { PlayStatus } from "@/lib/play-status";
import type { Stars } from "@/lib/rating";

/** 시간대에 따라 결과가 달라지지 않도록 데모는 날짜를 고정한다. */
const DEMO_TODAY: DateKey = "2026-11-10";

const DEMO_EVENTS: Record<DateKey, DayEvents> = {
  "2026-11-01": { play_started: 1 },
  "2026-11-03": { rated: 2 },
  "2026-11-08": { ending_reached: 1, rated: 1, reviewed: 1 },
  "2026-11-09": { play_session: 2, completed_100: 1 },
  "2026-11-10": { play_started: 1, rated: 3, reviewed: 1, ending_reached: 1 },
};

export function RatingDemo() {
  const [value, setValue] = useState<Stars | null>(null);
  return (
    <div data-testid="rating-demo" className="grid gap-6">
      <div>
        <p className="mb-2 text-sm font-semibold">선택 가능</p>
        <GameRating value={value} onChange={setValue} label="데모 별점" />
      </div>
      <div>
        <p className="mb-2 text-sm font-semibold">읽기 전용 (3.5)</p>
        <GameRating value={3.5} readOnly label="읽기 전용 별점" />
      </div>
    </div>
  );
}

const FILTERS = ["전체", "플레이 중", "엔딩 완료", "평가함"];

export function ChipDemo() {
  const [selected, setSelected] = useState("전체");
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="목록 필터">
      {FILTERS.map((filter) => (
        <Chip key={filter} selected={selected === filter} onClick={() => setSelected(filter)}>
          {filter}
        </Chip>
      ))}
    </div>
  );
}

export function StatusDemo() {
  const [status, setStatus] = useState<PlayStatus | null>("playing");
  return (
    <div data-testid="status-demo" className="grid gap-4 sm:grid-cols-2">
      <GameStatusPicker name="demo-status" value={status} onChange={setStatus} />
      <div>
        <p className="mb-2 text-sm font-semibold">현재 상태</p>
        <GameStatusBadge status={status} />
      </div>
    </div>
  );
}

export function CheckDemo() {
  const [platform, setPlatform] = useState("pc");
  return (
    <div className="grid gap-6 sm:grid-cols-2">
      <div className="grid">
        <Checkbox label="스포일러 포함" />
        <Checkbox label="비공개 리뷰" defaultChecked />
        <Checkbox label="비활성" disabled />
      </div>
      <fieldset className="m-0 grid border-0 p-0">
        <legend className="mb-1 p-0 text-sm font-semibold">플랫폼</legend>
        <Radio name="demo-platform" value="pc" label="PC" checked={platform === "pc"} onChange={() => setPlatform("pc")} />
        <Radio name="demo-platform" value="switch" label="Switch" checked={platform === "switch"} onChange={() => setPlatform("switch")} />
        <Radio name="demo-platform" value="ps5" label="PS5" checked={platform === "ps5"} onChange={() => setPlatform("ps5")} />
      </fieldset>
    </div>
  );
}

export function TooltipDemo() {
  return (
    <div className="pb-10">
      <Tooltip label="별점은 선택 즉시 저장됩니다">
        <Button variant="secondary">도움말</Button>
      </Tooltip>
    </div>
  );
}

/** 기록 달력 데모. 이벤트 색은 `--event-*` 토큰이 정한다(tokens.css). */
export function CalendarDemo() {
  const [view, setView] = useState({ year: 2026, month: 11 });
  const [selected, setSelected] = useState<DateKey | null>(null);
  const dayEvents = selected ? DEMO_EVENTS[selected] : undefined;
  const types = presentEventTypes(dayEvents);

  return (
    <div data-testid="calendar-demo" className="border border-line bg-card p-4">
      <CalendarHeader
        year={view.year}
        month={view.month}
        headingLevel="h3"
        onMonthChange={(year, month) => setView({ year, month })}
        onToday={() => setView({ year: 2026, month: 11 })}
      />
      <div className="mt-4">
        <CalendarGrid
          year={view.year}
          month={view.month}
          events={DEMO_EVENTS}
          today={DEMO_TODAY}
          selected={selected}
          onSelect={setSelected}
          onMonthChange={(year, month) => setView({ year, month })}
        />
      </div>
      <div className="mt-4 border-t border-line pt-4" aria-live="polite">
        {selected ? (
          <>
            <p className="text-sm font-semibold">
              {parseDateKey(selected).month}월 {parseDateKey(selected).day}일 · {types.length}종
            </p>
            {types.length > 0 ? (
              <ul className="mt-2 grid gap-1">
                {types.map((type) => (
                  <li key={type}>
                    <CalendarEventMark type={type} count={dayEvents?.[type]} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-muted">기록 없음</p>
            )}
          </>
        ) : (
          <p className="text-sm text-muted">날짜를 선택하면 그날의 기록이 보입니다.</p>
        )}
      </div>
    </div>
  );
}

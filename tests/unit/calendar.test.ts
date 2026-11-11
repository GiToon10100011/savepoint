import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  buildMonthGrid,
  clampDayToMonth,
  daysInMonth,
  monthOf,
  parseDateKey,
  toDateKey,
  weekdayOf,
} from "@/lib/calendar";
import {
  CALENDAR_EVENT_TYPES,
  describeDayEvents,
  presentEventTypes,
  totalEvents,
} from "@/lib/calendar-events";

describe("날짜 키", () => {
  it("만들고 파싱한다", () => {
    expect(toDateKey(2026, 11, 8)).toBe("2026-11-08");
    expect(parseDateKey("2026-11-08")).toEqual({ year: 2026, month: 11, day: 8 });
    expect(monthOf("2026-11-08")).toEqual({ year: 2026, month: 11 });
  });

  it("형식이나 실제 날짜가 틀리면 거부한다", () => {
    for (const bad of ["2026-1-8", "2026-02-30", "2026-13-01", "20261108", "", "2026-00-10"]) {
      expect(() => parseDateKey(bad)).toThrow(RangeError);
    }
  });
});

describe("달 길이와 요일", () => {
  it("윤년을 처리한다", () => {
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2100, 2)).toBe(28);
    expect(daysInMonth(2000, 2)).toBe(29);
  });

  it("알려진 요일과 맞다 (2026-11-01은 일요일, 2024-02-01은 목요일)", () => {
    expect(weekdayOf("2026-11-01")).toBe(0);
    expect(weekdayOf("2024-02-01")).toBe(4);
  });
});

describe("addDays / addMonths", () => {
  it("월말·연말을 넘긴다", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2027-01-01", -1)).toBe("2026-12-31");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2026-11-08", 7)).toBe("2026-11-15");
  });

  it("월 단위 이동은 연도를 넘긴다", () => {
    expect(addMonths(2026, 11, 1)).toEqual({ year: 2026, month: 12 });
    expect(addMonths(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
    expect(addMonths(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
    expect(addMonths(2026, 3, -15)).toEqual({ year: 2024, month: 12 });
  });

  it("다른 달로 옮길 때 일을 그 달 길이로 맞춘다", () => {
    expect(clampDayToMonth(2026, 2, 31)).toBe(28);
    expect(clampDayToMonth(2024, 2, 31)).toBe(29);
    expect(clampDayToMonth(2026, 11, 8)).toBe(8);
  });
});

describe("buildMonthGrid", () => {
  const days = (weeks: ReturnType<typeof buildMonthGrid>) => weeks.flat().filter(Boolean).length;

  it("2026년 11월: 일요일 시작이라 앞 빈 칸이 없고 5주다", () => {
    const weeks = buildMonthGrid(2026, 11);
    expect(weeks).toHaveLength(5);
    expect(weeks[0][0]).toEqual({ key: "2026-11-01", day: 1 });
    expect(weeks[4].filter(Boolean)).toHaveLength(2); // 29, 30
    expect(days(weeks)).toBe(30);
  });

  it("2024년 2월(윤년): 목요일 시작이라 앞에 빈 칸 4개, 29일", () => {
    const weeks = buildMonthGrid(2024, 2);
    expect(weeks[0].slice(0, 4)).toEqual([null, null, null, null]);
    expect(weeks[0][4]).toEqual({ key: "2024-02-01", day: 1 });
    expect(days(weeks)).toBe(29);
  });

  it("2026년 8월은 토요일 시작이라 6주다", () => {
    const weeks = buildMonthGrid(2026, 8);
    expect(weeks).toHaveLength(6);
    expect(days(weeks)).toBe(31);
  });

  it("모든 주는 7칸이고 날짜는 순서대로다", () => {
    for (const [year, month] of [[2026, 11], [2026, 2], [2025, 12], [2024, 2]]) {
      const weeks = buildMonthGrid(year, month);
      expect(weeks.every((week) => week.length === 7)).toBe(true);
      const keys = weeks.flat().flatMap((cell) => (cell ? [cell.key] : []));
      expect(keys).toEqual([...keys].sort());
    }
  });
});

describe("달력 이벤트", () => {
  it("요구된 6종이 정해진 순서로 있다", () => {
    expect(CALENDAR_EVENT_TYPES).toEqual([
      "play_started",
      "ending_reached",
      "completed_100",
      "reviewed",
      "rated",
      "play_session",
    ]);
  });

  it("있는 종류만 고정된 순서로 돌려준다(건수 0은 제외)", () => {
    expect(presentEventTypes({ rated: 2, ending_reached: 1, reviewed: 0 })).toEqual(["ending_reached", "rated"]);
    expect(presentEventTypes(undefined)).toEqual([]);
  });

  it("건수 합계와 스크린리더 설명", () => {
    expect(totalEvents({ rated: 2, ending_reached: 1 })).toBe(3);
    expect(describeDayEvents({ rated: 2, ending_reached: 1 })).toBe("엔딩 달성 1건, 게임 평가 2건");
    expect(describeDayEvents({})).toBe("기록 없음");
  });
});

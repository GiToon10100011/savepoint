import { describe, expect, it } from "vitest";
import { MAX_NOTE, MAX_PROGRESS_TEXT, isRealDate, parseEntryForm } from "@/features/library/entry-form";

function form(fields: Record<string, string> = {}) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

/** 오류가 하나도 없다고 단언하고 저장될 값을 돌려준다. */
function ok(fields: Record<string, string>) {
  const result = parseEntryForm(form(fields));
  if (!result.ok) throw new Error(`기대와 달리 오류: ${JSON.stringify(result.errors)}`);
  return result.data;
}

/** 오류가 나야 하는 입력에서 오류가 난 필드만 돌려준다. */
function errorsOf(fields: Record<string, string>) {
  const result = parseEntryForm(form(fields));
  if (result.ok) throw new Error("기대와 달리 통과했다");
  return Object.keys(result.errors);
}

describe("parseEntryForm", () => {
  it("아무것도 적지 않아도 통과하고 모두 비운 값이다(상태 미지정)", () => {
    expect(ok({})).toEqual({
      status: null, platformId: null, startedOn: null, clearedOn: null, perfectedOn: null,
      playtimeMinutes: null, progressPercent: null, progressText: null, note: null,
    });
  });

  it("모든 칸을 채우면 저장할 값으로 바뀐다(시간·분은 분으로 합친다)", () => {
    expect(
      ok({
        status: "cleared", platformId: "12", startedOn: "2026-05-01", clearedOn: "2026-05-20", perfectedOn: "2026-06-01",
        playtimeHours: "42", playtimeMinutes: "30", progressPercent: "100", progressText: " 엔딩 봄 ", note: "  다음엔 하드 모드\n두 번째 줄  ",
      }),
    ).toEqual({
      status: "cleared", platformId: 12, startedOn: "2026-05-01", clearedOn: "2026-05-20", perfectedOn: "2026-06-01",
      playtimeMinutes: 42 * 60 + 30, progressPercent: 100, progressText: "엔딩 봄", note: "다음엔 하드 모드\n두 번째 줄",
    });
  });

  it("문자열이 아닌 값(파일 등)은 빈 칸으로 본다", () => {
    const data = form();
    data.set("note", new Blob(["x"]), "x.txt");
    const result = parseEntryForm(data);
    expect(result.ok).toBe(true);
  });

  it("오류가 나도 입력한 값(다듬은 문자열)을 돌려줘 폼을 다시 채울 수 있다", () => {
    const result = parseEntryForm(form({ status: "bogus", progressText: "  남은 글  " }));
    expect(result.ok).toBe(false);
    expect(result.values).toMatchObject({ status: "bogus", progressText: "남은 글" });
  });

  describe("상태·플랫폼", () => {
    it.each(["interested", "planned", "playing", "paused", "cleared", "perfected", "dropped"])("상태 %s를 받는다", (status) => {
      expect(ok({ status }).status).toBe(status);
    });

    it.each(["finished", "PLAYING", "상태", "null"])("목록에 없는 상태(%s)는 거절한다", (status) => {
      expect(errorsOf({ status })).toEqual(["status"]);
    });

    it("플랫폼은 정수 ID만 받는다", () => {
      expect(ok({ platformId: "7" }).platformId).toBe(7);
      for (const platformId of ["abc", "-1", "1.5", "1e3", "1234567890"]) expect(errorsOf({ platformId }), platformId).toEqual(["platformId"]);
    });
  });

  describe("날짜", () => {
    it.each(["1970-01-01", "2100-12-31", "2024-02-29", "2026-05-01"])("%s는 받는다(경계·윤일 포함)", (value) => {
      expect(ok({ startedOn: value }).startedOn).toBe(value);
    });

    it.each(["1969-12-31", "2101-01-01", "2023-02-29", "2026-13-01", "2026-02-30", "2026/05/01", "20260501", "2026-5-1", "오늘", " "])(
      "%s는 거절하거나 빈 칸이다",
      (value) => {
        if (value.trim() === "") expect(ok({ startedOn: value }).startedOn).toBeNull();
        else expect(errorsOf({ startedOn: value })).toEqual(["startedOn"]);
      },
    );

    it("세 날짜 모두 같은 검사를 받는다", () => {
      expect(errorsOf({ startedOn: "x", clearedOn: "y", perfectedOn: "z" }).sort()).toEqual(["clearedOn", "perfectedOn", "startedOn"]);
    });

    it("엔딩 달성일이 시작일보다 앞서면 거절한다(같은 날은 괜찮다)", () => {
      expect(errorsOf({ startedOn: "2026-05-10", clearedOn: "2026-05-09" })).toEqual(["clearedOn"]);
      expect(ok({ startedOn: "2026-05-10", clearedOn: "2026-05-10" }).clearedOn).toBe("2026-05-10");
      expect(ok({ clearedOn: "2026-05-09" }).clearedOn).toBe("2026-05-09"); // 시작일이 없으면 비교하지 않는다
    });

    it("시작일 형식이 틀리면 엔딩일에 엉뚱한 선후 오류를 덧붙이지 않는다", () => {
      expect(errorsOf({ startedOn: "2026-13-40", clearedOn: "2026-05-09" })).toEqual(["startedOn"]);
    });

    it("isRealDate", () => {
      expect(isRealDate("2024-02-29")).toBe(true);
      expect(isRealDate("2023-02-29")).toBe(false);
      expect(isRealDate("")).toBe(false);
    });
  });

  describe("플레이 시간", () => {
    it.each([
      [{ playtimeHours: "2", playtimeMinutes: "30" }, 150],
      [{ playtimeHours: "3" }, 180],
      [{ playtimeMinutes: "45" }, 45],
      [{ playtimeHours: "0", playtimeMinutes: "0" }, 0],
      [{ playtimeHours: "16666", playtimeMinutes: "40" }, 1_000_000], // 상한 경계
    ])("%j → %d분", (fields, minutes) => {
      expect(ok(fields).playtimeMinutes).toBe(minutes);
    });

    it.each([
      ["상한을 넘음", { playtimeHours: "16666", playtimeMinutes: "41" }],
      ["너무 큰 시간", { playtimeHours: "999999" }],
      ["분이 60 이상", { playtimeMinutes: "60" }],
      ["음수", { playtimeHours: "-1" }],
      ["소수 시간", { playtimeHours: "1.5" }],
      ["글자", { playtimeHours: "abc" }],
      ["일곱 자리 시간", { playtimeHours: "1000000" }],
    ])("거절한다: %s", (_name, fields) => {
      expect(errorsOf(fields)).toEqual(["playtime"]);
    });

    it("분 단위 값이 저장할 때 조용히 바뀌지 않는다(125분은 2시간 5분 그대로)", () => {
      expect(ok({ playtimeHours: "2", playtimeMinutes: "5" }).playtimeMinutes).toBe(125);
    });
  });

  describe("진행도", () => {
    it.each(["0", "50", "100"])("%s%%를 받는다", (progressPercent) => {
      expect(ok({ progressPercent }).progressPercent).toBe(Number(progressPercent));
    });

    it.each(["101", "-1", "10.5", "abc", "1e2", "1000"])("%s는 거절한다", (progressPercent) => {
      expect(errorsOf({ progressPercent })).toEqual(["progressPercent"]);
    });

    it("진행 상황 텍스트는 100자까지이고, 공백뿐이면 비운다", () => {
      expect(ok({ progressText: "가".repeat(MAX_PROGRESS_TEXT) }).progressText).toHaveLength(MAX_PROGRESS_TEXT);
      expect(errorsOf({ progressText: "가".repeat(MAX_PROGRESS_TEXT + 1) })).toEqual(["progressText"]);
      expect(ok({ progressText: "   " }).progressText).toBeNull();
    });

    it("글자 수는 이모지 하나를 한 글자로 센다(DB의 char_length와 같다)", () => {
      expect(ok({ progressText: "🎮".repeat(MAX_PROGRESS_TEXT) }).progressText).not.toBeNull();
      expect(errorsOf({ progressText: "🎮".repeat(MAX_PROGRESS_TEXT + 1) })).toEqual(["progressText"]);
    });
  });

  describe("메모", () => {
    it("2,000자까지 받고 넘으면 거절한다", () => {
      expect(ok({ note: "가".repeat(MAX_NOTE) }).note).toHaveLength(MAX_NOTE);
      expect(errorsOf({ note: "가".repeat(MAX_NOTE + 1) })).toEqual(["note"]);
    });

    it("줄바꿈은 살리고 양 끝 공백만 다듬으며, 공백뿐이면 비운다", () => {
      expect(ok({ note: "\n 첫 줄\n\n셋째 줄 \n" }).note).toBe("첫 줄\n\n셋째 줄");
      expect(ok({ note: " \n " }).note).toBeNull();
    });
  });

  it("여러 칸이 틀리면 모두 한꺼번에 알린다", () => {
    expect(errorsOf({ status: "x", platformId: "y", startedOn: "z", progressPercent: "200", note: "가".repeat(MAX_NOTE + 1) }).sort()).toEqual(
      ["note", "platformId", "progressPercent", "startedOn", "status"],
    );
  });
});

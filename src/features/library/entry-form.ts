import { charLength } from "@/features/profiles/handle";
import { isPlayStatus, type PlayStatus } from "@/lib/play-status";

/** 서버가 저장하는 값. 비워 둔 칸은 모두 null이다. */
export type EntryInput = {
  status: PlayStatus | null;
  platformId: number | null;
  startedOn: string | null;
  clearedOn: string | null;
  perfectedOn: string | null;
  playtimeMinutes: number | null;
  progressPercent: number | null;
  progressText: string | null;
  note: string | null;
};

export type EntryField = "status" | "platformId" | "startedOn" | "clearedOn" | "perfectedOn" | "playtime" | "progressPercent" | "progressText" | "note";
export type EntryFormErrors = Partial<Record<EntryField, string>>;

/** 오류가 났을 때 폼을 다시 채우는 값(전부 문자열). */
export type EntryFormValues = {
  status: string;
  platformId: string;
  startedOn: string;
  clearedOn: string;
  perfectedOn: string;
  playtimeHours: string;
  playtimeMinutes: string;
  progressPercent: string;
  progressText: string;
  note: string;
};

export type EntryFormResult =
  | { ok: true; data: EntryInput; values: EntryFormValues }
  | { ok: false; errors: EntryFormErrors; values: EntryFormValues };

// DB 제약과 같은 한도다(`drizzle/0004_library.sql`). 여기서 먼저 막아 한국어 문구로 알리고, DB가 마지막 방어선이다.
export const MAX_PLAYTIME_MINUTES = 1_000_000;
export const MAX_PROGRESS_TEXT = 100;
export const MAX_NOTE = 2000;
const MIN_DATE = "1970-01-01";
const MAX_DATE = "2100-12-31";

const field = (form: FormData, key: string) => {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
};

/** `YYYY-MM-DD` 형식이고 실제로 있는 날짜이며 DB가 받는 범위 안인가. */
export function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value && value >= MIN_DATE && value <= MAX_DATE;
}

const DATE_ERROR = "올바른 날짜(예: 2026-05-01)여야 해요.";

export function parseEntryForm(form: FormData): EntryFormResult {
  const values: EntryFormValues = {
    status: field(form, "status").trim(),
    platformId: field(form, "platformId").trim(),
    startedOn: field(form, "startedOn").trim(),
    clearedOn: field(form, "clearedOn").trim(),
    perfectedOn: field(form, "perfectedOn").trim(),
    playtimeHours: field(form, "playtimeHours").trim(),
    playtimeMinutes: field(form, "playtimeMinutes").trim(),
    progressPercent: field(form, "progressPercent").trim(),
    progressText: field(form, "progressText").trim(),
    // 메모는 줄바꿈을 살리고 양 끝만 다듬는다.
    note: field(form, "note").trim(),
  };

  const errors: EntryFormErrors = {};

  let status: PlayStatus | null = null;
  if (values.status !== "") {
    if (isPlayStatus(values.status)) status = values.status;
    else errors.status = "목록에 있는 상태를 골라 주세요.";
  }

  let platformId: number | null = null;
  if (values.platformId !== "") {
    if (/^\d{1,9}$/.test(values.platformId)) platformId = Number(values.platformId);
    else errors.platformId = "목록에 있는 플랫폼을 골라 주세요.";
  }

  const date = (key: "startedOn" | "clearedOn" | "perfectedOn"): string | null => {
    if (values[key] === "") return null;
    if (isRealDate(values[key])) return values[key];
    errors[key] = DATE_ERROR;
    return null;
  };
  const startedOn = date("startedOn");
  const clearedOn = date("clearedOn");
  const perfectedOn = date("perfectedOn");
  if (!errors.startedOn && !errors.clearedOn && startedOn && clearedOn && clearedOn < startedOn) {
    errors.clearedOn = "엔딩 달성일은 플레이 시작일과 같거나 이후여야 해요.";
  }

  // 시간과 분을 따로 받는다. 소수 시간 한 칸으로 받으면 저장할 때마다 분 단위 값이 반올림돼 조용히 바뀐다.
  let playtimeMinutes: number | null = null;
  const { playtimeHours: hours, playtimeMinutes: minutes } = values;
  if (hours !== "" || minutes !== "") {
    if ((hours !== "" && !/^\d{1,6}$/.test(hours)) || (minutes !== "" && !/^\d{1,2}$/.test(minutes))) {
      errors.playtime = "플레이 시간은 시간과 분을 0 이상의 정수로 적어 주세요.";
    } else if (minutes !== "" && Number(minutes) > 59) {
      errors.playtime = "분은 0에서 59 사이여야 해요.";
    } else {
      const total = Number(hours || "0") * 60 + Number(minutes || "0");
      if (total > MAX_PLAYTIME_MINUTES) errors.playtime = "플레이 시간이 너무 길어요.";
      else playtimeMinutes = total;
    }
  }

  let progressPercent: number | null = null;
  if (values.progressPercent !== "") {
    if (/^\d{1,3}$/.test(values.progressPercent) && Number(values.progressPercent) <= 100) progressPercent = Number(values.progressPercent);
    else errors.progressPercent = "진행도는 0에서 100 사이의 정수여야 해요.";
  }

  if (charLength(values.progressText) > MAX_PROGRESS_TEXT) errors.progressText = `진행 상황은 ${MAX_PROGRESS_TEXT}자 이하여야 해요.`;
  if (charLength(values.note) > MAX_NOTE) errors.note = `메모는 ${MAX_NOTE.toLocaleString("en-US")}자 이하여야 해요.`;

  if (Object.keys(errors).length > 0) return { ok: false, errors, values };
  return {
    ok: true,
    values,
    data: {
      status,
      platformId,
      startedOn,
      clearedOn,
      perfectedOn,
      playtimeMinutes,
      progressPercent,
      progressText: values.progressText === "" ? null : values.progressText,
      note: values.note === "" ? null : values.note,
    },
  };
}

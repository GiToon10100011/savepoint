import { charLength } from "@/features/profiles/handle";
import type { ManualGameInput } from "./manual";

export type ManualFormField = "title" | "titleKo" | "summary" | "releaseDate" | "developers" | "publishers";
export type ManualFormErrors = Partial<Record<ManualFormField, string>>;

/** 오류가 났을 때 폼을 다시 채우는 값(전부 문자열). */
export type ManualFormValues = {
  title: string;
  titleKo: string;
  summary: string;
  releaseDate: string;
  developers: string;
  publishers: string;
  genres: string[];
  tags: string[];
  platforms: string[];
};

export type ManualFormResult =
  | { ok: true; data: ManualGameInput; values: ManualFormValues }
  | { ok: false; errors: ManualFormErrors; values: ManualFormValues };

export const MAX_COMPANIES = 5;
const MAX_LIST = 30; // 장르·태그·플랫폼 선택 수의 상한(시드된 목록보다 넉넉하다)

const text = (form: FormData, key: string) => {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
};

/** 체크박스 묶음: 문자열만, 중복 없이, 너무 긴 값은 버린다. */
const picks = (form: FormData, key: string) =>
  [...new Set(form.getAll(key).filter((v): v is string => typeof v === "string" && v.length > 0 && v.length <= 64))].slice(0, MAX_LIST);

/** 줄바꿈이나 쉼표로 구분한 이름 목록. 공백을 다듬고 대소문자만 다른 중복을 합친다. */
export function parseNames(raw: string): string[] {
  const byLower = new Map<string, string>();
  for (const part of raw.split(/[\n,]/)) {
    const name = part.trim();
    if (name && !byLower.has(name.toLowerCase())) byLower.set(name.toLowerCase(), name);
  }
  return [...byLower.values()];
}

function realDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value && value >= "1940-01-01" && value <= "2100-12-31";
}

export function parseManualForm(form: FormData): ManualFormResult {
  const values: ManualFormValues = {
    title: text(form, "title"),
    titleKo: text(form, "titleKo"),
    summary: text(form, "summary"),
    releaseDate: text(form, "releaseDate"),
    developers: text(form, "developers"),
    publishers: text(form, "publishers"),
    genres: picks(form, "genre"),
    tags: picks(form, "tag"),
    platforms: picks(form, "platform"),
  };

  const errors: ManualFormErrors = {};
  if (values.title === "") errors.title = "제목을 입력해 주세요.";
  else if (charLength(values.title) > 200) errors.title = "제목은 200자 이하여야 해요.";
  if (charLength(values.titleKo) > 200) errors.titleKo = "한국어 제목은 200자 이하여야 해요.";
  if (charLength(values.summary) > 5000) errors.summary = "소개는 5000자 이하여야 해요.";
  if (values.releaseDate !== "" && !realDate(values.releaseDate)) errors.releaseDate = "출시일은 올바른 날짜(예: 2024-05-01)여야 해요.";

  const developers = parseNames(values.developers);
  const publishers = parseNames(values.publishers);
  if (developers.length > MAX_COMPANIES || developers.some((n) => charLength(n) > 200)) errors.developers = `개발사는 ${MAX_COMPANIES}곳까지, 이름은 200자 이하로 적어 주세요.`;
  if (publishers.length > MAX_COMPANIES || publishers.some((n) => charLength(n) > 200)) errors.publishers = `퍼블리셔는 ${MAX_COMPANIES}곳까지, 이름은 200자 이하로 적어 주세요.`;

  if (Object.keys(errors).length > 0) return { ok: false, errors, values };
  return {
    ok: true,
    values,
    data: {
      title: values.title,
      titleKo: values.titleKo || null,
      summary: values.summary || null,
      releaseDate: values.releaseDate || null,
      genreSlugs: values.genres,
      tagSlugs: values.tags,
      platformSlugs: values.platforms,
      developers,
      publishers,
    },
  };
}

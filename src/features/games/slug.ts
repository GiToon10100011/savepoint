/**
 * 사용자가 입력한 제목으로 URL 슬러그를 만든다. DB의 `games_slug_format`과 같은 규칙을 지킨다:
 * 영문 소문자·숫자·하이픈, `new`(수동 등록 경로)와 `igdb-숫자`(IGDB 미리보기 경로)는 쓸 수 없다.
 * 한글·일본어처럼 영문으로 바꿀 수 없는 제목은 `game-<무작위>`로 대신한다.
 */

const MAX_BASE_LENGTH = 60;
const RESERVED = /^(new|igdb-[0-9]+)$/;

function randomHex(bytes = 4): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** 슬러그로 쓸 수 있는 글자만 남긴다(악센트 제거, 나머지는 하이픈). 쓸 글자가 없으면 빈 문자열. */
export function slugify(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_BASE_LENGTH)
    .replace(/-+$/g, "");
}

/** 슬러그 후보: 제목에서 만들고, 못 만들거나 예약어면 `fallbackPrefix-<무작위>`를 쓴다. */
export function slugCandidate(title: string, fallbackPrefix = "game"): string {
  const base = slugify(title);
  return base === "" || RESERVED.test(base) ? `${fallbackPrefix}-${randomHex()}` : base;
}

/** 이미 쓰이는 슬러그를 피하려고 무작위 접미사를 붙인다. */
export function withSuffix(slug: string): string {
  return `${slug.slice(0, MAX_BASE_LENGTH)}-${randomHex(2)}`;
}

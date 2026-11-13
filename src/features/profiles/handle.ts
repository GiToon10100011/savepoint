export const HANDLE_PATTERN = /^[a-z0-9_]{3,20}$/;
export const NICKNAME_MAX = 20;
const DEFAULT_NICKNAME = "플레이어";

/** 이모지처럼 UTF-16 두 칸을 쓰는 글자도 한 글자로 센다. */
export function charLength(value: string): number {
  return [...value].length;
}

/**
 * 첫 로그인에서 프로필에 임시로 붙이는 핸들: `user_` + 8자리 16진수(13자).
 * 사용자가 나중에 원하는 핸들로 바꾼다. 충돌하면 호출하는 쪽이 다시 만들어 시도한다.
 */
export function generateHandle(bytes: Uint8Array = crypto.getRandomValues(new Uint8Array(4))): string {
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `user_${hex}`;
}

/** 가입 때 받은 이름을 닉네임(1–20자)으로 다듬는다. 비어 있으면 기본값을 쓴다. */
export function deriveNickname(name: string | null | undefined): string {
  const cleaned = (name ?? "").replace(/\s+/g, " ").trim();
  if (!cleaned) return DEFAULT_NICKNAME;
  return [...cleaned].slice(0, NICKNAME_MAX).join("").trim() || DEFAULT_NICKNAME;
}

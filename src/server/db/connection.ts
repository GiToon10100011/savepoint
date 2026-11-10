import { randomBytes } from "node:crypto";

/** Neon 풀러 호스트로 바꾼다: `ep-xxx.region...` → `ep-xxx-pooler.region...` (이미 풀러면 그대로). */
export function toPooledUrl(url: string): string {
  const u = new URL(url);
  const [first, ...rest] = u.hostname.split(".");
  if (!first.endsWith("-pooler")) u.hostname = [`${first}-pooler`, ...rest].join(".");
  return u.toString();
}

/**
 * `sslmode=verify-full`을 명시한다. pg 다음 메이저부터 `require`가 인증서를 검증하지 않는
 * libpq 의미로 바뀌므로, 지금의 안전한 동작(서버 인증서와 호스트 이름 검증)을 고정한다.
 */
export function withVerifyFull(url: string): string {
  const u = new URL(url);
  u.searchParams.set("sslmode", "verify-full");
  return u.toString();
}

/** 호스트·DB·쿼리는 유지하고 사용자 이름과 비밀번호만 바꾼다. */
export function withCredentials(url: string, user: string, password: string): string {
  const u = new URL(url);
  u.username = user;
  u.password = password;
  return u.toString();
}

/** `.env` 문자열에서 키를 교체하거나 없으면 끝에 추가한다. 주석과 다른 키는 그대로 둔다. */
export function mergeEnv(existing: string, updates: Record<string, string>): string {
  const lines = existing === "" ? [] : existing.replace(/\n$/, "").split("\n");
  const pending = new Map(Object.entries(updates));

  const merged = lines.map((line) => {
    const key = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=/)?.[1];
    if (key && pending.has(key)) {
      const value = pending.get(key) as string;
      pending.delete(key);
      return `${key}=${value}`;
    }
    return line;
  });

  for (const [key, value] of pending) merged.push(`${key}=${value}`);
  return `${merged.join("\n")}\n`;
}

/** URL에 그대로 넣어도 안전한 무작위 비밀번호(base64url). */
export function randomPassword(bytes = 24): string {
  return randomBytes(bytes).toString("base64url");
}

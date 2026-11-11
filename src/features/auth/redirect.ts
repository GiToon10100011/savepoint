/** 로그인 직후 보낼 수 있는 경로인지 가리는 기준에서 빼는 접두사. 인증 화면으로 돌려보내면 로그인 직후에 로그인 화면이 다시 보인다. */
const AUTH_PREFIXES = ["/auth", "/api/auth"];

/**
 * `?redirectTo=` 같은 외부 입력을 사이트 안의 경로로만 받아들인다. 그 밖의 값은 `fallback`을 돌려준다.
 * 열린 리디렉션(open redirect)을 막기 위해 다음을 거른다:
 * - `//evil.com`(프로토콜 상대 URL), `/\evil.com`(브라우저가 `\`를 `/`로 바꿔 읽는다)
 * - 탭·개행 같은 제어 문자(URL 파서가 지워서 `/\t/evil.com`이 `//evil.com`이 된다)
 */
export function safeRedirectPath(input: string | null | undefined, fallback = "/"): string {
  if (!input || !input.startsWith("/") || input.startsWith("//")) return fallback;
  if (/[\\\u0000-\u001f\u007f]/.test(input)) return fallback;

  // 실제 URL 파서로도 같은 출처에 머무는지 확인한다.
  const base = "http://savepoint.invalid";
  let parsed: URL;
  try {
    parsed = new URL(input, base);
  } catch {
    return fallback;
  }
  if (parsed.origin !== base) return fallback;

  const path = parsed.pathname;
  if (AUTH_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) return fallback;
  return input;
}

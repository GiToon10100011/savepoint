import "server-only";
import { createNeonAuth } from "@neon/auth/next/server";

function requireEnv(name: "NEON_AUTH_BASE_URL" | "NEON_AUTH_COOKIE_SECRET"): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/**
 * Neon Auth(Managed Better Auth) 서버 인스턴스. 라우트 핸들러·proxy·세션 조회가 모두 이 하나를 쓴다.
 * 인증 서버는 Neon이 호스팅하므로 앱은 쿠키 세션과 프록시만 맡는다.
 */
export const auth = createNeonAuth({
  baseUrl: requireEnv("NEON_AUTH_BASE_URL"),
  cookies: { secret: requireEnv("NEON_AUTH_COOKIE_SECRET") },
});

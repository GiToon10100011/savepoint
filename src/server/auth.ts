import "server-only";
import { createNeonAuth } from "@neon/auth/next/server";
import { PHASE_PRODUCTION_BUILD } from "next/constants";

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
  // 프리렌더는 끝날 때 대기 중이던 cookies() 약속을 거절한다(정상 동작이고 React가 무시한다). SDK가 이를
  // 오류로 기록해 빌드 로그가 어지러워지므로 빌드 중에만 끈다. 실행 중의 인증 오류는 그대로 기록한다.
  logLevel: process.env.NEXT_PHASE === PHASE_PRODUCTION_BUILD ? "silent" : "warn",
});

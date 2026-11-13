import "server-only";
import { createIgdbClient } from "./client";
import { createGameSource, type GameSource } from "./source";

// 개발 중 HMR로 모듈이 다시 로드돼도 토큰 캐시와 속도 제한이 프로세스에 하나만 있도록 globalThis에 둔다.
const globalForIgdb = globalThis as unknown as { __savepointIgdb?: GameSource };

function requireEnv(name: "TWITCH_CLIENT_ID" | "TWITCH_CLIENT_SECRET"): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/** IGDB 게임 소스. 키는 서버 환경 변수로만 읽고 클라이언트 번들에 들어가지 않는다(`server-only`). */
export function igdbSource(): GameSource {
  return (globalForIgdb.__savepointIgdb ??= createGameSource(
    createIgdbClient({ clientId: requireEnv("TWITCH_CLIENT_ID"), clientSecret: requireEnv("TWITCH_CLIENT_SECRET") }),
  ));
}

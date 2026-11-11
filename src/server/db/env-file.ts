import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { mergeEnv } from "./connection";

/**
 * 비밀 값이 든 env 파일을 병합해 쓰고 권한을 소유자 전용(600)으로 맞춘다.
 *
 * `writeFileSync`의 `mode` 옵션은 파일을 **새로 만들 때만** 적용된다. 사용자가 `cp .env.example .env.local`로
 * 이미 만들어 둔 파일(기본 644)에 비밀번호를 쓰면 다른 사용자가 읽을 수 있으므로, 쓰기 전에 권한부터 좁힌다.
 */
export function writeSecretEnvFile(file: string, updates: Record<string, string>): void {
  const exists = existsSync(file);
  if (exists) chmodSync(file, 0o600); // 비밀 값을 쓰기 전에 먼저 좁힌다.
  const current = exists ? readFileSync(file, "utf8") : "";
  writeFileSync(file, mergeEnv(current, updates), { mode: 0o600 });
  chmodSync(file, 0o600); // 새로 만든 파일도 umask와 무관하게 600이 되도록 확정한다.
}

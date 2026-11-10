import path from "node:path";
import { config } from "dotenv";
import { defineConfig } from "vitest/config";

// DB 통합 테스트는 Neon `test` 브랜치만 쓴다. 연결 정보는 .env.test.local에 있다.
// override: 셸에 내보낸 DATABASE_URL(예: dev 브랜치)이 있어도 test 브랜치 값이 이긴다.
config({ path: ".env.test.local", quiet: true, override: true });

if (!process.env.DATABASE_URL) {
  throw new Error(".env.test.local에 DATABASE_URL이 없다. README의 'Neon 설정'으로 test 브랜치 역할을 먼저 만든다.");
}

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  test: {
    environment: "node",
    include: ["tests/db/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
  },
});

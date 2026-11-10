import path from "node:path";
import { config } from "dotenv";
import { defineConfig } from "vitest/config";

// DB 통합 테스트는 Neon `test` 브랜치만 쓴다. 연결 정보는 .env.test.local에 있다.
config({ path: ".env.test.local", quiet: true });

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

import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;

// E2E_SERVER=prod: 빌드한 서버(next start)로 시험한다. 개발 서버는 디렉터리당 하나뿐이라 이미 `npm run dev`가
// 떠 있으면 아래 서버가 시작하지 못한다. 빌드 산출물은 개발 서버의 `.next/dev`와 분리돼 있어 충돌하지 않는다.
// 운영 모드에서는 `/dev/ui`가 404이므로 design-system.spec.ts에는 쓰지 않는다.
const PROD = process.env.E2E_SERVER === "prod";

// E2E_BASE_URL=http://localhost:3000: 이미 떠 있는 서버를 그대로 쓰고 Playwright가 서버를 띄우지 않는다.
// 읽기만 하는 시험(design-system.spec.ts 등)을 열어 둔 개발 서버에 돌릴 때 쓴다.
const EXTERNAL_URL = process.env.E2E_BASE_URL;

// iPhone 프로필은 기본 브라우저가 WebKit이다. 이 프로젝트는 Chromium만 설치해 쓰므로 Chromium으로 고정한다.
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- 구조 분해로 키를 제거하는 용도
const { defaultBrowserType: _ignored, ...iphone } = devices["iPhone 14"];

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: EXTERNAL_URL ?? `http://localhost:${PORT}`,
    headless: true, // 사용자 화면에 창을 띄우지 않는다
    locale: "ko-KR",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "mobile", use: { ...iphone, browserName: "chromium" } },
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: EXTERNAL_URL ? undefined : {
    command: PROD ? `npm run build && npm run start -- --port ${PORT}` : `npm run dev -- --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: PROD ? 300_000 : 120_000,
  },
});

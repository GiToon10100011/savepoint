import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;

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
    baseURL: `http://localhost:${PORT}`,
    headless: true, // 사용자 화면에 창을 띄우지 않는다
    locale: "ko-KR",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "mobile", use: { ...iphone, browserName: "chromium" } },
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: `npm run dev -- --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});

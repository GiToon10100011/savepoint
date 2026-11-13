import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { acquireAuthLock, cleanupTestUsers, newTestUser, waitForForm } from "./helpers/auth";

// 실제 Neon Auth·DB(dev 브랜치)와 실제 IGDB를 쓴다. 이 파일이 만든 계정과 게임은 끝난 뒤 지운다.
test.afterAll(cleanupTestUsers);

test.describe("게임 검색과 미리보기", () => {
  test("검색어 없이 열면 인기 게임과 직접 등록 링크가 보인다", async ({ page }) => {
    await page.goto("/search");
    await expect(page.getByRole("heading", { level: 2, name: "인기 게임" })).toBeVisible();
    await expect(page.getByRole("link", { name: "게임 직접 등록하기" })).toBeVisible();
  });

  test("IGDB 후보를 보여 주고 DB에 쓰지 않는 미리보기를 연다(실제 IGDB)", async ({ page }) => {
    await page.goto("/search?q=zelda");
    await expect(page.getByRole("heading", { level: 2, name: "IGDB에서 찾은 게임" })).toBeVisible({ timeout: 30_000 });
    await page.getByRole("list", { name: "IGDB 후보 목록" }).getByRole("link").first().click();
    await expect(page).toHaveURL(/\/games\/igdb-\d+$/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("note")).toContainText("아직 서비스에 등록되지 않은 게임");
  });

  test("없는 게임 주소는 찾을 수 없다 화면을 보여 준다", async ({ page }) => {
    await page.goto(`/games/does-not-exist-${randomUUID().slice(0, 6)}`);
    await expect(page.getByText("This page could not be found")).toBeVisible();
  });
});

test.describe("접근성과 디자인 규칙 (검색·게임 화면)", () => {
  // 비로그인으로 열리는 화면만 본다(/games/new는 로그인이 필요하다). 게임 화면은 dev에 시드된 게임을 쓴다.
  const pages = ["/search", "/search?q=elden", "/games/elden-ring"];
  for (const url of pages) {
    for (const scheme of ["light", "dark"] as const) {
      test(`${url} (${scheme}): axe 위반이 없다`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme });
        await page.goto(url);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 30_000 });
        const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
        expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}곳 — ${v.nodes[0]?.target.join(" ")}`)).toEqual([]);
      });
    }
  }

  test("검색·게임 화면에도 라운드와 그림자가 없다", async ({ page }) => {
    for (const url of pages) {
      await page.goto(url);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 30_000 });
      const offenders = await page.evaluate(() =>
        [...document.querySelectorAll("body *")]
          .filter((el) => {
            const style = getComputedStyle(el);
            return style.borderTopLeftRadius !== "0px" || style.boxShadow !== "none";
          })
          .map((el) => el.tagName.toLowerCase()),
      );
      expect(offenders, url).toEqual([]);
    }
  });
});

test.describe("게임 직접 등록", () => {
  // 가입이 들어 있어 인증 E2E와 같은 이유로(Neon Auth 429) 모바일·데스크톱 워커가 번갈아 돌게 줄 세운다.
  let release: (() => Promise<void>) | undefined;
  test.beforeEach(async () => {
    test.setTimeout(240_000);
    release = await acquireAuthLock();
  });
  test.afterEach(async () => {
    await release?.();
    release = undefined;
  });

  test("비로그인 → 로그인 안내 → 가입 → 등록 화면 복귀 → 입력 오류 → 등록 → 상세 → 검색", async ({ page }) => {
    const user = newTestUser();
    const token = randomUUID().slice(0, 8); // 소문자 16진수라 슬러그에 그대로 들어간다
    const title = `E2E Game ${token}`;
    const titleKo = `이투이 게임 ${token}`;
    const company = `E2E Co ${token}`;

    await test.step("비로그인이면 원래 경로를 실어 로그인 화면으로 보낸다", async () => {
      await page.goto("/games/new");
      await expect(page).toHaveURL(/\/auth\/sign-in\?redirectTo=%2Fgames%2Fnew$/);
    });

    await test.step("그 링크로 가입하면 등록 화면으로 돌아온다", async () => {
      await page.getByRole("link", { name: "가입하기" }).click();
      await expect(page).toHaveURL(/\/auth\/sign-up\?redirectTo=%2Fgames%2Fnew$/);
      await waitForForm(page);
      await page.getByLabel("닉네임").fill(user.nickname);
      await page.getByLabel("이메일").fill(user.email);
      await page.getByLabel("비밀번호").fill(user.password);
      await page.getByRole("button", { name: "가입하기" }).click();
      await expect(page).toHaveURL(/\/games\/new$/);
      await expect(page.getByRole("heading", { level: 1, name: "게임 직접 등록" })).toBeVisible();
    });

    await test.step("제목이 비면 한국어로 안내하고 등록하지 않는다", async () => {
      await waitForForm(page);
      await page.getByRole("button", { name: "게임 등록하기" }).click();
      await expect(page.getByText("제목을 입력해 주세요.")).toBeVisible();
      await expect(page.getByLabel("제목", { exact: true })).toHaveAttribute("aria-invalid", "true");
      await expect(page).toHaveURL(/\/games\/new$/);
    });

    await test.step("등록하면 그 게임의 상세 화면으로 간다", async () => {
      await page.getByLabel("제목", { exact: true }).fill(title);
      await page.getByLabel("한국어 제목 (선택)").fill(titleKo);
      await page.getByLabel("개발사 (선택)").fill(company);
      await page.getByLabel("RPG", { exact: true }).check();
      await page.getByLabel("PC", { exact: true }).check();
      await page.getByLabel("소개 (선택)").fill("E2E가 등록한 게임");
      await page.getByRole("button", { name: "게임 등록하기" }).click();

      await expect(page).toHaveURL(new RegExp(`/games/e2e-game-${token}$`));
      await expect(page.getByRole("heading", { level: 1, name: titleKo })).toBeVisible();
      await expect(page.getByText(title, { exact: true })).toBeVisible(); // 원제는 보조 줄로
      await expect(page.getByText(company)).toBeVisible();
      await expect(page.getByText("E2E가 등록한 게임")).toBeVisible();
      await expect(page.getByRole("note")).toHaveCount(0); // 등록된 게임이라 미리보기 안내가 없다
    });

    await test.step("검색에서 찾아 열 수 있다", async () => {
      await page.goto(`/search?q=${encodeURIComponent(title)}`);
      const card = page.getByRole("list", { name: "게임 목록" }).getByRole("link", { name: new RegExp(token) });
      await expect(card).toBeVisible();
      await card.click();
      await expect(page).toHaveURL(new RegExp(`/games/e2e-game-${token}$`));
    });
  });
});

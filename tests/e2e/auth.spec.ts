import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { cleanupTestUsers, newTestUser, signIn, signUp, waitForForm } from "./helpers/auth";

// 실제 Neon Auth(dev 브랜치)와 DB에 가입한다. 이 파일이 만든 계정은 끝난 뒤 지운다.
test.afterAll(cleanupTestUsers);

const nav = (page: Page) => page.getByRole("navigation", { name: "주 메뉴" });
const alertWith = (page: Page, text: string) =>
  // Next의 라우트 안내(role=alert, 빈 문구)와 구분하려고 문구로 거른다.
  page.getByRole("alert").filter({ hasText: text });

test.describe("보호 경로", () => {
  test("비로그인이면 로그인 화면으로 보내고, 공개 경로는 그대로 연다", async ({ page }) => {
    await page.goto("/account");
    await expect(page).toHaveURL(/\/auth\/sign-in$/);
    await expect(page.getByRole("heading", { level: 1, name: "로그인" })).toBeVisible();

    // 라이브러리·달력은 개인 기록이라 로그인이 필요하다.
    await page.goto("/library");
    await expect(page).toHaveURL(/\/auth\/sign-in$/);

    await page.goto("/");
    await expect(page).toHaveURL(/\/$/);
    await expect(nav(page).getByRole("link", { name: "로그인" })).toBeVisible();
  });
});

test.describe("가입 입력 검증", () => {
  test("필드마다 한국어로 안내하고 가입하지 않는다", async ({ page }) => {
    await page.goto("/auth/sign-up");
    await waitForForm(page);
    await page.getByLabel("이메일").fill("not-an-email");
    await page.getByLabel("비밀번호").fill("short");
    await page.getByRole("button", { name: "가입하기" }).click();

    await expect(page.getByText("닉네임을 입력해 주세요.")).toBeVisible();
    await expect(page.getByText("이메일 형식을 확인해 주세요.")).toBeVisible();
    await expect(page.getByText("비밀번호는 8자 이상이어야 해요.", { exact: true })).toBeVisible();
    await expect(page.getByLabel("이메일")).toHaveAttribute("aria-invalid", "true");
    await expect(page).toHaveURL(/\/auth\/sign-up$/);
    // 오류가 나도 입력한 이메일은 남아 있다(비밀번호는 비운다).
    await expect(page.getByLabel("이메일")).toHaveValue("not-an-email");
    await expect(page.getByLabel("비밀번호")).toHaveValue("");
  });
});

test.describe("계정 생애 주기", () => {
  test("가입 → 프로필 생성 → 새로고침 유지 → 로그아웃 → 중복 가입·오류 안내 → 로그인", async ({ page }) => {
    test.setTimeout(180_000); // 개발 서버가 처음 컴파일하는 화면이 많다
    const user = newTestUser();
    let handle = "";

    await test.step("가입하면 바로 로그인된 상태로 홈에 도착한다", async () => {
      await signUp(page, user);
      await expect(page).toHaveURL(/\/$/);
      await expect(nav(page).getByRole("link", { name: "내 계정" })).toBeVisible();
    });

    await test.step("첫 세션에서 프로필이 만들어진다(닉네임은 가입 때 이름, 핸들은 임시값)", async () => {
      await page.goto("/account");
      await expect(page.getByTestId("account-nickname")).toHaveText(user.nickname);
      await expect(page.getByTestId("account-handle")).toHaveText(/^@user_[0-9a-f]{8}$/);
      await expect(page.getByText(user.email)).toBeVisible();
      handle = (await page.getByTestId("account-handle").textContent()) ?? "";
    });

    await test.step("새로고침해도 세션이 유지된다", async () => {
      await page.reload();
      await expect(page).toHaveURL(/\/account$/);
      await expect(page.getByTestId("account-nickname")).toHaveText(user.nickname);
    });

    await test.step("로그아웃하면 홈으로 가고 보호 경로가 다시 막힌다", async () => {
      await page.getByRole("button", { name: "로그아웃" }).click();
      await expect(page).toHaveURL(/\/$/);
      await expect(nav(page).getByRole("link", { name: "로그인" })).toBeVisible();
      await page.goto("/account");
      await expect(page).toHaveURL(/\/auth\/sign-in$/);
    });

    await test.step("같은 이메일로 다시 가입하면 안내한다", async () => {
      await signUp(page, user);
      await expect(alertWith(page, "이미 가입된 이메일")).toBeVisible();
      await expect(page).toHaveURL(/\/auth\/sign-up$/);
    });

    await test.step("틀린 비밀번호는 일반 오류가 아니라 구체적인 안내를 보여 준다", async () => {
      await signIn(page, user.email, "wrong-password-1");
      await expect(alertWith(page, "이메일 또는 비밀번호가 올바르지 않아요.")).toBeVisible();
      await expect(page).toHaveURL(/\/auth\/sign-in$/);
      await expect(page.getByLabel("이메일")).toHaveValue(user.email);
    });

    await test.step("올바른 비밀번호로 로그인하면 같은 프로필을 쓴다(새로 만들지 않는다)", async () => {
      await signIn(page, user.email, user.password);
      await expect(page).toHaveURL(/\/$/);
      await page.goto("/account");
      await expect(page.getByTestId("account-handle")).toHaveText(handle);
    });

    await test.step("로그인 뒤 redirectTo 경로로 가되 외부 주소는 무시한다", async () => {
      await page.getByRole("button", { name: "로그아웃" }).click();
      await expect(page).toHaveURL(/\/$/);
      await signIn(page, user.email, user.password, `?redirectTo=${encodeURIComponent("/account")}`);
      await expect(page).toHaveURL(/\/account$/);

      await page.getByRole("button", { name: "로그아웃" }).click();
      await expect(page).toHaveURL(/\/$/);
      await signIn(page, user.email, user.password, `?redirectTo=${encodeURIComponent("//evil.example")}`);
      await expect(page).toHaveURL(/\/$/);
      expect(new URL(page.url()).hostname).toBe("localhost");
    });
  });
});

test.describe("접근성과 디자인 규칙", () => {
  for (const url of ["/auth/sign-in", "/auth/sign-up"]) {
    for (const scheme of ["light", "dark"] as const) {
      test(`${url} (${scheme}): axe 위반이 없다`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme });
        await page.goto(url);
        await waitForForm(page);
        const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
        expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}곳 — ${v.nodes[0]?.target.join(" ")}`)).toEqual([]);
      });
    }
  }

  test("로그인·가입 화면에도 라운드와 그림자가 없다", async ({ page }) => {
    for (const url of ["/auth/sign-in", "/auth/sign-up"]) {
      await page.goto(url);
      await waitForForm(page);
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

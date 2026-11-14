import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { acquireAuthLock, cleanupTestUsers, newTestUser, signUp, waitForForm } from "./helpers/auth";
import { cleanupCatalogFixtures, createGameFixture, trackImportedIgdbGame } from "./helpers/catalog";

// 실제 Neon Auth·DB(dev 브랜치)와 실제 IGDB를 쓴다. 이 파일이 만든 계정·게임·평가는 끝난 뒤 지운다.
test.afterAll(async () => {
  await cleanupTestUsers();
  await cleanupCatalogFixtures();
});

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

/** 별점 슬라이더가 React에 연결(hydration)된 뒤에야 키보드·클릭이 동작한다. */
async function waitForSlider(page: Page) {
  await page.waitForFunction(() => {
    const slider = document.querySelector('[role="slider"]');
    return slider !== null && Object.keys(slider).some((key) => key.startsWith("__reactProps"));
  });
}

test("비로그인은 로그인 안내를 보고, 가입한 뒤 평가를 등록·수정·취소한다(평균도 함께 바뀐다)", async ({ page }) => {
  const user = newTestUser();
  const game = await createGameFixture();
  const slider = page.getByRole("slider", { name: "내 별점" });
  const average = (text: string) => expect(page.getByText(text, { exact: true })).toBeVisible();

  await test.step("비로그인이면 별점 입력 대신 로그인 안내가 보이고, 가입하면 이 게임으로 돌아온다", async () => {
    await page.goto(`/games/${game.slug}`);
    await expect(page.getByRole("heading", { level: 2, name: "내 기록" })).toBeVisible();
    await expect(slider).toHaveCount(0);
    await page.getByRole("link", { name: "로그인하고 기록하기" }).click();
    await expect(page).toHaveURL(new RegExp(`/auth/sign-in\\?redirectTo=%2Fgames%2F${game.slug}$`));
    await page.getByRole("link", { name: "가입하기" }).click();
    await waitForForm(page);
    await page.getByLabel("닉네임").fill(user.nickname);
    await page.getByLabel("이메일").fill(user.email);
    await page.getByLabel("비밀번호").fill(user.password);
    await page.getByRole("button", { name: "가입하기" }).click();
    await expect(page).toHaveURL(new RegExp(`/games/${game.slug}$`));
  });

  await test.step("아직 평가하지 않았다", async () => {
    await waitForSlider(page);
    await expect(slider).toHaveAttribute("aria-valuetext", "평가하지 않음");
    await expect(page.getByText("아직 평가가 없어요")).toBeVisible();
    await expect(page.getByRole("button", { name: "평가 취소" })).toHaveCount(0);
  });

  await test.step("키보드로 평가하면 바로 저장되고 새로고침해도 남으며, 평균·평가 수가 서버 값으로 바뀐다", async () => {
    await slider.focus();
    await page.keyboard.press("4");
    await expect(slider).toHaveAttribute("aria-valuetext", "4.0점");
    await average("평균 4.0 (1)");
    await page.reload();
    await waitForSlider(page);
    await expect(slider).toHaveAttribute("aria-valuetext", "4.0점");
    await average("평균 4.0 (1)");
  });

  await test.step("0.5 단위로 바꾸면 평균도 따라 바뀐다", async () => {
    await slider.focus();
    await page.keyboard.press("ArrowLeft");
    await expect(slider).toHaveAttribute("aria-valuetext", "3.5점");
    await average("평균 3.5 (1)");
  });

  await test.step("별의 오른쪽 절반을 누르면 정수 별점이다(포인터)", async () => {
    const box = await slider.boundingBox();
    if (!box) throw new Error("슬라이더 위치를 알 수 없다");
    const cell = box.width / 5;
    await slider.click({ position: { x: cell * 3.75, y: box.height / 2 } }); // 4번째 별의 오른쪽 절반
    await expect(slider).toHaveAttribute("aria-valuetext", "4.0점");
    await average("평균 4.0 (1)");
  });

  await test.step("평가 취소로 지우면 평균과 평가 수가 원래대로 돌아온다", async () => {
    await page.getByRole("button", { name: "평가 취소" }).click();
    await expect(slider).toHaveAttribute("aria-valuetext", "평가하지 않음");
    await expect(page.getByText("아직 평가가 없어요")).toBeVisible();
    await page.reload();
    await waitForSlider(page);
    await expect(slider).toHaveAttribute("aria-valuetext", "평가하지 않음");
    await expect(page.getByText("아직 평가가 없어요")).toBeVisible();
  });

  await test.step("로그인한 상세 화면에도 접근성 위반이 없다(라이트·다크)", async () => {
    await slider.focus();
    await page.keyboard.press("3");
    await expect(slider).toHaveAttribute("aria-valuetext", "3.0점");
    await average("평균 3.0 (1)"); // 서버 저장이 끝난 뒤에 새로고침한다(끝나기 전에 떠나면 저장되지 않는다)
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      // 색 구성표를 바꾼 직후에는 버튼의 색 전환(transition) 중간 값이 검사돼 가짜 대비 위반이 나온다. 처음부터 그 색으로 다시 그린다.
      await page.reload();
      await waitForSlider(page);
      await expect(slider).toHaveAttribute("aria-valuetext", "3.0점");
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}곳 — ${v.nodes[0]?.target.join(" ")}`), scheme).toEqual([]);
    }
  });
});

test("미리보기 게임을 처음 평가하면 서비스에 등록되고 그 게임의 화면으로 이동한다(실제 IGDB)", async ({ page }) => {
  const user = newTestUser();

  const igdbId = await test.step("아직 가져오지 않은 후보의 미리보기를 연다", async () => {
    await page.goto("/search?q=zelda");
    const previews = page.getByRole("list", { name: "IGDB 후보 목록" }).locator('a[href^="/games/igdb-"]');
    await expect(previews.first()).toBeVisible({ timeout: 30_000 });
    await previews.first().click();
    await expect(page).toHaveURL(/\/games\/igdb-\d+$/);
    const id = Number(/igdb-(\d+)$/.exec(page.url())?.[1]);
    trackImportedIgdbGame(id); // 이 시험이 가져오는 게임이라 끝난 뒤 지운다
    return id;
  });

  await test.step("비로그인이면 별점 입력 대신 로그인 안내가 보이고, 안내는 이 미리보기로 돌아오게 한다", async () => {
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("slider", { name: "내 별점" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "로그인하고 기록하기" })).toHaveAttribute("href", `/auth/sign-in?redirectTo=${encodeURIComponent(`/games/igdb-${igdbId}`)}`);
  });

  await test.step("가입하고 돌아와 처음 평가하면, 등록된 게임의 화면으로 이동해 평가가 남아 있다", async () => {
    await signUp(page, user);
    await expect(page).not.toHaveURL(/\/auth\/sign-up/);
    await page.goto(`/games/igdb-${igdbId}`);
    const slider = page.getByRole("slider", { name: "내 별점" });
    await expect(page.getByRole("note")).toContainText("아직 서비스에 등록되지 않은 게임");
    await waitForSlider(page);
    await slider.focus();
    await page.keyboard.press("5");

    await expect(page).toHaveURL(/\/games\/(?!igdb-)[a-z0-9-]+$/, { timeout: 60_000 });
    await expect(page.getByRole("note")).toHaveCount(0); // 이제 서비스에 등록된 게임이다
    await waitForSlider(page);
    await expect(slider).toHaveAttribute("aria-valuetext", "5.0점");
    await expect(page.getByText("평균 5.0 (1)", { exact: true })).toBeVisible();
  });

  await test.step("옛 미리보기 주소는 등록된 화면으로 연결된다", async () => {
    await page.goto(`/games/igdb-${igdbId}`);
    await expect(page).toHaveURL(/\/games\/(?!igdb-)[a-z0-9-]+$/);
  });
});

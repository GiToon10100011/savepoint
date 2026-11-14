import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { acquireAuthLock, cleanupTestUsers, newTestUser, signUp } from "./helpers/auth";
import { cleanupCatalogFixtures, createGameFixture, createLibraryFixtures, trackImportedIgdbGame } from "./helpers/catalog";

// 실제 Neon Auth·DB(dev 브랜치)와 실제 IGDB를 쓴다. 이 파일이 만든 계정·게임·라이브러리 항목은 끝난 뒤 지운다.
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

/** 클라이언트 컴포넌트가 React에 연결(hydration)된 뒤에야 클릭이 동작한다. */
async function waitForReact(page: Page, selector: string) {
  await page.waitForFunction((css) => {
    const el = document.querySelector(css);
    return el !== null && Object.keys(el).some((key) => key.startsWith("__reactProps"));
  }, selector);
}

const RECORD = 'section[aria-labelledby="my-record"]';
const rows = (page: Page) => page.getByRole("list", { name: "라이브러리 목록" }).getByRole("listitem");
const tab = (page: Page, name: string) => page.getByRole("navigation", { name: "라이브러리 보기" }).getByRole("link", { name, exact: true });

test("라이브러리에 추가하고 상태·진행도·날짜·메모를 기록한다(평가와는 독립이다)", async ({ page }) => {
  const user = newTestUser();
  const game = await createGameFixture();
  const panel = page.locator(`${RECORD} details`);
  const slider = page.getByRole("slider", { name: "내 별점" });

  await test.step("가입한 뒤 상세 화면에서 라이브러리에 추가한다(상태 미지정)", async () => {
    await signUp(page, user);
    await expect(page).not.toHaveURL(/\/auth\/sign-up/);
    await page.goto(`/games/${game.slug}`);
    await waitForReact(page, `${RECORD} button`);
    await page.getByRole("button", { name: "라이브러리에 추가" }).click();
    await expect(panel.locator("form")).toBeVisible(); // 새로 추가하면 바로 채울 수 있게 펼쳐진다
    await expect(panel.locator("summary")).toContainText("상태 미지정");
    await expect(page.getByRole("button", { name: "라이브러리에 추가" })).toHaveCount(0);
  });

  await test.step("상태·진행도·날짜·플레이 시간·플랫폼·메모를 저장하면 새로고침해도 남는다", async () => {
    await panel.getByLabel("플레이 중", { exact: true }).check();
    await panel.getByLabel("진행도 % (선택)").fill("40");
    await panel.getByLabel("진행 상황 (선택)").fill("챕터 3");
    await panel.getByLabel("플레이 시간(시간)").fill("2");
    await panel.getByLabel("플레이 시간(분)").fill("5");
    await panel.getByRole("button", { name: "오늘 (플레이 시작일에 입력)" }).click();
    await expect(panel.getByLabel("플레이 시작일", { exact: true })).toHaveValue(/^\d{4}-\d{2}-\d{2}$/);
    await panel.locator("#platformId").selectOption({ index: 1 });
    const platform = (await panel.locator("#platformId option:checked").textContent()) ?? "";
    await panel.getByLabel("메모 (선택)").fill("E2E 메모\n두 번째 줄");
    await panel.getByRole("button", { name: "저장", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("저장했어요.");
    await expect(panel.locator("summary")).toContainText("플레이 중");
    await expect(panel.locator("summary")).toContainText(`40% · 챕터 3 · ${platform}`);

    await page.reload();
    await expect(panel.locator("summary")).toContainText("플레이 중");
    await panel.locator("summary").click(); // 저장한 값이 있으면 접힌 채로 열린다
    await expect(panel.getByLabel("진행도 % (선택)")).toHaveValue("40");
    await expect(panel.getByLabel("플레이 시간(시간)")).toHaveValue("2");
    await expect(panel.getByLabel("플레이 시간(분)")).toHaveValue("5");
    await expect(panel.getByLabel("플레이 시작일", { exact: true })).toHaveValue(/^\d{4}-\d{2}-\d{2}$/);
    await expect(panel.getByLabel("메모 (선택)")).toHaveValue("E2E 메모\n두 번째 줄");
  });

  await test.step("엔딩일이 시작일보다 앞서면 한국어로 알리고 입력을 지우지 않으며 저장하지 않는다", async () => {
    await panel.getByLabel("엔딩 완료", { exact: true }).check();
    await panel.getByLabel("플레이 시작일", { exact: true }).fill("2026-05-10");
    await panel.getByLabel("엔딩 달성일", { exact: true }).fill("2026-05-09");
    await panel.getByRole("button", { name: "저장", exact: true }).click();
    await expect(panel.getByText("엔딩 달성일은 플레이 시작일과 같거나 이후여야 해요.")).toBeVisible();
    await expect(panel.getByLabel("엔딩 달성일", { exact: true })).toHaveValue("2026-05-09"); // 입력이 남아 있다
    await expect(panel.getByLabel("엔딩 달성일", { exact: true })).toHaveAttribute("aria-invalid", "true");
    await expect(panel.locator("summary")).toContainText("플레이 중"); // 저장되지 않았다
  });

  await test.step("엔딩일을 바로잡아 저장해도 평가는 자동으로 생기지 않는다", async () => {
    await panel.getByLabel("엔딩 달성일", { exact: true }).fill("2026-05-20");
    await panel.getByRole("button", { name: "저장", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("저장했어요.");
    await expect(panel.locator("summary")).toContainText("엔딩 완료");
    await expect(slider).toHaveAttribute("aria-valuetext", "평가하지 않음");
    await expect(page.getByText("아직 평가가 없어요")).toBeVisible();
  });

  await test.step("내 라이브러리 화면에 상태·진행도가 보이고, 탭으로 걸러 볼 수 있다", async () => {
    await page.getByRole("link", { name: "라이브러리", exact: true }).first().click();
    await expect(page).toHaveURL(/\/library$/);
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText(game.title);
    await expect(rows(page).first()).toContainText("엔딩 완료");
    await expect(rows(page).first()).toContainText("40% · 챕터 3");
    await expect(rows(page).first()).toContainText("평가하지 않음");

    await tab(page, "플레이 중").click();
    await expect(page).toHaveURL(/filter=playing$/);
    await expect(page.getByText("조건에 맞는 게임이 없어요.")).toBeVisible();
    await tab(page, "엔딩 완료").click();
    await expect(rows(page)).toHaveCount(1);
    await tab(page, "평가함").click();
    await expect(page.getByText("조건에 맞는 게임이 없어요.")).toBeVisible(); // 평가하지 않았으니 비어 있다
  });

  await test.step("별점을 남기면 `평가함`에 나온다", async () => {
    await page.goto(`/games/${game.slug}`);
    await waitForReact(page, '[role="slider"]');
    await slider.focus();
    await page.keyboard.press("4");
    await expect(page.getByText("평균 4.0 (1)", { exact: true })).toBeVisible(); // 서버 저장이 끝난 뒤에 이동한다
    await page.goto("/library?filter=rated");
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText("내 평가 4.0점");
  });

  await test.step("라이브러리에서 삭제해도 평가는 남는다", async () => {
    await page.goto(`/games/${game.slug}`);
    await panel.locator("summary").click();
    page.once("dialog", (dialog) => dialog.accept());
    await panel.getByRole("button", { name: "라이브러리에서 삭제" }).click();
    await expect(page.getByRole("button", { name: "라이브러리에 추가" })).toBeVisible();
    await expect(panel).toHaveCount(0);
    await expect(slider).toHaveAttribute("aria-valuetext", "4.0점"); // 평가는 그대로다
    await page.goto("/library");
    await expect(page.getByText("라이브러리가 비었어요.")).toBeVisible();
  });
});

test("라이브러리 목록: 한 페이지를 넘으면 더 보기로 이어 보고, 상태·정렬로 걸러 본다", async ({ page }) => {
  const user = newTestUser();
  await signUp(page, user);
  await expect(page).not.toHaveURL(/\/auth\/sign-up/);
  // 프로필은 세션을 읽는 첫 화면에서 만들어진다. 그 화면을 한 번 연 뒤에야 닉네임으로 프로필을 찾을 수 있다.
  await page.goto("/library");
  await expect(page.getByText("라이브러리가 비었어요.")).toBeVisible();
  const { titles } = await createLibraryFixtures(user.nickname, 21);
  const title = (i: number) => titles[i];

  await test.step("최근 등록 순으로 20건을 보여 주고, 더 보기로 나머지를 이어 본다", async () => {
    await page.goto("/library");
    await expect(rows(page)).toHaveCount(20);
    await expect(rows(page).first()).toContainText(title(20)); // 가장 최근에 등록한 것이 먼저다
    await expect(rows(page).filter({ hasText: title(0) })).toHaveCount(0);
    await page.getByRole("link", { name: "더 보기" }).click();
    await expect(page).toHaveURL(/cursor=/);
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText(title(0));
    await expect(page.getByRole("link", { name: "더 보기" })).toHaveCount(0);
  });

  await test.step("상태 탭: 플레이 중은 짝수 번호 11건이고 더 보기가 없다", async () => {
    await page.goto("/library");
    await tab(page, "플레이 중").click();
    await expect(rows(page)).toHaveCount(11);
    await expect(rows(page).first()).toContainText(title(20));
    for (const row of await rows(page).all()) await expect(row).toContainText("플레이 중");
    await expect(page.getByRole("link", { name: "더 보기" })).toHaveCount(0);
  });

  await test.step("선택 상자로 `상태 미지정`만 걸러 본다(주소에 담긴다)", async () => {
    await page.goto("/library");
    await page.getByLabel("상태", { exact: true }).selectOption("unset");
    await page.getByRole("button", { name: "적용" }).click();
    // 네이티브 GET 폼은 비어 있는 선택(genre=, platform=)과 기본 정렬도 함께 싣는다.
    await expect(page).toHaveURL(/filter=unset/);
    await expect(rows(page)).toHaveCount(10);
    for (const row of await rows(page).all()) await expect(row).toContainText("상태 미지정");
  });

  await test.step("가나다 정렬은 제목 순이고 그 순서로 더 보기를 이어 본다", async () => {
    await page.goto("/library?sort=title");
    await expect(page.getByLabel("정렬", { exact: true })).toHaveValue("title");
    await expect(rows(page)).toHaveCount(20);
    await expect(rows(page).first()).toContainText(title(0));
    await expect(rows(page).nth(19)).toContainText(title(19));
    await page.getByRole("link", { name: "더 보기" }).click();
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText(title(20));
  });

  await test.step("이상한 주소 값(정렬·필터·커서)은 오류 없이 기본 화면으로 읽힌다", async () => {
    await page.goto("/library?sort=zzz&filter=bogus&cursor=%25%25%25&genre=no-such-genre-e2e");
    await expect(page.getByText("조건에 맞는 게임이 없어요.")).toBeVisible(); // 없는 장르라 비어 있을 뿐 오류가 아니다
    await page.goto("/library?sort=zzz&filter=bogus&cursor=%25%25%25");
    await expect(rows(page)).toHaveCount(20);
  });

  await test.step("목록 화면에 접근성 위반과 라운드·그림자가 없다(라이트·다크)", async () => {
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("/library"); // 처음부터 그 색으로 그려서 검사한다(전환 중간 값이 검사되지 않게)
      await expect(rows(page)).toHaveCount(20);
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}곳 — ${v.nodes[0]?.target.join(" ")}`), scheme).toEqual([]);
      const offenders = await page.evaluate(() =>
        [...document.querySelectorAll("body *")]
          .filter((el) => {
            const style = getComputedStyle(el);
            return style.borderTopLeftRadius !== "0px" || style.boxShadow !== "none";
          })
          .map((el) => el.tagName.toLowerCase()),
      );
      expect(offenders, scheme).toEqual([]);
    }
  });
});

test("라이브러리 패널: 접근성 위반과 라운드·그림자가 없다(라이트·다크)", async ({ page }) => {
  const user = newTestUser();
  const game = await createGameFixture();
  await signUp(page, user);
  await expect(page).not.toHaveURL(/\/auth\/sign-up/);
  await page.goto(`/games/${game.slug}`);
  await waitForReact(page, `${RECORD} button`);
  await page.getByRole("button", { name: "라이브러리에 추가" }).click();
  await expect(page.locator(`${RECORD} details form`)).toBeVisible();

  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.reload(); // 처음부터 그 색으로 다시 그린다
    // 값이 없는 새 항목은 새로고침 뒤에도 기본으로 펼쳐져 있다(눌러서 접으면 안 된다).
    await expect(page.locator(`${RECORD} details form`)).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}곳 — ${v.nodes[0]?.target.join(" ")}`), scheme).toEqual([]);
    const offenders = await page.evaluate(() =>
      [...document.querySelectorAll("body *")]
        .filter((el) => {
          const style = getComputedStyle(el);
          return style.borderTopLeftRadius !== "0px" || style.boxShadow !== "none";
        })
        .map((el) => el.tagName.toLowerCase()),
    );
    expect(offenders, scheme).toEqual([]);
  }
});

test("미리보기 게임을 처음 라이브러리에 추가하면 서비스에 등록되고 그 게임의 화면으로 이동한다(실제 IGDB)", async ({ page }) => {
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

  await test.step("가입하고 돌아와 `라이브러리에 추가`를 누르면 등록된 게임 화면으로 이동해 항목이 생긴다", async () => {
    await signUp(page, user);
    await expect(page).not.toHaveURL(/\/auth\/sign-up/);
    await page.goto(`/games/igdb-${igdbId}`);
    await expect(page.getByRole("note")).toContainText("아직 서비스에 등록되지 않은 게임");
    await waitForReact(page, `${RECORD} button`);
    await page.getByRole("button", { name: "라이브러리에 추가" }).click();

    await expect(page).toHaveURL(/\/games\/(?!igdb-)[a-z0-9-]+$/, { timeout: 60_000 });
    await expect(page.getByRole("note")).toHaveCount(0); // 이제 서비스에 등록된 게임이다
    await expect(page.locator(`${RECORD} details summary`)).toContainText("상태 미지정");
    await page.goto("/library");
    await expect(rows(page)).toHaveCount(1);
  });
});

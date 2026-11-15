import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { acquireAuthLock, cleanupTestUsers, newTestUser, signUp } from "./helpers/auth";
import { cleanupCatalogFixtures, createGameFixture, createReviewFixtures, trackImportedIgdbGame } from "./helpers/catalog";

// 실제 Neon Auth·DB(dev 브랜치)와 실제 IGDB를 쓴다. 이 파일이 만든 계정·게임·리뷰는 끝난 뒤 지운다.
test.afterAll(async () => {
  await cleanupTestUsers();
  await cleanupCatalogFixtures();
});

// 가입이 들어 있어 인증 E2E와 같은 이유로(Neon Auth 429) 모바일·데스크톱 워커가 번갈아 돌게 줄 세운다.
let release: (() => Promise<void>) | undefined;
test.beforeEach(async ({}, testInfo) => {
  test.setTimeout(240_000);
  // 가입하지 않는 시험(방문자)은 잠금이 필요 없다. 잠금을 기다리다 시간이 초과되는 것을 막는다.
  if (testInfo.annotations.some((annotation) => annotation.type === "no-auth-lock")) return;
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
/**
 * `내 기록`의 리뷰 패널(라이브러리 패널과 같은 `details`라서 리뷰 입력칸을 가진 것으로 고른다). `:visible`은 이전 화면 때문이다:
 * Next(cacheComponents)는 다른 게임 화면으로 이동해도 이전 화면을 숨긴 채 DOM에 남겨 두므로, 미리보기에서 등록된 게임으로
 * 이동하면 숨겨진 이전 패널도 함께 일치한다.
 */
const reviewPanel = (page: Page) => page.locator(`${RECORD}:visible details`).filter({ has: page.locator("#review-body") });
const items = (page: Page) => page.getByRole("list", { name: "리뷰 목록" }).getByRole("listitem");
const heading = (page: Page) => page.getByRole("heading", { name: /^리뷰 \d/ });
const sortLink = (page: Page, name: string) => page.getByRole("navigation", { name: "리뷰 정렬" }).getByRole("link", { name, exact: true });
const save = (page: Page) => reviewPanel(page).getByRole("button", { name: "저장", exact: true });

/** 목록의 작성자 닉네임을 위에서부터 읽는다. */
async function order(page: Page): Promise<string[]> {
  const cards = await items(page).all();
  return Promise.all(cards.map(async (card) => ((await card.locator("span.font-semibold").first().textContent()) ?? "").trim()));
}

test("리뷰를 쓰고 고치고 지운다(평가·라이브러리와는 독립이다)", async ({ page }) => {
  const user = newTestUser();
  const game = await createGameFixture();
  const panel = reviewPanel(page);
  const slider = page.getByRole("slider", { name: "내 별점" });

  await test.step("가입한 뒤 평가 없이 리뷰를 쓴다(공개·스포일러 포함)", async () => {
    await signUp(page, user);
    await expect(page).not.toHaveURL(/\/auth\/sign-up/);
    await page.goto(`/games/${game.slug}`);
    await waitForReact(page, `${RECORD} button`);
    await expect(panel.locator("summary")).toContainText("리뷰 쓰기");
    await panel.locator("summary").click();
    await panel.locator("#review-body").fill("첫 줄\n두 번째 줄");
    await panel.getByLabel("스포일러가 포함돼 있어요").check();
    await save(page).click();
    await expect(page.getByRole("status")).toContainText("저장했어요.");
    await expect(panel.locator("summary")).toContainText("내 리뷰");
    await expect(panel.locator("summary")).toContainText("공개");
    await expect(panel.locator("summary")).toContainText("스포일러");
    await expect(panel.locator("summary")).toContainText("좋아요 0");
    // 리뷰를 써도 평가는 생기지 않고, 라이브러리 항목도 만들어지지 않는다.
    await expect(slider).toHaveAttribute("aria-valuetext", "평가하지 않음");
    await expect(page.getByRole("button", { name: "라이브러리에 추가" })).toBeVisible();
  });

  await test.step("내 리뷰가 목록에 나온다(스포일러는 접혀 있고, 눌러야 읽힌다)", async () => {
    await expect(heading(page)).toHaveText(/리뷰 1$/);
    await expect(items(page)).toHaveCount(1);
    const item = items(page).first();
    await expect(item).toContainText(user.nickname);
    await expect(item).toContainText("내 리뷰");
    await expect(item.getByText("두 번째 줄")).toBeHidden();
    await item.getByText("스포일러가 포함된 리뷰예요").click();
    await expect(item.getByText("두 번째 줄")).toBeVisible();
    // 내 리뷰에는 좋아요를 누를 수 없다(수만 보인다).
    await expect(item.getByRole("button", { name: /좋아요/ })).toHaveCount(0);
    await expect(item).toContainText("좋아요 0");
  });

  await test.step("새로고침 없이 공개 범위를 바꿔 거듭 저장해도 손대지 않은 값(스포일러·본문)이 남는다", async () => {
    await panel.getByLabel("비공개", { exact: true }).check();
    await save(page).click();
    await expect(page.getByRole("status")).toContainText("저장했어요.");
    await expect(panel.locator("summary")).toContainText("비공개");
    await expect(panel.getByLabel("비공개", { exact: true })).toBeChecked(); // 폼 초기화가 되돌리지 않는다
    await expect(panel.getByLabel("스포일러가 포함돼 있어요")).toBeChecked();
    await expect(panel.locator("#review-body")).toHaveValue("첫 줄\n두 번째 줄");
    // 비공개 리뷰는 목록과 수에서 빠진다(내 기록에만 보인다).
    await expect(heading(page)).toHaveText(/리뷰 0$/);
    await expect(page.getByText("아직 공개 리뷰가 없어요.")).toBeVisible();

    await panel.locator("#review-body").fill("고친 글");
    await save(page).click();
    await expect(page.getByRole("status")).toContainText("저장했어요.");
    await expect(panel.locator("summary")).toContainText("비공개"); // 본문만 고쳐 저장해도 공개 범위가 풀리지 않는다
    await expect(panel.locator("summary")).toContainText("스포일러");
    await expect(panel.getByLabel("비공개", { exact: true })).toBeChecked();
    await expect(panel.getByLabel("스포일러가 포함돼 있어요")).toBeChecked();
  });

  await test.step("새로고침해도 저장한 값이 남는다", async () => {
    await page.reload();
    await expect(panel.locator("summary")).toContainText("내 리뷰");
    await expect(panel.locator("summary")).toContainText("비공개");
    await panel.locator("summary").click();
    await expect(panel.locator("#review-body")).toHaveValue("고친 글");
    await expect(panel.getByLabel("비공개", { exact: true })).toBeChecked();
    await expect(panel.getByLabel("스포일러가 포함돼 있어요")).toBeChecked();
  });

  await test.step("라이브러리의 `리뷰 작성함`에는 비공개로 쓴 리뷰의 게임도 나오고, 평가함과는 별개다", async () => {
    // 리뷰·평가·라이브러리는 서로 독립이라 라이브러리에 추가해야 이 목록에 보인다.
    await page.getByRole("button", { name: "라이브러리에 추가" }).click();
    await expect(page.getByRole("button", { name: "라이브러리에 추가" })).toHaveCount(0);
    await page.goto("/library");
    await page.getByRole("navigation", { name: "라이브러리 보기" }).getByRole("link", { name: "리뷰 작성함", exact: true }).click();
    await expect(page).toHaveURL(/filter=reviewed/);
    await expect(page.getByLabel("상태", { exact: true })).toHaveValue("reviewed"); // 탭으로 이동해도 선택 상자가 따라간다
    const rows = page.getByRole("list", { name: "라이브러리 목록" }).getByRole("listitem");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText(game.title);
    await page.goto("/library?filter=rated");
    await expect(page.getByText("조건에 맞는 게임이 없어요.")).toBeVisible(); // 아직 평가하지 않았다
    await page.goto(`/games/${game.slug}`);
    await waitForReact(page, `${RECORD} button`);
    await panel.locator("summary").click(); // 새로 연 화면이라 리뷰 패널이 접혀 있다(다음 단계가 폼을 쓴다)
  });

  await test.step("별점을 남기고 다시 공개하면 목록에 별점과 `수정됨`이 보인다", async () => {
    await waitForReact(page, '[role="slider"]');
    await slider.focus();
    await page.keyboard.press("4");
    await expect(page.getByText("평균 4.0 (1)", { exact: true })).toBeVisible(); // 서버 저장이 끝난 뒤에 이어 간다
    await panel.getByLabel("공개", { exact: true }).check();
    await save(page).click();
    await expect(page.getByRole("status")).toContainText("저장했어요.");
    await expect(heading(page)).toHaveText(/리뷰 1$/);
    const item = items(page).first();
    await expect(item).toContainText("작성자의 별점 4.0점");
    await expect(item).toContainText("수정됨");
  });

  await test.step("리뷰를 지워도 평가는 남고, 새 폼은 비어 있다", async () => {
    page.once("dialog", (dialog) => dialog.accept());
    await panel.getByRole("button", { name: "리뷰 삭제" }).click();
    await expect(panel.locator("summary")).toContainText("리뷰 쓰기");
    await expect(heading(page)).toHaveText(/리뷰 0$/);
    await expect(slider).toHaveAttribute("aria-valuetext", "4.0점"); // 평가는 그대로다
    await panel.locator("summary").click();
    await expect(panel.locator("#review-body")).toHaveValue("");
    await expect(panel.getByLabel("공개", { exact: true })).toBeChecked(); // 새 폼의 기본 공개 범위
    await expect(panel.getByLabel("스포일러가 포함돼 있어요")).not.toBeChecked();
  });

  await test.step("올바르지 않은 입력은 한국어로 알리고 입력을 지우지 않는다", async () => {
    await panel.locator("#review-body").fill("   ");
    await save(page).click();
    await expect(panel.getByText("리뷰 내용을 입력해 주세요.")).toBeVisible();
    await expect(panel.locator("#review-body")).toHaveAttribute("aria-invalid", "true");
    await panel.locator("#review-body").fill("가".repeat(5001));
    await save(page).click();
    await expect(panel.getByText("리뷰는 5,000자까지 쓸 수 있어요. (지금 5,001자)")).toBeVisible();
    await expect(panel.locator("#review-body")).toHaveValue("가".repeat(5001)); // 입력이 남아 있다
    await expect(heading(page)).toHaveText(/리뷰 0$/); // 저장되지 않았다
  });
});

test("다른 사람의 리뷰: 좋아요 순·최신순으로 읽고, 좋아요를 누르고 취소하며, 비공개 리뷰는 보이지 않는다", async ({ page }) => {
  const user = newTestUser();
  const game = await createGameFixture();
  await createReviewFixtures(game.slug, [
    { nickname: "리뷰어에이", body: "에이의 글", likes: 5, minutesAgo: 30, rating: 8 },
    { nickname: "리뷰어비", body: "비의 글", likes: 2, minutesAgo: 10 },
    { nickname: "리뷰어씨", body: "씨의 스포일러 글", likes: 9, minutesAgo: 60, hasSpoiler: true },
    { nickname: "리뷰어디", body: "디의 비공개 글", likes: 50, visibility: "private" },
  ]);
  const item = (nickname: string) => items(page).filter({ hasText: nickname });
  const likeButton = (nickname: string) => item(nickname).getByRole("button", { name: /^좋아요/ });
  /** 좋아요를 누르면 서버 응답이 올 때까지 기다린다(응답 전에 새로고침하면 저장되지 않은 채 끝난다). */
  const toggle = async (nickname: string) => {
    const saved = page.waitForResponse((response) => response.request().method() === "POST" && response.url().includes(`/games/${game.slug}`));
    await likeButton(nickname).click();
    await saved;
  };

  await signUp(page, user);
  await expect(page).not.toHaveURL(/\/auth\/sign-up/);
  await page.goto(`/games/${game.slug}`);
  await waitForReact(page, `${RECORD} button`);

  await test.step("공개 리뷰 3개가 좋아요 순으로 나오고, 비공개 리뷰는 보이지도 세지도 않는다", async () => {
    await expect(heading(page)).toHaveText(/리뷰 3$/);
    await expect.poll(() => order(page)).toEqual(["리뷰어씨", "리뷰어에이", "리뷰어비"]);
    await expect(page.getByText("디의 비공개 글")).toHaveCount(0);
    await expect(page.getByText("리뷰어디")).toHaveCount(0);
    await expect(sortLink(page, "좋아요 순")).toHaveAttribute("aria-current", "page");
    // 작성자의 별점(리뷰와 별개로 남긴 것)이 있으면 보이고, 없으면 보이지 않는다.
    await expect(item("리뷰어에이")).toContainText("작성자의 별점 4.0점");
    await expect(item("리뷰어비")).not.toContainText("작성자의 별점");
    // 스포일러가 있는 리뷰는 접혀 있다.
    await expect(item("리뷰어씨").getByText("씨의 스포일러 글")).toBeHidden();
    await expect(item("리뷰어에이").getByText("에이의 글")).toBeVisible();
  });

  await test.step("최신순으로 바꾸면 주소에 담기고 최근에 쓴 글이 위에 온다", async () => {
    await sortLink(page, "최신순").click();
    await expect(page).toHaveURL(/reviewSort=recent/);
    await expect(sortLink(page, "최신순")).toHaveAttribute("aria-current", "page");
    await expect.poll(() => order(page)).toEqual(["리뷰어비", "리뷰어에이", "리뷰어씨"]);
    await sortLink(page, "좋아요 순").click();
    await expect.poll(() => order(page)).toEqual(["리뷰어씨", "리뷰어에이", "리뷰어비"]);
  });

  await test.step("좋아요를 누르면 바로 늘고 새로고침해도 남으며, 다시 누르면 취소된다", async () => {
    await expect(likeButton("리뷰어에이")).toHaveAttribute("aria-pressed", "false");
    await expect(likeButton("리뷰어에이")).toContainText("5");
    await toggle("리뷰어에이");
    await expect(likeButton("리뷰어에이")).toHaveAttribute("aria-pressed", "true");
    await expect(likeButton("리뷰어에이")).toContainText("6");
    await page.reload();
    await expect(likeButton("리뷰어에이")).toHaveAttribute("aria-pressed", "true");
    await expect(likeButton("리뷰어에이")).toContainText("6");

    await toggle("리뷰어에이");
    await expect(likeButton("리뷰어에이")).toHaveAttribute("aria-pressed", "false");
    await expect(likeButton("리뷰어에이")).toContainText("5");
    await page.reload();
    await expect(likeButton("리뷰어에이")).toHaveAttribute("aria-pressed", "false");
    await expect(likeButton("리뷰어에이")).toContainText("5");
  });

  await test.step("내가 쓴 리뷰에는 좋아요 버튼이 없고(수만 보인다), 다른 사람의 리뷰 순서는 그대로다", async () => {
    const panel = reviewPanel(page);
    await panel.locator("summary").click();
    await panel.locator("#review-body").fill("내가 쓴 글");
    await save(page).click();
    await expect(page.getByRole("status")).toContainText("저장했어요.");
    await expect(heading(page)).toHaveText(/리뷰 4$/);
    await expect(item(user.nickname).getByRole("button", { name: /좋아요/ })).toHaveCount(0);
    await expect(item(user.nickname)).toContainText("좋아요 0");
    await expect(item(user.nickname)).toContainText("내 리뷰");
    await expect.poll(() => order(page)).toEqual(["리뷰어씨", "리뷰어에이", "리뷰어비", user.nickname]); // 좋아요 0은 맨 뒤
  });
});

test("방문자(로그인하지 않음)는 공개 리뷰를 읽을 수 있고, 한 페이지를 넘으면 `더 보기`로 이어 본다", { annotation: { type: "no-auth-lock", description: "가입하지 않아 인증 잠금이 필요 없다" } }, async ({ page }) => {
  const game = await createGameFixture();
  // 공개 리뷰 12개: 좋아요 11…0, 최신순은 번호 0이 가장 최근이다. 비공개 1개는 어디에도 나오지 않는다.
  await createReviewFixtures(game.slug, [
    ...Array.from({ length: 12 }, (_, i) => ({ nickname: `작성자${String(i).padStart(2, "0")}`, body: `글 ${i}`, likes: 11 - i, minutesAgo: i + 1 })),
    { nickname: "비공개작성자", body: "비공개 글", likes: 99, visibility: "private" as const },
  ]);
  const expected = (indexes: number[]) => indexes.map((i) => `작성자${String(i).padStart(2, "0")}`);
  const range = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => from + i);

  await page.goto(`/games/${game.slug}`);
  await expect(heading(page)).toHaveText(/리뷰 12$/);

  await test.step("방문자에게는 좋아요 버튼이 없고 수만 보인다. 내 기록 자리에는 로그인 안내가 있다", async () => {
    await expect(page.getByRole("button", { name: /좋아요/ })).toHaveCount(0);
    await expect(items(page).first()).toContainText("좋아요 11");
    await expect(page.getByRole("link", { name: "로그인하고 기록하기" })).toBeVisible();
    await expect(page.getByText("비공개 글")).toHaveCount(0);
  });

  await test.step("좋아요 순: 첫 페이지 10개 다음에 `더 보기`로 나머지 2개를 이어 본다", async () => {
    await expect(items(page)).toHaveCount(10);
    expect(await order(page)).toEqual(expected(range(0, 10)));
    await page.getByRole("link", { name: "더 보기" }).click();
    await expect(page).toHaveURL(/reviewCursor=/);
    await expect(items(page)).toHaveCount(2);
    expect(await order(page)).toEqual(expected([10, 11]));
    await expect(page.getByRole("link", { name: "더 보기" })).toHaveCount(0);
  });

  await test.step("최신순에서도 같은 방식으로 빠짐없이 이어 본다", async () => {
    await page.goto(`/games/${game.slug}?reviewSort=recent`);
    await expect(items(page)).toHaveCount(10);
    expect(await order(page)).toEqual(expected(range(0, 10)));
    await page.getByRole("link", { name: "더 보기" }).click();
    await expect(items(page)).toHaveCount(2);
    expect(await order(page)).toEqual(expected([10, 11]));
  });

  await test.step("이상한 주소 값(정렬·커서)은 오류 없이 기본 화면으로 읽힌다", async () => {
    await page.goto(`/games/${game.slug}?reviewSort=zzz&reviewCursor=%25%25%25`);
    await expect(items(page)).toHaveCount(10);
    await page.goto(`/games/${game.slug}?reviewCursor=${Buffer.from(JSON.stringify(["3", "2026-02-30 00:00:00+00", "x"])).toString("base64url")}`);
    await expect(items(page)).toHaveCount(10);
  });
});

test("리뷰 영역에 접근성 위반과 라운드·그림자가 없다(라이트·다크)", async ({ page }) => {
  const user = newTestUser();
  const game = await createGameFixture();
  await createReviewFixtures(game.slug, [
    { nickname: "리뷰어에이", body: "에이의 글", likes: 5, minutesAgo: 30, rating: 8 },
    { nickname: "리뷰어씨", body: "씨의 스포일러 글", likes: 9, minutesAgo: 60, hasSpoiler: true },
  ]);
  await signUp(page, user);
  await expect(page).not.toHaveURL(/\/auth\/sign-up/);
  await page.goto(`/games/${game.slug}`);
  await waitForReact(page, `${RECORD} button`);
  await reviewPanel(page).locator("summary").click();
  await reviewPanel(page).locator("#review-body").fill("접근성 검사용 글");
  await save(page).click();
  await expect(page.getByRole("status")).toContainText("저장했어요.");

  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.reload(); // 처음부터 그 색으로 다시 그려서 검사한다(전환 중간 값이 검사되지 않게)
    await expect(items(page)).toHaveCount(3);
    await reviewPanel(page).locator("summary").click(); // 폼이 펼쳐진 상태도 검사한다
    await expect(reviewPanel(page).locator("#review-body")).toBeVisible();
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

test("미리보기 게임에 처음 리뷰를 쓰면 서비스에 등록되고 그 게임의 화면으로 이동한다(실제 IGDB)", async ({ page }) => {
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

  await test.step("가입하고 돌아와 리뷰를 쓰면 등록된 게임 화면으로 이동해 내 리뷰가 보인다", async () => {
    await signUp(page, user);
    await expect(page).not.toHaveURL(/\/auth\/sign-up/);
    await page.goto(`/games/igdb-${igdbId}`);
    await expect(page.getByRole("note")).toContainText("아직 서비스에 등록되지 않은 게임");
    await waitForReact(page, `${RECORD} button`);
    const panel = reviewPanel(page);
    await panel.locator("summary").click();
    await panel.locator("#review-body").fill("처음 쓰는 리뷰");
    await save(page).click();

    await expect(page).toHaveURL(/\/games\/(?!igdb-)[a-z0-9-]+$/, { timeout: 60_000 });
    await expect(page.getByRole("note")).toHaveCount(0); // 이제 서비스에 등록된 게임이다
    await expect(reviewPanel(page).locator("summary")).toContainText("내 리뷰");
    await expect(heading(page)).toHaveText(/리뷰 1$/);
    await expect(items(page).first()).toContainText("처음 쓰는 리뷰");
  });
});

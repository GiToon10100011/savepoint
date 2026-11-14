import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { cleanupCatalogFixtures, createGameFixture, createTaggedGames, type GameFixture } from "./helpers/catalog";

// 실제 DB(dev 브랜치)를 쓴다. 이 파일이 직접 만든 게임·태그·회사는 끝난 뒤 지운다.
test.afterAll(cleanupCatalogFixtures);

let rated: GameFixture;
let unrated: GameFixture;
let tagged: Awaited<ReturnType<typeof createTaggedGames>>;

test.beforeAll(async () => {
  rated = await createGameFixture({ ratingCount: 1_234, ratingSum: 10_366 }); // 평균 10,366 / 1,234 / 2 = 4.2
  unrated = await createGameFixture();
  tagged = await createTaggedGames(21); // 한 페이지(20건)를 넘겨 `더 보기`를 시험한다
});

/** 주소가 그 경로로 끝나는지. 보호 경로로 취급돼 로그인 화면으로 보내졌다면 실패한다(`?redirectTo=`가 붙어 끝이 다르다). */
const atPath = (path: string) => new RegExp(`${path.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}$`);

/** 목록 화면의 게임 카드 링크. 카드 이름에는 제목이 들어 있다. */
const card = (page: Page, listName: string, title: string) => page.getByRole("list", { name: listName }).getByRole("link", { name: title });

test.describe("게임 상세", () => {
  test("평균 평점과 평가 수를 `4.2 (1,234)` 형식으로 보여 주고, 스크린리더에는 풀어 읽어 준다", async ({ page }) => {
    await page.goto(`/games/${rated.slug}`);
    await expect(page.getByRole("heading", { level: 1, name: rated.title })).toBeVisible();
    await expect(page.getByText("평균 4.2 (1,234)")).toBeVisible();
    await expect(page.getByText("평균 4.2점, 1,234명이 평가")).toBeAttached();
  });

  test("평가가 없으면 평균 대신 안내 문구를 보여 준다", async ({ page }) => {
    await page.goto(`/games/${unrated.slug}`);
    await expect(page.getByText("아직 평가가 없어요")).toBeVisible();
    await expect(page.getByText(/^평균 /)).toHaveCount(0);
  });

  test("탭 제목이 게임 이름이다", async ({ page }) => {
    await page.goto(`/games/${rated.slug}`);
    await expect(page).toHaveTitle(rated.title);
  });

  test("커버는 원본 비율을 그대로 유지한다", async ({ page }) => {
    await page.goto("/games/elden-ring"); // dev에 시드된 IGDB 게임(커버 있음)
    const cover = page.getByRole("img", { name: /커버$/ });
    await expect(cover).toBeVisible();
    await expect.poll(() => cover.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0), { timeout: 30_000 }).toBe(true);
    const { natural, shown } = await cover.evaluate((img: HTMLImageElement) => {
      const box = img.getBoundingClientRect();
      return { natural: img.naturalWidth / img.naturalHeight, shown: box.width / box.height };
    });
    // 화면에 그려진 가로·세로 비율이 이미지 원본과 거의 같다(테두리 1px 정도의 오차만 허용한다).
    expect(Math.abs(shown - natural) / natural).toBeLessThan(0.02);
  });
});

test.describe("분류·회사 링크", () => {
  test("장르 이름을 누르면 그 장르의 게임 목록으로 간다", async ({ page }) => {
    await page.goto(`/games/${rated.slug}`);
    await page.getByRole("link", { name: "RPG", exact: true }).click();
    await expect(page).toHaveURL(/\/genres\/rpg$/);
    await expect(page.getByRole("heading", { level: 1, name: "RPG" })).toBeVisible();
    await expect(page).toHaveTitle("RPG 게임");
    await expect(card(page, "RPG 게임 목록", rated.title)).toBeVisible(); // 평가 수가 많아 첫 페이지 앞쪽에 있다
  });

  test("태그 이름을 누르면 그 태그의 게임 목록으로 간다", async ({ page }) => {
    await page.goto(`/games/${rated.slug}`);
    await page.getByRole("link", { name: rated.tag.name }).click();
    await expect(page).toHaveURL(new RegExp(`/tags/${rated.tag.slug}$`));
    await expect(page.getByRole("heading", { level: 1, name: rated.tag.name })).toBeVisible();
    await expect(card(page, `${rated.tag.name} 게임 목록`, rated.title)).toBeVisible();
  });

  test("개발사를 누르면 회사 화면의 `개발한 게임`으로 간다", async ({ page }) => {
    await page.goto(`/games/${rated.slug}`);
    await page.getByRole("link", { name: rated.developer.name }).click();
    await expect(page).toHaveURL(new RegExp(`/companies/${rated.developer.slug}$`));
    await expect(page.getByRole("heading", { level: 1, name: rated.developer.name })).toBeVisible();
    await expect(page.getByRole("link", { name: /^개발한 게임/ })).toHaveAttribute("aria-current", "page");
    await expect(card(page, "개발한 게임", rated.title)).toBeVisible();
  });

  test("퍼블리싱만 한 회사는 `퍼블리싱한 게임`이 먼저 열린다", async ({ page }) => {
    await page.goto(`/games/${rated.slug}`);
    await page.getByRole("link", { name: rated.publisher.name }).click();
    await expect(page.getByRole("heading", { level: 1, name: rated.publisher.name })).toBeVisible();
    await expect(page.getByRole("link", { name: /^퍼블리싱한 게임/ })).toHaveAttribute("aria-current", "page");
    await expect(card(page, "퍼블리싱한 게임", rated.title)).toBeVisible();
  });

  test("개발도 퍼블리싱도 한 회사는 두 목록을 오갈 수 있다", async ({ page }) => {
    await page.goto(`/companies/${rated.both.slug}`);
    await expect(page.getByRole("link", { name: /^개발한 게임/ })).toHaveText(/개발한 게임\s*1/);
    await expect(page.getByRole("link", { name: /^퍼블리싱한 게임/ })).toHaveText(/퍼블리싱한 게임\s*1/);
    await expect(card(page, "개발한 게임", rated.title)).toBeVisible();

    await page.getByRole("link", { name: /^퍼블리싱한 게임/ }).click();
    await expect(page).toHaveURL(/role=publisher$/);
    await expect(page.getByRole("link", { name: /^퍼블리싱한 게임/ })).toHaveAttribute("aria-current", "page");
    await expect(card(page, "퍼블리싱한 게임", rated.title)).toBeVisible();
  });

  test("상세 화면의 장르·태그·회사 링크는 모두 실제 화면으로 열린다", async ({ page }) => {
    await page.goto(`/games/${rated.slug}`);
    const hrefs = await page
      .locator('article a[href^="/genres/"], article a[href^="/tags/"], article a[href^="/companies/"]')
      .evaluateAll((links) => links.map((a) => a.getAttribute("href") as string));
    expect(hrefs).toHaveLength(6); // 장르 1 + 태그 1 + 개발사 2 + 퍼블리셔 2
    for (const href of hrefs) {
      await page.goto(href);
      await expect(page, href).toHaveURL(atPath(href));
      await expect(page.getByRole("heading", { level: 1 }), href).toBeVisible();
      await expect(page.getByText("This page could not be found"), href).toHaveCount(0);
    }
  });

  test("없는 장르·태그·회사 주소는 찾을 수 없다 화면을 보여 준다", async ({ page }) => {
    for (const path of ["/genres/no-such-genre-e2e", "/tags/no-such-tag-e2e", "/companies/no-such-company-e2e"]) {
      await page.goto(path);
      await expect(page.getByText("This page could not be found"), path).toBeVisible();
    }
  });

  test("한 페이지를 넘는 목록은 `더 보기`로 이어 본다", async ({ page }) => {
    const name = `${tagged.tag.name} 게임 목록`;
    await page.goto(`/tags/${tagged.tag.slug}`);
    const list = page.getByRole("list", { name });
    await expect(list.getByRole("listitem")).toHaveCount(20);
    await expect(card(page, name, tagged.titles[0])).toBeVisible(); // 평가 수가 가장 많은 게임이 먼저다
    await expect(card(page, name, tagged.titles[20])).toHaveCount(0);

    await page.getByRole("link", { name: "더 보기" }).click();
    await expect(page).toHaveURL(/cursor=/);
    await expect(list.getByRole("listitem")).toHaveCount(1);
    await expect(card(page, name, tagged.titles[20])).toBeVisible();
    await expect(page.getByRole("link", { name: "더 보기" })).toHaveCount(0);
  });
});

test.describe("접근성과 디자인 규칙 (상세·분류·회사 화면)", () => {
  const targets: [string, () => string][] = [
    ["상세", () => `/games/${rated.slug}`],
    ["장르", () => "/genres/rpg"],
    ["태그", () => `/tags/${rated.tag.slug}`],
    ["회사", () => `/companies/${rated.both.slug}`],
  ];

  for (const [label, url] of targets) {
    for (const scheme of ["light", "dark"] as const) {
      test(`${label} (${scheme}): axe 위반이 없다`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme });
        await page.goto(url());
        await expect(page).toHaveURL(atPath(url())); // 다른 화면(로그인 등)으로 보내지지 않았는지
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 30_000 });
        const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
        expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}곳 — ${v.nodes[0]?.target.join(" ")}`)).toEqual([]);
      });
    }
  }

  test("이 화면들에도 라운드와 그림자가 없다", async ({ page }) => {
    for (const [label, url] of targets) {
      await page.goto(url());
      await expect(page, label).toHaveURL(atPath(url()));
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 30_000 });
      const offenders = await page.evaluate(() =>
        [...document.querySelectorAll("body *")]
          .filter((el) => {
            const style = getComputedStyle(el);
            return style.borderTopLeftRadius !== "0px" || style.boxShadow !== "none";
          })
          .map((el) => el.tagName.toLowerCase()),
      );
      expect(offenders, label).toEqual([]);
    }
  });
});

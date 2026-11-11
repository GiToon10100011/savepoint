import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const calendar = (page: Page, id: "calendar-mono" | "calendar-color") => page.getByTestId(id);
const cell = (page: Page, date: string) => page.locator(`[data-testid="calendar-mono"] [data-date="${date}"]`);

test.describe("StudioBlank 규칙 (실제 화면)", () => {
  for (const url of ["/", "/dev/ui"]) {
    test(`${url}: 모든 요소가 직각이고 그림자가 없다`, async ({ page }) => {
      await page.goto(url);
      const violations = await page.evaluate(() =>
        [...document.querySelectorAll("*")].flatMap((element) => {
          const s = getComputedStyle(element);
          const radii = [s.borderTopLeftRadius, s.borderTopRightRadius, s.borderBottomLeftRadius, s.borderBottomRightRadius];
          const rounded = radii.some((value) => value !== "0px");
          const shadowed = s.boxShadow !== "none";
          return rounded || shadowed ? [`${element.tagName.toLowerCase()}.${String(element.getAttribute("class")).slice(0, 60)}`] : [];
        }),
      );
      expect(violations).toEqual([]);
    });
  }

  test("버튼 크기가 스펙과 같다 (32 / 40 / 48px)", async ({ page }) => {
    await page.goto("/dev/ui");
    const heights = async (name: string) => (await page.getByRole("button", { name, exact: true }).first().boundingBox())?.height;
    expect(await heights("작게")).toBe(32);
    expect(await heights("보통")).toBe(40);
    expect(await heights("크게")).toBe(48);
  });
});

test.describe("평가", () => {
  test("키보드로 0.5 단위 조작과 취소가 된다", async ({ page }) => {
    await page.goto("/dev/ui");
    const slider = page.getByTestId("rating-demo").getByRole("slider", { name: "데모 별점" });

    await expect(slider).toHaveAttribute("aria-valuenow", "0");
    await expect(slider).toHaveAttribute("aria-valuetext", "평가하지 않음");

    await slider.focus();
    for (let i = 0; i < 7; i += 1) await page.keyboard.press("ArrowRight");
    await expect(slider).toHaveAttribute("aria-valuenow", "3.5");
    await expect(slider).toHaveAttribute("aria-valuetext", "3.5점");

    await page.keyboard.press("End");
    await expect(slider).toHaveAttribute("aria-valuenow", "5");
    await page.keyboard.press("Home");
    await expect(slider).toHaveAttribute("aria-valuenow", "0.5");
    await page.keyboard.press("4");
    await expect(slider).toHaveAttribute("aria-valuenow", "4");

    await page.keyboard.press("Delete");
    await expect(slider).toHaveAttribute("aria-valuenow", "0");
    await expect(slider).toHaveAttribute("aria-valuetext", "평가하지 않음");
  });

  test("별의 왼쪽 절반은 x.5, 오른쪽 절반은 정수이고, 같은 별을 다시 누르면 취소된다", async ({ page }) => {
    await page.goto("/dev/ui");
    const slider = page.getByTestId("rating-demo").getByRole("slider", { name: "데모 별점" });

    // 별 5개가 정확히 44px씩(터치 영역) 차지해야 아래 클릭 좌표가 맞다.
    expect((await slider.boundingBox())?.width).toBe(220);

    await slider.click({ position: { x: 3 * 44 + 11, y: 22 } }); // 4번째 별 왼쪽 절반
    await expect(slider).toHaveAttribute("aria-valuenow", "3.5");

    await slider.click({ position: { x: 3 * 44 + 33, y: 22 } }); // 4번째 별 오른쪽 절반
    await expect(slider).toHaveAttribute("aria-valuenow", "4");

    await slider.click({ position: { x: 3 * 44 + 33, y: 22 } }); // 같은 값 → 취소
    await expect(slider).toHaveAttribute("aria-valuenow", "0");
  });

  test("명시적 '평가 취소' 버튼은 평가가 있을 때만 보이고 누르면 평가가 사라진다", async ({ page }) => {
    await page.goto("/dev/ui");
    const demo = page.getByTestId("rating-demo");
    const slider = demo.getByRole("slider", { name: "데모 별점" });
    const cancel = demo.getByRole("button", { name: "평가 취소" });

    await expect(cancel).toHaveCount(0);
    await slider.click({ position: { x: 2 * 44 + 33, y: 22 } });
    await expect(slider).toHaveAttribute("aria-valuenow", "3");
    await cancel.click();
    await expect(slider).toHaveAttribute("aria-valuenow", "0");
    await expect(cancel).toHaveCount(0);
  });

  test("읽기 전용은 조작할 수 없고 값만 읽어 준다", async ({ page }) => {
    await page.goto("/dev/ui");
    const readonly = page.getByRole("img", { name: "읽기 전용 별점 3.5점" });
    await expect(readonly).toBeVisible();
    await expect(page.getByRole("slider", { name: "읽기 전용 별점" })).toHaveCount(0);
  });
});

test.describe("달력", () => {
  test("포커스가 키보드 이동 밖의 경로로 들어와도 방향키가 그 칸을 기준으로 움직인다", async ({ page }) => {
    // 회귀: 프로그램·음성 제어·보조 기술이 포커스를 옮기면 내부 기준 위치가 어긋나 엉뚱한 칸으로 가던 버그.
    await page.goto("/dev/ui");
    await cell(page, "2026-11-20").focus();
    await page.keyboard.press("ArrowRight");
    await expect(cell(page, "2026-11-21")).toBeFocused();
  });

  test("키보드로 날짜를 이동한다 (방향키·Home/End)", async ({ page }) => {
    await page.goto("/dev/ui");
    await cell(page, "2026-11-10").focus();
    await page.keyboard.press("ArrowRight");
    await expect(cell(page, "2026-11-11")).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(cell(page, "2026-11-18")).toBeFocused(); // 수요일
    await page.keyboard.press("Home");
    await expect(cell(page, "2026-11-15")).toBeFocused(); // 그 주 일요일
    await page.keyboard.press("End");
    await expect(cell(page, "2026-11-21")).toBeFocused(); // 그 주 토요일
    await page.keyboard.press("ArrowUp");
    await expect(cell(page, "2026-11-14")).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(cell(page, "2026-11-13")).toBeFocused();
  });

  test("한 번에 한 칸만 탭 순서에 들어간다(roving tabindex)", async ({ page }) => {
    await page.goto("/dev/ui");
    const focusable = calendar(page, "calendar-mono").locator('[data-date][tabindex="0"]');
    await expect(focusable).toHaveCount(1);
  });

  test("달의 경계를 넘어 이동하면 월이 바뀌고 포커스가 따라간다", async ({ page }) => {
    await page.goto("/dev/ui");
    const mono = calendar(page, "calendar-mono");

    await cell(page, "2026-11-01").focus();
    await page.keyboard.press("ArrowLeft");
    await expect(mono.getByRole("heading", { name: "2026년 10월" })).toBeVisible();
    await expect(page.locator('[data-testid="calendar-mono"] [data-date="2026-10-31"]')).toBeFocused();

    await page.keyboard.press("PageDown");
    await expect(mono.getByRole("heading", { name: "2026년 11월" })).toBeVisible();
    await expect(cell(page, "2026-11-30")).toBeFocused(); // 31일 → 11월은 30일까지라 맞춰진다
  });

  test("각 날짜의 접근 가능한 이름에 날짜와 이벤트가 들어 있고, 선택하면 그날의 기록이 보인다", async ({ page }) => {
    await page.goto("/dev/ui");
    const day = cell(page, "2026-11-08");
    // 이름은 보이는 날짜 숫자로 시작하고(WCAG 2.5.3), 이벤트는 정의된 순서(엔딩 → 리뷰 → 평가)로 나온다.
    await expect(day).toHaveAccessibleName("8 일, 2026년 11월, 엔딩 달성 1건, 리뷰 작성 1건, 게임 평가 1건");
    await expect(cell(page, "2026-11-02")).toHaveAccessibleName("2 일, 2026년 11월, 기록 없음");
    await expect(cell(page, "2026-11-10")).toHaveAttribute("aria-current", "date");

    await day.press("Enter");
    await expect(calendar(page, "calendar-mono").getByText("11월 8일 · 3종")).toBeVisible();
  });

  test("모노크롬 안과 색 안이 같은 글리프를 쓰고, 이벤트 색 토큰만 다르다", async ({ page }) => {
    await page.goto("/dev/ui");
    const color = (id: "calendar-mono" | "calendar-color") =>
      calendar(page, id).locator("svg").first().evaluate((el) => getComputedStyle(el).color);
    // 같은 날짜 칸의 첫 글리프를 비교한다.
    const mono = await page.locator('[data-testid="calendar-mono"] [data-date="2026-11-01"] svg').evaluate((el) => getComputedStyle(el).color);
    const colored = await page.locator('[data-testid="calendar-color"] [data-date="2026-11-01"] svg').evaluate((el) => getComputedStyle(el).color);
    expect(mono).not.toBe(colored);
    expect(await color("calendar-mono")).toBeTruthy();
    expect(await calendar(page, "calendar-mono").locator("svg").count()).toBe(await calendar(page, "calendar-color").locator("svg").count());
  });
});

test.describe("내비게이션", () => {
  test("뷰포트에 맞는 내비 하나만 보이고 현재 페이지가 표시된다", async ({ page }) => {
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "주 메뉴" });
    await expect(nav).toBeVisible(); // 숨겨진 쪽은 접근성 트리에서 빠지므로 정확히 하나만 잡힌다.
    for (const name of ["홈", "검색", "라이브러리", "달력", "로그인"]) {
      await expect(nav.getByRole("link", { name })).toBeVisible();
    }
    await expect(nav.getByRole("link", { name: "홈" })).toHaveAttribute("aria-current", "page");
    await expect(nav.getByRole("link", { name: "검색" })).not.toHaveAttribute("aria-current", "page");
  });

  test("터치 영역이 44px 이상이다", async ({ page }) => {
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "주 메뉴" });
    for (const name of ["홈", "검색", "라이브러리", "달력", "로그인"]) {
      const box = await nav.getByRole("link", { name }).boundingBox();
      expect(box?.height, name).toBeGreaterThanOrEqual(44);
    }
  });
});

test.describe("접근성 (axe, WCAG 2 A·AA)", () => {
  for (const url of ["/", "/dev/ui"]) {
    for (const scheme of ["light", "dark"] as const) {
      test(`${url} (${scheme}): 위반이 없다`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme });
        await page.goto(url);
        const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
        expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}곳 — ${v.nodes[0]?.target.join(" ")}`)).toEqual([]);
      });
    }
  }
});

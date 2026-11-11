import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const calendar = (page: Page, id: "calendar-demo") => page.getByTestId(id);
const cell = (page: Page, date: string) => page.locator(`[data-testid="calendar-demo"] [data-date="${date}"]`);

/**
 * `/dev/ui`를 열고 클라이언트 컴포넌트가 **하이드레이션될 때까지** 기다린다.
 * `goto`는 `load`에서 돌아오지만 그때는 이벤트 핸들러가 아직 붙지 않아, 바로 누른 키가 조용히 사라진다
 * (관찰: load 직후 하이드레이션 전 4회 중 3회 입력 유실). `networkidle`은 백그라운드 요청이 있으면 끝나지
 * 않아 취약하므로, React가 요소에 붙이는 내부 속성을 직접 기다린다.
 */
async function openDevUi(page: Page) {
  await page.goto("/dev/ui");
  await page.waitForFunction(() => {
    const demos = [...document.querySelectorAll("[data-testid]")];
    return demos.length > 0 && demos.every((el) => Object.keys(el.firstElementChild ?? el).some((key) => key.startsWith("__reactProps")));
  });
}

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
    await openDevUi(page);
    const heights = async (name: string) => (await page.getByRole("button", { name, exact: true }).first().boundingBox())?.height;
    expect(await heights("작게")).toBe(32);
    expect(await heights("보통")).toBe(40);
    expect(await heights("크게")).toBe(48);
  });
});

test.describe("평가", () => {
  test("키보드로 0.5 단위 조작과 취소가 된다", async ({ page }) => {
    await openDevUi(page);
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
    await openDevUi(page);
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
    await openDevUi(page);
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

  test("Alt·Ctrl·Meta 조합은 가로채지 않는다(브라우저 단축키 보존), 수정 키가 없으면 처리한다", async ({ page }) => {
    await openDevUi(page);
    const slider = page.getByTestId("rating-demo").getByRole("slider", { name: "데모 별점" });
    const pressed = (init: { altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }) =>
      slider.evaluate((node, modifiers) => {
        const event = new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true, ...modifiers });
        node.dispatchEvent(event);
        return event.defaultPrevented;
      }, init);

    expect(await pressed({ altKey: true })).toBe(false);
    expect(await pressed({ ctrlKey: true })).toBe(false);
    expect(await pressed({ metaKey: true })).toBe(false);
    await expect(slider).toHaveAttribute("aria-valuenow", "0"); // 값도 바뀌지 않았다

    expect(await pressed({})).toBe(true); // 수정 키가 없으면 여전히 처리하고 기본 동작을 막는다
    await expect(slider).toHaveAttribute("aria-valuenow", "0.5");
  });

  test("읽기 전용은 조작할 수 없고 값만 읽어 준다", async ({ page }) => {
    await openDevUi(page);
    const readonly = page.getByRole("img", { name: "읽기 전용 별점 3.5점" });
    await expect(readonly).toBeVisible();
    await expect(page.getByRole("slider", { name: "읽기 전용 별점" })).toHaveCount(0);
  });
});

test.describe("달력", () => {
  test("포커스가 키보드 이동 밖의 경로로 들어와도 방향키가 그 칸을 기준으로 움직인다", async ({ page }) => {
    // 회귀: 프로그램·음성 제어·보조 기술이 포커스를 옮기면 내부 기준 위치가 어긋나 엉뚱한 칸으로 가던 버그.
    await openDevUi(page);
    await cell(page, "2026-11-20").focus();
    await page.keyboard.press("ArrowRight");
    await expect(cell(page, "2026-11-21")).toBeFocused();
  });

  test("키보드로 날짜를 이동한다 (방향키·Home/End)", async ({ page }) => {
    await openDevUi(page);
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

  test("Alt·Ctrl·Meta 조합은 가로채지 않는다(Alt+←는 브라우저 뒤로 가기), 수정 키가 없으면 처리한다", async ({ page }) => {
    await openDevUi(page);
    const day = cell(page, "2026-11-10");
    await day.focus();
    const pressed = (init: { altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }) =>
      day.evaluate((node, modifiers) => {
        const event = new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true, ...modifiers });
        node.dispatchEvent(event);
        return event.defaultPrevented;
      }, init);

    expect(await pressed({ altKey: true })).toBe(false);
    expect(await pressed({ ctrlKey: true })).toBe(false);
    expect(await pressed({ metaKey: true })).toBe(false);
    await expect(day).toBeFocused(); // 포커스도 움직이지 않았다

    expect(await pressed({})).toBe(true); // 수정 키가 없으면 여전히 처리한다
    await expect(cell(page, "2026-11-09")).toBeFocused();
  });

  test("한 번에 한 칸만 탭 순서에 들어간다(roving tabindex)", async ({ page }) => {
    await openDevUi(page);
    const focusable = calendar(page, "calendar-demo").locator('[data-date][tabindex="0"]');
    await expect(focusable).toHaveCount(1);
  });

  test("달의 경계를 넘어 이동하면 월이 바뀌고 포커스가 따라간다", async ({ page }) => {
    await openDevUi(page);
    const mono = calendar(page, "calendar-demo");

    await cell(page, "2026-11-01").focus();
    await page.keyboard.press("ArrowLeft");
    await expect(mono.getByRole("heading", { name: "2026년 10월" })).toBeVisible();
    await expect(page.locator('[data-testid="calendar-demo"] [data-date="2026-10-31"]')).toBeFocused();

    await page.keyboard.press("PageDown");
    await expect(mono.getByRole("heading", { name: "2026년 11월" })).toBeVisible();
    await expect(cell(page, "2026-11-30")).toBeFocused(); // 31일 → 11월은 30일까지라 맞춰진다
  });

  test("각 날짜의 접근 가능한 이름에 날짜와 이벤트가 들어 있고, 선택하면 그날의 기록이 보인다", async ({ page }) => {
    await openDevUi(page);
    const day = cell(page, "2026-11-08");
    // 이름은 보이는 날짜 숫자로 시작하고(WCAG 2.5.3), 이벤트는 정의된 순서(엔딩 → 리뷰 → 평가)로 나온다.
    await expect(day).toHaveAccessibleName("8 일, 2026년 11월, 엔딩 달성 1건, 리뷰 작성 1건, 게임 평가 1건");
    await expect(cell(page, "2026-11-02")).toHaveAccessibleName("2 일, 2026년 11월, 기록 없음");
    await expect(cell(page, "2026-11-10")).toHaveAttribute("aria-current", "date");

    await day.press("Enter");
    await expect(calendar(page, "calendar-demo").getByText("11월 8일 · 3종")).toBeVisible();
  });

  test("이벤트 글리프는 이벤트 색 토큰으로 칠해지고 인터페이스 글자색과 다르다", async ({ page }) => {
    await openDevUi(page);
    const color = (selector: string) => page.locator(selector).first().evaluate((el) => getComputedStyle(el).color);
    const glyph = await color('[data-testid="calendar-demo"] [data-date="2026-11-01"] svg'); // 플레이 시작
    const text = await color('[data-testid="calendar-demo"] [data-date="2026-11-01"] span');
    expect(glyph).toBe("rgb(47, 107, 69)"); // --event-play-start #2f6b45 (라이트)
    expect(glyph).not.toBe(text);
  });

  test("색과 무관하게 이벤트 6종의 모양이 모두 다르다(색만으로 구분하지 않는다)", async ({ page }) => {
    await openDevUi(page);
    const shapes = await page.getByRole("list", { name: "이벤트 종류" }).locator("svg").evaluateAll((svgs) =>
      svgs.map((svg) => svg.innerHTML),
    );
    expect(shapes).toHaveLength(6);
    expect(new Set(shapes).size).toBe(6);
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

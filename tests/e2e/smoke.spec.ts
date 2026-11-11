import { expect, test } from "@playwright/test";

test("홈이 열리고 서비스 이름이 보인다", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "SavePoint" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "ko");
});

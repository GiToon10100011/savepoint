import { describe, expect, it } from "vitest";
import { buildNavItems, isNavActive } from "@/components/navigation/nav-items";

describe("buildNavItems", () => {
  it("홈·검색·라이브러리·달력·프로필 5개가 순서대로 나온다", () => {
    const items = buildNavItems({ href: "/u/tester", label: "프로필" });
    expect(items.map((i) => i.key)).toEqual(["home", "search", "library", "calendar", "profile"]);
    expect(items.map((i) => i.label)).toEqual(["홈", "검색", "라이브러리", "달력", "프로필"]);
  });

  it("비로그인이면 프로필 칸이 로그인으로 바뀐다", () => {
    const profile = buildNavItems({ href: "/auth/sign-in", label: "로그인" })[4];
    expect(profile).toEqual({ key: "profile", label: "로그인", href: "/auth/sign-in" });
  });
});

describe("isNavActive", () => {
  it("홈은 정확히 /일 때만 활성이다", () => {
    expect(isNavActive("/", "/")).toBe(true);
    expect(isNavActive("/search", "/")).toBe(false);
  });

  it("하위 경로에서도 활성이다", () => {
    expect(isNavActive("/library", "/library")).toBe(true);
    expect(isNavActive("/library/recent", "/library")).toBe(true);
    expect(isNavActive("/calendar/2026/11/8", "/calendar")).toBe(true);
  });

  it("이름만 비슷한 경로는 활성이 아니다", () => {
    expect(isNavActive("/librarian", "/library")).toBe(false);
    expect(isNavActive("/searching", "/search")).toBe(false);
  });
});

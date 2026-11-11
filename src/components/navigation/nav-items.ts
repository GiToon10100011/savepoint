export type NavKey = "home" | "search" | "library" | "calendar" | "profile";

export type NavItem = { key: NavKey; label: string; href: string };

/**
 * 하단·좌측 내비 항목. 프로필 칸은 로그인 상태에 따라 다르다
 * (로그인: 내 프로필 `/u/{handle}`, 비로그인: `로그인`).
 */
export function buildNavItems(profile: { href: string; label: string }): NavItem[] {
  return [
    { key: "home", label: "홈", href: "/" },
    { key: "search", label: "검색", href: "/search" },
    { key: "library", label: "라이브러리", href: "/library" },
    { key: "calendar", label: "달력", href: "/calendar" },
    { key: "profile", label: profile.label, href: profile.href },
  ];
}

/** 홈은 정확히 `/`일 때만, 나머지는 해당 경로이거나 그 하위 경로일 때 활성이다. */
export function isNavActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

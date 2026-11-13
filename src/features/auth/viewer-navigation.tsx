import { DesktopNavigation } from "@/components/navigation/desktop-navigation";
import { MobileNavigation } from "@/components/navigation/mobile-navigation";
import { buildNavItems } from "@/components/navigation/nav-items";
import { getSessionUser } from "@/server/viewer";

/**
 * 로그인 여부에 따라 프로필 칸이 달라지는 내비(로그인: 내 계정, 비로그인: 로그인).
 * 세션을 읽는 요청 시점 컴포넌트라 반드시 <Suspense> 안에서 쓴다. DB는 조회하지 않는다.
 * 프로필 화면(`/u/{handle}`)이 생기면 로그인 상태의 링크를 그쪽으로 바꾼다.
 */
export async function ViewerNavigation({ kind }: { kind: "desktop" | "mobile" }) {
  const user = await getSessionUser();
  const items = buildNavItems(user ? { href: "/account", label: "내 계정" } : { href: "/auth/sign-in", label: "로그인" });
  return kind === "desktop" ? <DesktopNavigation items={items} /> : <MobileNavigation items={items} />;
}

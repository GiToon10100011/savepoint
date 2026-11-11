"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { NavIcon } from "../icons";
import { isNavActive, type NavItem } from "../nav-items";

/**
 * 모바일 하단 내비(5탭). 활성 탭은 색이 아니라 채운 아이콘 + 굵은 레이블 + 위쪽 2px 선으로 구분하고
 * `aria-current="page"`를 단다. `lg` 이상에서는 숨기고 좌측 내비가 대신한다.
 */
export function MobileNavigation({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="주 메뉴"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-paper pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      <ul className="grid grid-cols-5">
        {items.map((item) => {
          const active = isNavActive(pathname, item.href);
          return (
            <li key={item.key}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex min-h-14 flex-col items-center justify-center gap-1 text-xs",
                  active ? "font-semibold text-ink" : "font-normal text-muted",
                )}
              >
                {active ? <span aria-hidden="true" className="absolute inset-x-0 top-0 h-0.5 bg-ink" /> : null}
                <NavIcon name={item.key} filled={active} />
                <span>{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

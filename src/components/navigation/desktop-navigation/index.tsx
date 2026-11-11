"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { NavIcon } from "../icons";
import { isNavActive, type NavItem } from "../nav-items";

/** 데스크톱(`lg` 이상) 좌측 내비. 모바일 하단 내비와 같은 5개 항목이며 활성 표시도 같은 원칙(채움·굵기·선)이다. */
export function DesktopNavigation({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="주 메뉴"
      className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-line bg-paper px-4 py-6 lg:flex"
    >
      <Link href="/" className="type-h3 mb-8 block px-3">
        SavePoint
      </Link>
      <ul className="flex flex-col gap-1">
        {items.map((item) => {
          const active = isNavActive(pathname, item.href);
          return (
            <li key={item.key}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-11 items-center gap-3 border-l-2 px-3 text-sm",
                  active ? "border-ink font-semibold text-ink" : "border-transparent font-normal text-muted hover:text-ink",
                )}
              >
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

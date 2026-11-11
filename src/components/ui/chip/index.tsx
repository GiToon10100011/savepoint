import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export type ChipProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  selected?: boolean;
};

/**
 * 필터 칩. 선택은 검정 배경 + 밝은 글자(색이 아니라 반전)이고 `aria-pressed`로도 전달한다.
 * 눈에 보이는 높이는 32px이며 터치 영역은 보이지 않는 영역으로 44px까지 넓힌다.
 */
export function Chip({ selected = false, className, type = "button", ...props }: ChipProps) {
  return (
    <button
      type={type}
      aria-pressed={selected}
      className={cn(
        "relative inline-flex h-8 items-center border px-3 text-sm font-normal whitespace-nowrap cursor-pointer",
        "transition-colors duration-150 before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-['']",
        selected
          ? "border-ink bg-ink text-on-inverse"
          : "border-line-input bg-transparent text-muted hover:border-ink hover:text-ink",
        className,
      )}
      {...props}
    />
  );
}

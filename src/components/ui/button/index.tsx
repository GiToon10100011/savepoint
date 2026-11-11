import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive";
export type ButtonSize = "sm" | "md" | "lg";

// 눈에 보이는 높이가 44px보다 작아도 터치 영역은 44px 이상이 되도록 보이지 않는 영역(before)을 넓힌다.
const BASE =
  "relative inline-flex items-center justify-center gap-2 border border-transparent font-normal whitespace-nowrap " +
  "select-none cursor-pointer transition-colors duration-150 before:absolute before:inset-x-0 before:content-[''] " +
  "disabled:cursor-not-allowed disabled:border-line disabled:bg-disabled disabled:text-muted";

// hover는 배경과 글자색을 반전한다(비활성 버튼은 제외).
const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-ink text-on-inverse enabled:hover:border-ink enabled:hover:bg-paper enabled:hover:text-ink",
  secondary: "border-ink bg-transparent text-ink enabled:hover:bg-ink enabled:hover:text-on-inverse",
  ghost: "bg-transparent text-ink enabled:hover:bg-ink enabled:hover:text-on-inverse",
  destructive: "bg-error text-on-inverse enabled:hover:border-error enabled:hover:bg-transparent enabled:hover:text-error",
};

// 스펙: Small 32px/16px/12px, Medium 40px/24px/14px, Large 48px/32px/16px (높이/좌우 패딩/글자 크기)
const SIZES: Record<ButtonSize, string> = {
  sm: "h-8 px-4 text-xs before:-inset-y-1.5",
  md: "h-10 px-6 text-sm before:-inset-y-0.5",
  lg: "h-12 px-8 text-base",
};

export function buttonClasses({
  variant = "primary",
  size = "md",
  className,
}: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {}): string {
  return cn(BASE, VARIANTS[variant], SIZES[size], className);
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

export function Button({ variant, size, className, type = "button", ...props }: ButtonProps) {
  return <button type={type} className={buttonClasses({ variant, size, className })} {...props} />;
}

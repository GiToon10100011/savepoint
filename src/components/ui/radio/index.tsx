import type { InputHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

export type RadioProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  label: ReactNode;
};

// 18px 정사각형(모서리 0 규칙에 따라 원이 아니다). 선택되면 흰 바탕 + 검정 테두리 + 검정 점.
const BOX =
  "relative h-[18px] w-[18px] shrink-0 cursor-pointer appearance-none border border-line-input bg-card " +
  "checked:border-ink disabled:cursor-not-allowed disabled:bg-disabled " +
  "checked:after:absolute checked:after:inset-[3px] checked:after:bg-ink checked:after:content-['']";

export function Radio({ label, className, ...props }: RadioProps) {
  return (
    <label className={cn("inline-flex min-h-11 cursor-pointer items-center gap-3 text-sm font-normal", className)}>
      <input type="radio" className={BOX} {...props} />
      <span>{label}</span>
    </label>
  );
}

import type { InputHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

export type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  label: ReactNode;
};

// 18px 정사각형. 체크는 직각 선분(회전한 두 변)으로 그린다. 선택되면 검정 채움.
const BOX =
  "relative h-[18px] w-[18px] shrink-0 cursor-pointer appearance-none border border-line-input bg-card " +
  "checked:border-ink checked:bg-ink disabled:cursor-not-allowed disabled:bg-disabled " +
  "checked:after:absolute checked:after:left-[5px] checked:after:top-[1px] checked:after:h-[10px] checked:after:w-[5px] " +
  "checked:after:rotate-45 checked:after:border-b-2 checked:after:border-r-2 checked:after:border-on-inverse checked:after:content-['']";

export function Checkbox({ label, className, ...props }: CheckboxProps) {
  return (
    <label className={cn("inline-flex min-h-11 cursor-pointer items-center gap-3 text-sm font-normal", className)}>
      <input type="checkbox" className={BOX} {...props} />
      <span>{label}</span>
    </label>
  );
}

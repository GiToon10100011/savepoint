import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  /** 오류 상태. `data-error`와 `aria-invalid`를 함께 켠다. */
  invalid?: boolean;
};

export function Input({ invalid, className, ...props }: InputProps) {
  return (
    <input
      aria-invalid={invalid || undefined}
      data-error={invalid ? "true" : undefined}
      className={cn(
        "h-10 w-full border border-line-input bg-card px-3 text-sm font-normal text-fg placeholder:text-muted",
        "focus:border-ink data-[error=true]:border-error",
        "disabled:cursor-not-allowed disabled:bg-disabled disabled:text-muted",
        className,
      )}
      {...props}
    />
  );
}

export type TextFieldProps = Omit<InputProps, "id" | "invalid"> & {
  id: string;
  label: string;
  hint?: string;
  error?: string;
};

/** 레이블·도움말·오류 문구가 입력과 연결된(`for`, `aria-describedby`) 입력 필드. */
export function TextField({ id, label, hint, error, ...input }: TextFieldProps) {
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ");
  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-sm font-semibold">
        {label}
      </label>
      <Input id={id} invalid={Boolean(error)} aria-describedby={describedBy || undefined} {...input} />
      {hint ? (
        <p id={`${id}-hint`} className="mt-2 text-xs text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} aria-live="polite" className="mt-2 text-xs text-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

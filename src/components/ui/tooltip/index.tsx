"use client";

import { cloneElement, useId, useState, type ReactElement } from "react";

type TooltipTarget = ReactElement<{ "aria-describedby"?: string }>;

/**
 * 호버·키보드 포커스로 열리고, Escape·포커스 이탈·마우스 이탈로 닫힌다(WCAG 1.4.13).
 * 설명은 `aria-describedby`로 대상에 연결되며, 숨겨져 있어도 보조 기술은 읽는다.
 */
export function Tooltip({ label, children }: { label: string; children: TooltipTarget }) {
  const id = useId();
  const [open, setOpen] = useState(false);

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocusCapture={() => setOpen(true)}
      onBlurCapture={() => setOpen(false)}
      onKeyDown={(event) => {
        if (event.key === "Escape") setOpen(false);
      }}
    >
      {cloneElement(children, { "aria-describedby": id })}
      <span
        id={id}
        role="tooltip"
        hidden={!open}
        className="absolute left-1/2 top-full z-20 mt-2 -translate-x-1/2 border border-ink bg-ink px-2 py-1 text-xs whitespace-nowrap text-on-inverse"
      >
        {label}
      </span>
    </span>
  );
}

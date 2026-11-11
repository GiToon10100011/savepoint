"use client";

import type { KeyboardEvent, MouseEvent } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import {
  formatStars,
  nextStars,
  starFill,
  starsFromPointer,
  starsLabel,
  STAR_COUNT,
  type Stars,
} from "@/lib/rating";

const STAR_PATH = "M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77 5.82 21.02 7 14.14 2 9.27l6.91-1.01L12 2z";

/** 별 하나(44×44, 터치 영역). 모노크롬: 비어 있으면 외곽선, 차면 검정 채움, 반은 왼쪽 절반만 채운다. */
function Star({ fill }: { fill: 0 | 0.5 | 1 }) {
  return (
    <span className="relative block h-11 w-11" aria-hidden="true">
      <svg
        viewBox="0 0 24 24"
        className="absolute inset-0 h-11 w-11 text-muted"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinejoin="miter"
      >
        <path d={STAR_PATH} />
      </svg>
      {fill > 0 ? (
        <span className="absolute inset-y-0 left-0 overflow-hidden" style={{ width: `${fill * 100}%` }}>
          <svg
            viewBox="0 0 24 24"
            className="h-11 w-11 text-ink"
            fill="currentColor"
            stroke="currentColor"
            strokeWidth="1.25"
            strokeLinejoin="miter"
          >
            <path d={STAR_PATH} />
          </svg>
        </span>
      ) : null}
    </span>
  );
}

type GameRatingProps = {
  /** 별점(0.5 단위). 평가하지 않았으면 null. */
  value: Stars | null;
  onChange?: (value: Stars | null) => void;
  readOnly?: boolean;
  label?: string;
  /** 평가가 있을 때 `평가 취소` 버튼을 보여 준다. */
  showCancel?: boolean;
};

/**
 * 게임 평가. 별 5개, 0.5 단위, 선택 즉시 저장하는 흐름을 가정한다.
 * - 마우스·터치: 별의 왼쪽 절반 = x.5, 오른쪽 절반 = 정수. 같은 값을 다시 누르면 취소(보조 동작).
 * - 키보드(role="slider"): ←→↑↓ ±0.5, PageUp/Down ±1, Home/End, 숫자 1–5, Delete/Backspace 취소.
 * - 명시적 `평가 취소` 버튼을 항상 함께 둔다.
 */
export function GameRating({ value, onChange, readOnly = false, label = "별점", showCancel = true }: GameRatingProps) {
  const interactive = !readOnly && Boolean(onChange);

  function handlePointer(event: MouseEvent<HTMLDivElement>) {
    if (!interactive) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const cell = rect.width / STAR_COUNT;
    const index = Math.min(STAR_COUNT - 1, Math.max(0, Math.floor(x / cell)));
    const isLeftHalf = x - index * cell < cell / 2;
    const next = starsFromPointer(index, isLeftHalf);
    onChange?.(next === value ? null : next);
  }

  function handleKey(event: KeyboardEvent<HTMLDivElement>) {
    if (!interactive) return;
    const next = nextStars(value, event.key);
    if (next === undefined) return;
    event.preventDefault();
    if (next !== value) onChange?.(next);
  }

  const stars = Array.from({ length: STAR_COUNT }, (_, index) => <Star key={index} fill={starFill(index, value)} />);

  return (
    <div className="flex flex-wrap items-center gap-x-3">
      {interactive ? (
        <div
          role="slider"
          tabIndex={0}
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={5}
          aria-valuenow={value ?? 0}
          aria-valuetext={starsLabel(value)}
          onClick={handlePointer}
          onKeyDown={handleKey}
          className="flex cursor-pointer"
        >
          {stars}
        </div>
      ) : (
        <div role="img" aria-label={`${label} ${starsLabel(value)}`} className="flex">
          {stars}
        </div>
      )}
      <span aria-hidden="true" className={cn("type-mono min-w-8", value === null && "text-muted")}>
        {formatStars(value)}
      </span>
      {interactive && showCancel && value !== null ? (
        <Button variant="ghost" size="sm" onClick={() => onChange?.(null)}>
          평가 취소
        </Button>
      ) : null}
    </div>
  );
}

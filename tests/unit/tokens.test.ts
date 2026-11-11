import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(path.resolve(import.meta.dirname, "../../src/styles/tokens.css"), "utf8");

/** 첫 번째 `:root { ... }` 블록(라이트 기본값)만 잘라낸다. */
const lightRoot = css.match(/:root\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";

function token(name: string): string | undefined {
  return lightRoot.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1].trim();
}

// 요구된 스펙의 토큰 값 그대로다.
const SPEC: Record<string, string> = {
  "color-primary": "#0a0a0a",
  "color-secondary": "#fafafa",
  "color-tertiary": "#d4d4d8",
  "surface-base": "#fafafa",
  "surface-inverse": "#0a0a0a",
  "color-success": "#16a34a",
  "color-warning": "#ca8a04",
  "color-error": "#dc2626",
  "color-info": "#71717a",
  "color-border": "#e5e5e5",
  "color-border-subtle": "#f4f4f5",
  "color-border-hover": "#a1a1aa",
  "color-text-primary": "#0a0a0a",
  "color-text-secondary": "#71717a",
  "color-surface-white": "#ffffff",
  "color-surface-disabled": "#f4f4f5",
  "text-hero": "64px",
  "text-h1": "40px",
  "text-h2": "28px",
  "text-h3": "20px",
  "text-body": "16px",
  "text-body-sm": "14px",
  "text-caption": "12px",
  "text-mono": "13px",
  "space-1": "4px",
  "space-2": "8px",
  "space-3": "16px",
  "space-4": "32px",
  "space-5": "48px",
  "space-6": "64px",
  "space-8": "96px",
  "space-10": "128px",
  "breakpoint-sm": "640px",
  "breakpoint-md": "768px",
  "breakpoint-lg": "1024px",
  "breakpoint-xl": "1280px",
};

describe("디자인 토큰", () => {
  it.each(Object.entries(SPEC))("--%s = %s", (name, value) => {
    expect(token(name)).toBe(value);
  });

  it("모서리는 항상 0이다", () => {
    expect(token("radius")).toBe("0");
  });

  it("달력 이벤트 기본값은 모노크롬이다(색 토큰이 아니라 텍스트 색을 가리킨다)", () => {
    for (const name of ["play-start", "ending", "complete", "review", "rating"]) {
      expect(token(`event-${name}`)).toBe("var(--color-text-primary)");
    }
  });

  it("색 안은 data-event-colors로 켤 때만 적용된다", () => {
    expect(css).toMatch(/\[data-event-colors="on"\]\s*\{/);
    // 기본 :root 블록에는 색 값(#hex)이 이벤트 토큰에 없어야 한다.
    expect(lightRoot).not.toMatch(/--event-[a-z-]+:\s*#/);
  });

  it("다크 모드에서도 같은 토큰 이름을 재정의한다", () => {
    const dark = css.match(/@media \(prefers-color-scheme: dark\)\s*\{\s*:root\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? "";
    for (const name of ["color-primary", "surface-base", "color-text-primary", "color-border"]) {
      expect(dark).toMatch(new RegExp(`--${name}:`));
    }
  });
});

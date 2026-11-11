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

  describe("달력 이벤트 색", () => {
    const darkBlock = css.match(/@media \(prefers-color-scheme: dark\)\s*\{\s*:root\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? "";
    const darkToken = (name: string) => darkBlock.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1].trim();
    const EVENTS = ["play-start", "ending", "complete", "review", "rating", "session"];

    /** WCAG 상대 휘도와 대비비. */
    const luminance = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
      const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
      return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    };
    const contrast = (a: string, b: string) => {
      const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };

    it("라이트·다크 모두 #rrggbb 색으로 정의돼 있다(모노크롬 참조가 아니다)", () => {
      for (const name of EVENTS) {
        expect(token(`event-${name}`), `light ${name}`).toMatch(/^#[0-9a-f]{6}$/);
        expect(darkToken(`event-${name}`), `dark ${name}`).toMatch(/^#[0-9a-f]{6}$/);
      }
    });

    it("카드 배경 위에서 비텍스트 대비 3:1 이상이다(WCAG 1.4.11) — 색을 바꿔도 이 선을 지킨다", () => {
      const lightBg = token("color-surface-white") as string;
      const darkBg = darkToken("color-surface-white") as string;
      for (const name of EVENTS) {
        expect(contrast(token(`event-${name}`) as string, lightBg), `light ${name}`).toBeGreaterThanOrEqual(3);
        expect(contrast(darkToken(`event-${name}`) as string, darkBg), `dark ${name}`).toBeGreaterThanOrEqual(3);
      }
    });

    it("검출기 자체 검증: 대비가 낮은 색은 실제로 걸러진다", () => {
      expect(contrast("#ffffff", "#ffffff")).toBe(1);
      expect(contrast("#d4d4d8", "#ffffff")).toBeLessThan(3); // 연한 회색은 통과하면 안 된다
      expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 0);
    });

    it("종류마다 다른 색이다(색만으로도 구분 가능하되, 같은 색이 둘 이상이면 안 된다)", () => {
      // 평가·기록은 의도적으로 중성 회색 계열이라 둘 다 회색이어도 되지만, 서로는 달라야 한다.
      const light = EVENTS.map((name) => token(`event-${name}`));
      expect(new Set(light).size).toBe(EVENTS.length);
    });

    it("이전의 모노크롬 비교용 스위치(data-event-colors)는 더 이상 없다", () => {
      expect(css).not.toContain("data-event-colors");
    });
  });

  it("다크 모드에서도 같은 토큰 이름을 재정의한다", () => {
    const dark = css.match(/@media \(prefers-color-scheme: dark\)\s*\{\s*:root\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? "";
    for (const name of ["color-primary", "surface-base", "color-text-primary", "color-border"]) {
      expect(dark).toMatch(new RegExp(`--${name}:`));
    }
  });
});

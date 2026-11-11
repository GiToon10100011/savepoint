import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * StudioBlank 규칙을 소스에서 강제한다. 위반이 들어오면 CI가 실패한다.
 * (실제 화면의 radius·그림자는 E2E가 계산된 스타일로 한 번 더 확인한다.)
 */
const SRC = path.resolve(import.meta.dirname, "../../src");
const TOKENS = path.join(SRC, "styles", "tokens.css");
const GLOBALS = path.join(SRC, "app", "globals.css");

function sourceFiles(extensions: string[]): string[] {
  return (readdirSync(SRC, { recursive: true }) as string[])
    .filter((file) => extensions.some((ext) => file.endsWith(ext)))
    .map((file) => path.join(SRC, file));
}

/** 주석은 규칙 설명에 위반 단어가 나올 수 있으므로 검사 전에 지운다. */
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const RAW_HEX = /#[0-9a-fA-F]{3,8}\b/;
const FORBIDDEN_CLASS = /(?<![\w-])(rounded(?:-[\w[\]/.]+)?|shadow(?:-[\w[\]/.]+)?|drop-shadow(?:-[\w[\]/.]+)?|blur(?:-[\w[\]/.]+)?|backdrop-[\w[\]/.]+|ring(?:-[\w[\]/.]+)?|animate-[\w[\]/.]+)(?![\w-])/;

/** 따옴표·백틱 문자열 안의 내용만 모은다. 클래스 이름은 문자열에 있고, 변수·함수 이름은 문자열 밖이다. */
function stringLiterals(code: string): string {
  return (code.match(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g) ?? []).join("\n");
}

/** 위반 목록을 돌려준다(빈 배열이면 통과). */
export function findViolations(code: string, file = "sample"): string[] {
  const found: string[] = [];
  const body = stripComments(code);
  const strings = stringLiterals(body);
  const hex = body.match(RAW_HEX);
  if (hex) found.push(`${file}: raw 색상 ${hex[0]} — tokens.css의 토큰을 쓴다`);
  const cls = strings.match(FORBIDDEN_CLASS);
  if (cls) found.push(`${file}: 금지된 클래스 ${cls[1]}`);
  for (const match of strings.matchAll(/duration-(\d+)/g)) {
    if (Number(match[1]) > 200) found.push(`${file}: 전환 ${match[0]}은 200ms를 넘는다`);
  }
  return found;
}

describe("검출기 자체 검증 (위반을 실제로 잡는가)", () => {
  it("raw 색상을 잡는다", () => {
    expect(findViolations('<div className="bg-[#ff0000]" />')).not.toEqual([]);
    expect(findViolations('style={{ color: "#fff" }}')).not.toEqual([]);
  });

  it("라운드·그림자·블러·링·애니메이션 클래스를 잡는다", () => {
    for (const cls of ["rounded-lg", "rounded-full", "rounded", "shadow-md", "drop-shadow-lg", "blur-sm", "backdrop-blur", "ring-2", "animate-spin"]) {
      expect(findViolations(`<div className="p-4 ${cls}" />`), cls).not.toEqual([]);
    }
  });

  it("200ms를 넘는 전환을 잡는다", () => {
    expect(findViolations('className="duration-300"')).not.toEqual([]);
    expect(findViolations('className="duration-150"')).toEqual([]);
  });

  it("정상 코드와 비슷한 이름은 잡지 않는다", () => {
    expect(findViolations('className="border-line bg-card px-3"')).toEqual([]);
    expect(findViolations("onBlurCapture={() => {}} const ringBuffer = 1;")).toEqual([]);
    expect(findViolations('href="/dev/ui#cards"')).toEqual([]);
    expect(findViolations("// rounded-lg 는 쓰지 않는다\nconst a = 1;")).toEqual([]);
    // 변수·함수 이름은 클래스가 아니다(lib/rating.ts의 `rounded` 변수가 실제로 걸렸던 거짓 양성).
    expect(findViolations("const rounded = Math.round(value / STEP) * STEP; return rounded;")).toEqual([]);
    expect(findViolations("function shadowCopy() {}")).toEqual([]);
  });

  it("문자열(클래스 목록) 안의 위반은 여전히 잡는다", () => {
    expect(findViolations("const cls = `p-4 ${x} rounded-md`;")).not.toEqual([]);
    expect(findViolations("cn('flex', cond && 'shadow-lg')")).not.toEqual([]);
  });
});

describe("소스 규칙", () => {
  const codeFiles = sourceFiles([".ts", ".tsx"]);

  it("검사 대상 파일이 있다(경로가 잘못돼 아무것도 검사하지 않는 일을 막는다)", () => {
    expect(codeFiles.length).toBeGreaterThan(10);
  });

  it("컴포넌트·페이지에 raw 색상, 라운드, 그림자, 긴 전환이 없다", () => {
    const violations = codeFiles.flatMap((file) =>
      findViolations(readFileSync(file, "utf8"), path.relative(SRC, file)),
    );
    expect(violations).toEqual([]);
  });

  it("tokens.css 밖의 CSS에는 raw 색상·border-radius·box-shadow·keyframes가 없다(globals의 전역 규칙 제외)", () => {
    const cssFiles = sourceFiles([".css"]).filter((file) => file !== TOKENS);
    const violations = cssFiles.flatMap((file) => {
      const css = stripComments(readFileSync(file, "utf8"));
      const found: string[] = [];
      if (file !== GLOBALS) {
        if (/border-radius|box-shadow/.test(css)) found.push(`${path.relative(SRC, file)}: radius/shadow`);
      }
      if (RAW_HEX.test(css)) found.push(`${path.relative(SRC, file)}: raw 색상`);
      if (/@keyframes/.test(css)) found.push(`${path.relative(SRC, file)}: keyframes`);
      return found;
    });
    expect(violations).toEqual([]);
  });

  it("전역 규칙: 모든 요소(의사 요소 포함)의 radius는 0, shadow는 none이다", () => {
    const globals = readFileSync(GLOBALS, "utf8");
    expect(globals).toMatch(/\*,\s*\*::before,\s*\*::after\s*\{[^}]*border-radius:\s*0\s*!important/);
    expect(globals).toMatch(/\*,\s*\*::before,\s*\*::after\s*\{[^}]*box-shadow:\s*none\s*!important/);
  });

  it("Tailwind 기본 팔레트·radius·shadow를 지운다", () => {
    const globals = readFileSync(GLOBALS, "utf8");
    for (const reset of ["--color-*: initial", "--radius-*: initial", "--shadow-*: initial"]) {
      expect(globals).toContain(reset);
    }
  });
});

import { describe, expect, it } from "vitest";
import { hasModifier } from "@/lib/keyboard";

const NONE = { altKey: false, ctrlKey: false, metaKey: false };

describe("hasModifier", () => {
  it("수정 키가 없으면 false다", () => {
    expect(hasModifier(NONE)).toBe(false);
  });

  it("Alt, Ctrl, Meta(Cmd) 중 하나라도 눌려 있으면 true다", () => {
    expect(hasModifier({ ...NONE, altKey: true })).toBe(true);
    expect(hasModifier({ ...NONE, ctrlKey: true })).toBe(true);
    expect(hasModifier({ ...NONE, metaKey: true })).toBe(true);
  });

  it("여러 개가 함께 눌려도 true다", () => {
    expect(hasModifier({ altKey: true, ctrlKey: true, metaKey: true })).toBe(true);
  });

  it("Shift는 수정 키로 보지 않는다(Shift는 이 함수의 인자에도 없다)", () => {
    expect(hasModifier({ ...NONE, ...({ shiftKey: true } as object) })).toBe(false);
  });
});

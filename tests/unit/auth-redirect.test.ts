import { describe, expect, it } from "vitest";
import { safeRedirectPath } from "@/features/auth/redirect";

describe("safeRedirectPath", () => {
  it.each(["/", "/library", "/games/123?tab=reviews#top", "/authors", "/u/user_0a0b0c0d"])(
    "사이트 안의 경로는 그대로 받는다: %s",
    (path) => {
      expect(safeRedirectPath(path)).toBe(path);
    },
  );

  it.each([null, undefined, ""])("값이 없으면 기본 경로를 쓴다: %s", (value) => {
    expect(safeRedirectPath(value)).toBe("/");
  });

  it.each([
    ["절대 URL", "https://evil.example/phish"],
    ["프로토콜 상대 URL", "//evil.example"],
    ["역슬래시(브라우저가 /로 읽는다)", "/\\evil.example"],
    ["탭이 끼어든 프로토콜 상대 URL", "/\t/evil.example"],
    ["개행이 끼어든 프로토콜 상대 URL", "/\n/evil.example"],
    ["javascript 스킴", "javascript:alert(1)"],
    ["슬래시로 시작하지 않는 값", "evil.example"],
  ])("열린 리디렉션을 막는다: %s", (_name, input) => {
    expect(safeRedirectPath(input)).toBe("/");
  });

  it.each(["/auth/sign-in", "/auth/sign-up?x=1", "/auth", "/api/auth/get-session"])(
    "인증 화면·API로는 되돌리지 않는다: %s",
    (input) => {
      expect(safeRedirectPath(input)).toBe("/");
    },
  );

  it("기본 경로를 바꿀 수 있다", () => {
    expect(safeRedirectPath("//evil.example", "/library")).toBe("/library");
  });
});

import { describe, expect, it } from "vitest";
import { HANDLE_PATTERN, charLength, deriveNickname, generateHandle } from "@/features/profiles/handle";

describe("HANDLE_PATTERN", () => {
  it.each(["abc", "user_0a0b0c0d", "a_1", "x".repeat(20)])("허용한다: %s", (handle) => {
    expect(HANDLE_PATTERN.test(handle)).toBe(true);
  });

  it.each(["ab", "x".repeat(21), "Upper", "has space", "한글", "dot.name", "dash-name", ""])("거절한다: %s", (handle) => {
    expect(HANDLE_PATTERN.test(handle)).toBe(false);
  });
});

describe("generateHandle", () => {
  it("`user_` + 16진수 8자리이고 핸들 규칙을 만족한다", () => {
    expect(generateHandle(new Uint8Array([0x0a, 0x0b, 0x0c, 0x0d]))).toBe("user_0a0b0c0d");
    expect(generateHandle(new Uint8Array([0, 0, 0, 1]))).toBe("user_00000001");
    expect(HANDLE_PATTERN.test(generateHandle())).toBe(true);
  });
});

describe("deriveNickname", () => {
  it("앞뒤 공백을 지우고 연속 공백은 하나로 줄인다", () => {
    expect(deriveNickname("  김   게이머 ")).toBe("김 게이머");
  });

  it.each([null, undefined, "", "   "])("비어 있으면 기본 닉네임을 쓴다: %j", (name) => {
    expect(deriveNickname(name)).toBe("플레이어");
  });

  it("20자까지만 쓰고 이모지를 반으로 자르지 않는다", () => {
    expect(deriveNickname("가".repeat(30))).toBe("가".repeat(20));
    const clipped = deriveNickname("😀".repeat(30));
    expect(clipped).toBe("😀".repeat(20));
    expect(charLength(clipped)).toBe(20);
  });

  it("자른 뒤 끝에 남은 공백은 지운다", () => {
    expect(deriveNickname(`${"가".repeat(19)} 나`)).toBe("가".repeat(19));
  });
});

describe("charLength", () => {
  it("UTF-16 두 칸짜리 글자도 하나로 센다", () => {
    expect("😀".length).toBe(2);
    expect(charLength("😀")).toBe(1);
    expect(charLength("가나다")).toBe(3);
  });
});

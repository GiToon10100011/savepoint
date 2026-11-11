import { describe, expect, it } from "vitest";
import { authErrorMessage } from "@/features/auth/messages";

const FALLBACK = "문제가 생겨 처리하지 못했어요. 잠시 후 다시 시도해 주세요.";

describe("authErrorMessage", () => {
  it("Neon Auth가 실제로 돌려주는 코드를 한국어로 바꾼다", () => {
    expect(authErrorMessage({ code: "INVALID_EMAIL_OR_PASSWORD", status: 401 })).toBe(
      "이메일 또는 비밀번호가 올바르지 않아요.",
    );
    expect(authErrorMessage({ code: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL", status: 422 })).toContain("이미 가입된 이메일");
    expect(authErrorMessage({ code: "PASSWORD_TOO_SHORT" })).toBe("비밀번호는 8자 이상이어야 해요.");
    expect(authErrorMessage({ code: "PASSWORD_TOO_LONG" })).toBe("비밀번호는 128자 이하여야 해요.");
  });

  it("로그인 실패는 이메일이 없는 경우와 비밀번호가 틀린 경우를 구분하지 않는다", () => {
    // 서버가 같은 코드를 돌려주므로 같은 문장이 나온다(가입 여부를 알려 주지 않는다).
    const message = authErrorMessage({ code: "INVALID_EMAIL_OR_PASSWORD" });
    expect(message).not.toMatch(/없|존재|가입/);
  });

  it("요청이 너무 많으면(429) 안내한다", () => {
    expect(authErrorMessage({ status: 429 })).toContain("너무 많아요");
  });

  it.each([null, undefined, {}, { code: "SOMETHING_NEW" }, { status: 500 }])("모르는 오류는 일반 문구를 쓴다: %j", (error) => {
    expect(authErrorMessage(error)).toBe(FALLBACK);
  });

  it.each(["constructor", "toString", "__proto__", "hasOwnProperty"])(
    "객체 프로토타입의 키(%s)를 코드로 오인하지 않는다",
    (code) => {
      expect(authErrorMessage({ code })).toBe(FALLBACK);
    },
  );
});

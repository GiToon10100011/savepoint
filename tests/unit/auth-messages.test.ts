import { describe, expect, it } from "vitest";
import { authErrorMessage } from "@/features/auth/messages";

const FALLBACK = "문제가 생겨 처리하지 못했어요. 잠시 후 다시 시도해 주세요.";

// 입력은 서버 API(`auth.signIn/signUp`)가 실제로 돌려주는 형태다. @neon/auth의 normalizeBetterAuthError가
// Better Auth의 오류를 소문자 코드로 바꾼다:
//   INVALID_EMAIL_OR_PASSWORD → invalid_credentials, PASSWORD_TOO_SHORT/LONG → weak_password,
//   USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL(422, SDK 변환표에 없음) → validation_failed + 영어 원문 유지.
// HTTP로 직접 보이는 원래 코드(대문자)를 기준으로 짜면 이 경로에서 조용히 일반 문구로 떨어진다(E2E가 잡아낸 실수).
describe("authErrorMessage", () => {
  it("SDK가 돌려주는 코드를 한국어로 바꾼다", () => {
    expect(authErrorMessage({ code: "invalid_credentials", status: 401 })).toBe("이메일 또는 비밀번호가 올바르지 않아요.");
    expect(authErrorMessage({ code: "weak_password", status: 400 })).toContain("8자 이상");
    expect(authErrorMessage({ code: "email_address_invalid", status: 400 })).toBe("이메일 형식을 확인해 주세요.");
    expect(authErrorMessage({ code: "over_request_rate_limit", status: 429 })).toContain("너무 많아요");
  });

  it("이미 가입된 이메일은 validation_failed로 뭉개져 와도 원문 메시지로 알아본다", () => {
    const fromSdk = { code: "validation_failed", status: 422, message: "User already exists. Use another email." };
    expect(authErrorMessage(fromSdk)).toContain("이미 가입된 이메일");
    expect(authErrorMessage({ code: "user_already_exists", status: 409 })).toContain("이미 가입된 이메일");
    expect(authErrorMessage({ code: "email_exists", status: 409 })).toContain("이미 가입된 이메일");
  });

  it("그 밖의 검증 오류는 일반 검증 문구를 쓴다", () => {
    expect(authErrorMessage({ code: "validation_failed", status: 422, message: "Something else is wrong" })).toBe(
      "입력한 내용을 다시 확인해 주세요.",
    );
  });

  it("로그인 실패 문구는 이메일이 없는지 비밀번호가 틀렸는지 알려 주지 않는다", () => {
    // 서버가 두 경우에 같은 코드를 돌려주고, 문구도 가입 여부를 드러내지 않는다.
    expect(authErrorMessage({ code: "invalid_credentials" })).not.toMatch(/없|존재|가입/);
  });

  it("코드가 없어도 상태가 429면 안내한다", () => {
    expect(authErrorMessage({ status: 429 })).toContain("너무 많아요");
  });

  it.each([null, undefined, {}, { code: "something_new" }, { status: 500 }])("모르는 오류는 일반 문구를 쓴다: %j", (error) => {
    expect(authErrorMessage(error)).toBe(FALLBACK);
  });

  it("영어 원문 메시지를 화면에 그대로 내보내지 않는다", () => {
    const message = authErrorMessage({ code: "unexpected_failure", status: 500, message: "Invalid login credentials" });
    expect(message).toBe(FALLBACK);
  });

  it.each(["constructor", "toString", "__proto__", "hasOwnProperty"])(
    "객체 프로토타입의 키(%s)를 코드로 오인하지 않는다",
    (code) => {
      expect(authErrorMessage({ code })).toBe(FALLBACK);
    },
  );
});

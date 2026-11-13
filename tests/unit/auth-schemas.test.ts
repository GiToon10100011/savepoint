import { describe, expect, it } from "vitest";
import { fieldErrors, readForm, signInSchema, signUpSchema } from "@/features/auth/schemas";

const valid = { name: "플레이어", email: "player@example.com", password: "correct-horse-9" };

describe("signInSchema", () => {
  it("이메일과 비밀번호가 있으면 통과한다", () => {
    expect(signInSchema.safeParse({ email: "a@example.com", password: "x" }).success).toBe(true);
  });

  it("이메일 형식이 틀리면 필드 오류를 낸다", () => {
    const result = signInSchema.safeParse({ email: "not-an-email", password: "x" });
    expect(result.success).toBe(false);
    if (!result.success) expect(fieldErrors(result.error).email).toBe("이메일 형식을 확인해 주세요.");
  });

  it("비밀번호가 비어 있으면 거절하지만 길이 규칙은 알려 주지 않는다", () => {
    const result = signInSchema.safeParse({ email: "a@example.com", password: "" });
    expect(result.success).toBe(false);
    if (!result.success) expect(fieldErrors(result.error).password).toBe("비밀번호를 입력해 주세요.");
    // 짧은 비밀번호도 일단 서버에 보낸다(가입 규칙을 로그인 화면에서 흘리지 않는다).
    expect(signInSchema.safeParse({ email: "a@example.com", password: "abc" }).success).toBe(true);
  });
});

describe("signUpSchema", () => {
  it("올바른 입력은 통과한다", () => {
    expect(signUpSchema.safeParse(valid).success).toBe(true);
  });

  it("닉네임은 1–20자이고 이모지도 한 글자로 센다", () => {
    expect(signUpSchema.safeParse({ ...valid, name: "" }).success).toBe(false);
    expect(signUpSchema.safeParse({ ...valid, name: "가".repeat(20) }).success).toBe(true);
    expect(signUpSchema.safeParse({ ...valid, name: "가".repeat(21) }).success).toBe(false);
    // 😀는 UTF-16으로 2칸이지만 한 글자다: 20자면 통과, 21자면 거절.
    expect(signUpSchema.safeParse({ ...valid, name: "😀".repeat(20) }).success).toBe(true);
    expect(signUpSchema.safeParse({ ...valid, name: "😀".repeat(21) }).success).toBe(false);
  });

  it("비밀번호는 8–128자다", () => {
    expect(signUpSchema.safeParse({ ...valid, password: "a".repeat(7) }).success).toBe(false);
    expect(signUpSchema.safeParse({ ...valid, password: "a".repeat(8) }).success).toBe(true);
    expect(signUpSchema.safeParse({ ...valid, password: "a".repeat(128) }).success).toBe(true);
    expect(signUpSchema.safeParse({ ...valid, password: "a".repeat(129) }).success).toBe(false);
  });

  it("필드마다 첫 오류 메시지만 모은다", () => {
    const result = signUpSchema.safeParse({ name: "", email: "x", password: "a" });
    expect(result.success).toBe(false);
    if (result.success) return;
    const errors = fieldErrors(result.error);
    expect(errors.name).toBe("닉네임을 입력해 주세요.");
    expect(errors.email).toBe("이메일 형식을 확인해 주세요.");
    expect(errors.password).toBe("비밀번호는 8자 이상이어야 해요.");
  });
});

describe("readForm", () => {
  it("이메일·닉네임은 앞뒤 공백을 지우고 비밀번호는 그대로 둔다", () => {
    const form = new FormData();
    form.set("email", "  a@example.com ");
    form.set("name", " 닉네임 ");
    form.set("password", "  keep spaces  ");
    expect(readForm(form, ["email", "name", "password"])).toEqual({
      email: "a@example.com",
      name: "닉네임",
      password: "  keep spaces  ",
    });
  });

  it("없거나 파일인 필드는 빈 문자열로 읽는다", () => {
    const form = new FormData();
    form.set("name", new File(["x"], "x.txt"));
    expect(readForm(form, ["name", "email"])).toEqual({ name: "", email: "" });
  });
});

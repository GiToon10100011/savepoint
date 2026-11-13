import { beforeEach, describe, expect, it, vi } from "vitest";

// 바깥 경계 두 곳(인증 SDK, 이동)만 대체하고 액션 자체의 판단을 시험한다.
const mocks = vi.hoisted(() => ({
  redirect: vi.fn(),
  signIn: vi.fn(),
  signUp: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/server/auth", () => ({
  auth: { signIn: { email: mocks.signIn }, signUp: { email: mocks.signUp }, signOut: mocks.signOut },
}));

import { signInAction, signOutAction, signUpAction } from "@/features/auth/actions";

const SIGN_OUT_FAILED = "로그아웃하지 못했어요. 잠시 후 다시 시도해 주세요.";

/**
 * redirect()가 **정확히** 이 주소로 불렸는지 본다. 메시지의 부분 일치(`toThrow("NEXT_REDIRECT:/")`)로는
 * `NEXT_REDIRECT://evil.example`도 통과해, 열린 리디렉션 시험이 아무것도 막지 못한다.
 */
const redirectedTo = (promise: Promise<unknown>, url: string) =>
  expect(promise).rejects.toHaveProperty("message", `NEXT_REDIRECT:${url}`);

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

beforeEach(() => {
  vi.resetAllMocks();
  // 실제 redirect()처럼 예외를 던져 이후 코드가 실행되지 않게 한다.
  mocks.redirect.mockImplementation((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  });
});

describe("signOutAction", () => {
  it("로그아웃에 성공하면 홈으로 보낸다", async () => {
    mocks.signOut.mockResolvedValue({ data: { success: true }, error: null });
    await redirectedTo(signOutAction(), "/");
  });

  it("인증 서버가 오류를 돌려주면(세션이 살아 있다) 이동하지 않고 알린다", async () => {
    // SDK는 예외 대신 { error }를 돌려주고, 이때 세션 쿠키는 지워지지 않는다.
    mocks.signOut.mockResolvedValue({ data: null, error: { code: "unexpected_failure", status: 502, message: "Bad gateway" } });
    await expect(signOutAction()).resolves.toEqual({ error: SIGN_OUT_FAILED });
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});

describe("signInAction", () => {
  const valid = { email: "player@example.com", password: "correct-horse-9" };

  it("입력이 틀리면 SDK를 부르지 않고 필드 오류와 입력한 이메일을 돌려준다", async () => {
    const state = await signInAction(null, form({ email: "not-an-email", password: "" }));
    expect(mocks.signIn).not.toHaveBeenCalled();
    expect(state?.fieldErrors).toMatchObject({ email: "이메일 형식을 확인해 주세요.", password: "비밀번호를 입력해 주세요." });
    expect(state?.values).toEqual({ email: "not-an-email" });
  });

  it("SDK가 거절하면 한국어 안내를 돌려주고, 비밀번호는 상태에 담지 않는다", async () => {
    mocks.signIn.mockResolvedValue({ data: null, error: { code: "invalid_credentials", status: 401, message: "Invalid login credentials" } });
    const state = await signInAction(null, form(valid));
    expect(state?.error).toBe("이메일 또는 비밀번호가 올바르지 않아요.");
    expect(state?.values).toEqual({ email: valid.email });
    expect(JSON.stringify(state)).not.toContain(valid.password);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("성공하면 redirectTo(사이트 안 경로)로 보낸다", async () => {
    mocks.signIn.mockResolvedValue({ data: {}, error: null });
    await redirectedTo(signInAction(null, form({ ...valid, redirectTo: "/account" })), "/account");
    expect(mocks.signIn).toHaveBeenCalledWith(valid);
  });

  it.each([
    ["값이 없을 때", {}],
    ["외부 주소", { redirectTo: "https://evil.example/phish" }],
    ["프로토콜 상대 URL", { redirectTo: "//evil.example" }],
    ["인증 화면", { redirectTo: "/auth/sign-in" }],
  ])("redirectTo가 안전하지 않으면 홈으로 보낸다: %s", async (_name, extra) => {
    mocks.signIn.mockResolvedValue({ data: {}, error: null });
    await redirectedTo(signInAction(null, form({ ...valid, ...extra })), "/");
  });
});

describe("signUpAction", () => {
  const valid = { name: "플레이어", email: "player@example.com", password: "correct-horse-9" };

  it("입력이 틀리면 SDK를 부르지 않는다", async () => {
    const state = await signUpAction(null, form({ name: "", email: "x", password: "a" }));
    expect(mocks.signUp).not.toHaveBeenCalled();
    expect(Object.keys(state?.fieldErrors ?? {}).sort()).toEqual(["email", "name", "password"]);
  });

  it("이미 가입된 이메일은 SDK가 validation_failed로 돌려줘도 알아보고 입력을 남긴다", async () => {
    mocks.signUp.mockResolvedValue({
      data: null,
      error: { code: "validation_failed", status: 422, message: "User already exists. Use another email." },
    });
    const state = await signUpAction(null, form(valid));
    expect(state?.error).toContain("이미 가입된 이메일");
    expect(state?.values).toEqual({ email: valid.email, name: valid.name });
  });

  it("공백을 다듬은 값으로 가입하고 성공하면 redirectTo로 보낸다", async () => {
    mocks.signUp.mockResolvedValue({ data: {}, error: null });
    const input = form({ name: "  플레이어 ", email: " player@example.com ", password: valid.password, redirectTo: "/library" });
    await redirectedTo(signUpAction(null, input), "/library");
    expect(mocks.signUp).toHaveBeenCalledWith(valid);
  });

  it("redirectTo가 외부 주소면 홈으로 보낸다", async () => {
    mocks.signUp.mockResolvedValue({ data: {}, error: null });
    await redirectedTo(signUpAction(null, form({ ...valid, redirectTo: "//evil.example" })), "/");
  });
});

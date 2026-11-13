"use server";

import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { authErrorMessage } from "./messages";
import { safeRedirectPath } from "./redirect";
import { fieldErrors, readForm, signInSchema, signUpSchema, type FieldErrors } from "./schemas";

/** 폼에 돌려주는 상태. 비밀번호는 다시 채워 주지 않으므로 담지 않는다. */
export type AuthFormState = {
  /** 서버(Neon Auth)가 거절한 이유. 필드에 붙지 않는 오류다. */
  error?: string;
  fieldErrors?: FieldErrors;
  /** 오류 뒤에도 입력이 남도록 돌려주는 값. */
  values?: { email?: string; name?: string };
} | null;

function redirectTarget(formData: FormData): string {
  const value = formData.get("redirectTo");
  return safeRedirectPath(typeof value === "string" ? value : null);
}

export async function signInAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const input = readForm(formData, ["email", "password"]);
  const values = { email: input.email };

  const parsed = signInSchema.safeParse(input);
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values };

  const { error } = await auth.signIn.email(parsed.data);
  if (error) return { error: authErrorMessage(error), values };

  redirect(redirectTarget(formData));
}

export async function signUpAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const input = readForm(formData, ["name", "email", "password"]);
  const values = { email: input.email, name: input.name };

  const parsed = signUpSchema.safeParse(input);
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values };

  const { error } = await auth.signUp.email(parsed.data);
  if (error) return { error: authErrorMessage(error), values };

  // 이 브랜치는 가입 직후 바로 로그인된다(이메일 인증을 요구하지 않는다). 프로필은 첫 화면에서 만들어진다.
  redirect(redirectTarget(formData));
}

/** 로그아웃 폼의 상태. 실패하면 오류 문구를 돌려주고 이동하지 않는다. */
export type SignOutState = { error: string } | null;

export async function signOutAction(): Promise<SignOutState> {
  const { error } = await auth.signOut();
  // 인증 서버에 닿지 못하면 SDK는 예외 없이 오류를 돌려주고 세션 쿠키를 지우지 않는다. 그때 홈으로 보내면
  // 세션이 살아 있는데도 로그아웃한 것처럼 보인다(공용 기기에서 위험하다). 이동하지 않고 알린다.
  if (error) return { error: "로그아웃하지 못했어요. 잠시 후 다시 시도해 주세요." };
  redirect("/");
}

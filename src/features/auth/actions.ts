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

export async function signOutAction(): Promise<void> {
  await auth.signOut();
  redirect("/");
}

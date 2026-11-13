"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/input";
import { signUpAction, type AuthFormState } from "../actions";
import { PASSWORD_MIN } from "../schemas";
import { NICKNAME_MAX } from "@/features/profiles/handle";

export function SignUpForm({ redirectTo }: { redirectTo?: string }) {
  const [state, formAction, pending] = useActionState<AuthFormState, FormData>(signUpAction, null);

  return (
    <form action={formAction} noValidate className="grid gap-6">
      {redirectTo ? <input type="hidden" name="redirectTo" value={redirectTo} /> : null}
      <TextField
        id="name"
        name="name"
        type="text"
        label="닉네임"
        hint={`${NICKNAME_MAX}자 이하. 나중에 바꿀 수 있어요.`}
        autoComplete="nickname"
        required
        defaultValue={state?.values?.name}
        error={state?.fieldErrors?.name}
      />
      <TextField
        id="email"
        name="email"
        type="email"
        label="이메일"
        autoComplete="email"
        required
        defaultValue={state?.values?.email}
        error={state?.fieldErrors?.email}
      />
      <TextField
        id="password"
        name="password"
        type="password"
        label="비밀번호"
        hint={`${PASSWORD_MIN}자 이상`}
        autoComplete="new-password"
        required
        error={state?.fieldErrors?.password}
      />
      {state?.error ? (
        <p role="alert" className="text-sm text-error">
          {state.error}
        </p>
      ) : null}
      <Button type="submit" size="lg" disabled={pending} className="w-full">
        {pending ? "가입 중…" : "가입하기"}
      </Button>
    </form>
  );
}

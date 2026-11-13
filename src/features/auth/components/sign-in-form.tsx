"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/input";
import { signInAction, type AuthFormState } from "../actions";

export function SignInForm({ redirectTo }: { redirectTo?: string }) {
  const [state, formAction, pending] = useActionState<AuthFormState, FormData>(signInAction, null);

  return (
    // noValidate: 브라우저 기본 검증 말풍선 대신 서버가 돌려주는 한국어 안내를 쓴다.
    <form action={formAction} noValidate className="grid gap-6">
      {redirectTo ? <input type="hidden" name="redirectTo" value={redirectTo} /> : null}
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
        autoComplete="current-password"
        required
        error={state?.fieldErrors?.password}
      />
      {state?.error ? (
        <p role="alert" className="text-sm text-error">
          {state.error}
        </p>
      ) : null}
      <Button type="submit" size="lg" disabled={pending} className="w-full">
        {pending ? "로그인 중…" : "로그인"}
      </Button>
    </form>
  );
}

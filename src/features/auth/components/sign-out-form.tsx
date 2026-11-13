"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { signOutAction, type SignOutState } from "../actions";

export function SignOutForm() {
  const [state, formAction, pending] = useActionState<SignOutState, FormData>(signOutAction, null);

  return (
    <form action={formAction} className="mt-10">
      {state?.error ? (
        <p role="alert" className="mb-4 text-sm text-error">
          {state.error}
        </p>
      ) : null}
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "로그아웃 중…" : "로그아웃"}
      </Button>
    </form>
  );
}

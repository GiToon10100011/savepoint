import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { SignUpForm } from "@/features/auth/components/sign-up-form";
import { safeRedirectPath } from "@/features/auth/redirect";
import { getSessionUser } from "@/server/viewer";

export const metadata: Metadata = { title: "가입하기" };

export default function SignUpPage({ searchParams }: PageProps<"/auth/sign-up">) {
  return (
    <main className="mx-auto w-full max-w-sm px-4 py-12">
      <h1 className="type-h1">가입하기</h1>
      <p className="type-body-sm mt-2 text-muted">게임을 평가하고 플레이 이력을 기록해 보세요.</p>
      <Suspense fallback={null}>
        <SignUpContent searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function SignUpContent({ searchParams }: Pick<PageProps<"/auth/sign-up">, "searchParams">) {
  const { redirectTo: raw } = await searchParams;
  const redirectTo = safeRedirectPath(typeof raw === "string" ? raw : null);

  if (await getSessionUser()) redirect(redirectTo);

  const carry = redirectTo === "/" ? undefined : redirectTo;
  const signInHref = carry ? `/auth/sign-in?redirectTo=${encodeURIComponent(carry)}` : "/auth/sign-in";
  return (
    <>
      <div className="mt-8">
        <SignUpForm redirectTo={carry} />
      </div>
      <p className="mt-8 text-sm">
        이미 계정이 있나요?{" "}
        <Link href={signInHref} className="font-semibold underline underline-offset-4">
          로그인
        </Link>
      </p>
    </>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { SignInForm } from "@/features/auth/components/sign-in-form";
import { safeRedirectPath } from "@/features/auth/redirect";
import { getSessionUser } from "@/server/viewer";

export const metadata: Metadata = { title: "로그인" };

export default function SignInPage({ searchParams }: PageProps<"/auth/sign-in">) {
  return (
    <main className="mx-auto w-full max-w-sm px-4 py-12">
      <h1 className="type-h1">로그인</h1>
      <p className="type-body-sm mt-2 text-muted">평가와 플레이 기록을 이어서 남겨요.</p>
      {/* 세션과 검색 파라미터는 요청 시점 데이터라 Suspense 경계 안에서 읽는다(Cache Components). */}
      <Suspense fallback={null}>
        <SignInContent searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function SignInContent({ searchParams }: Pick<PageProps<"/auth/sign-in">, "searchParams">) {
  const { redirectTo: raw } = await searchParams;
  const redirectTo = safeRedirectPath(typeof raw === "string" ? raw : null);

  // 이미 로그인했다면 로그인 화면을 보여 주지 않는다.
  if (await getSessionUser()) redirect(redirectTo);

  const carry = redirectTo === "/" ? undefined : redirectTo;
  const signUpHref = carry ? `/auth/sign-up?redirectTo=${encodeURIComponent(carry)}` : "/auth/sign-up";
  return (
    <>
      <div className="mt-8">
        <SignInForm redirectTo={carry} />
      </div>
      <p className="mt-8 text-sm">
        계정이 없나요?{" "}
        <Link href={signUpHref} className="font-semibold underline underline-offset-4">
          가입하기
        </Link>
      </p>
    </>
  );
}

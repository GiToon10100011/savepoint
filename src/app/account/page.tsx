import type { Metadata } from "next";
import { Suspense } from "react";
import { SignOutForm } from "@/features/auth/components/sign-out-form";
import { requireViewer } from "@/server/viewer";

export const metadata: Metadata = { title: "내 계정" };

export default function AccountPage() {
  return (
    <main className="mx-auto w-full max-w-xl px-4 py-12 lg:px-8">
      <h1 className="type-h1">내 계정</h1>
      <Suspense fallback={null}>
        <AccountDetails />
      </Suspense>
    </main>
  );
}

async function AccountDetails() {
  // proxy가 한 번 걸러 주지만 낙관적 검사일 뿐이라 데이터를 읽기 전에 세션을 다시 확인한다.
  const { user, profile } = await requireViewer("/account");
  return (
    <>
      <dl className="mt-8 grid gap-4">
        <div>
          <dt className="text-xs text-muted">닉네임</dt>
          <dd className="type-body mt-1" data-testid="account-nickname">
            {profile.nickname}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted">핸들</dt>
          <dd className="type-body mt-1" data-testid="account-handle">
            @{profile.handle}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted">이메일</dt>
          <dd className="type-body mt-1">{user.email}</dd>
        </div>
      </dl>
      <SignOutForm />
    </>
  );
}

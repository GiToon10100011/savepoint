import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { ensureProfile } from "@/features/profiles/ensure-profile";
import type { Profile } from "@/server/db/schema";
import { auth } from "./auth";
import { appPool } from "./db/client";

export type SessionUser = { id: string; name: string; email: string };
export type Viewer = { user: SessionUser; profile: Profile };

// 세션과 프로필 읽기는 요청 시점 데이터라 반드시 <Suspense> 안에서 부른다(Cache Components).
// react `cache`는 한 요청 안에서만 결과를 재사용한다(요청 사이에 공유하지 않는다).

/** 쿠키 세션만 읽는다(DB 조회 없음). 내비처럼 로그인 여부만 필요한 곳에서 쓴다. */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  // 세션은 실제 요청이 있어야만 알 수 있다. 프리렌더·프리페치 중에는 인증 서버로 fetch할 수 없어 거절되고,
  // SDK가 그 거절을 오류로 기록한다(페이지를 한 번 열 때마다 찍힌다). 요청이 올 때까지 렌더링을 미룬다.
  await connection();
  const { data: session } = await auth.getSession();
  const user = session?.user;
  if (!user) return null;
  return { id: user.id, name: user.name, email: user.email };
});

/** 세션과 앱 프로필. 첫 로그인이면 프로필을 만든다. 로그인하지 않았으면 null. */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  const user = await getSessionUser();
  if (!user) return null;
  const profile = await ensureProfile(appPool(), { authUserId: user.id, name: user.name });
  return { user, profile };
});

/**
 * 로그인이 필요한 화면·액션의 첫 줄에서 부른다. proxy의 리디렉션은 낙관적 검사일 뿐이라
 * 데이터를 읽거나 바꾸기 전에 여기서 다시 확인한다.
 *
 * `returnTo`에 이 화면의 경로를 넘기면 로그인 뒤 그 화면으로 돌아온다. proxy가 오래된 세션 쿠키를 통과시켜
 * 여기서 비로그인으로 판정되는 경우에도 같은 요구(원래 경로로 복귀)를 지키기 위해서다.
 */
export async function requireViewer(returnTo?: string): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer) redirect(returnTo ? `/auth/sign-in?redirectTo=${encodeURIComponent(returnTo)}` : "/auth/sign-in");
  return viewer;
}

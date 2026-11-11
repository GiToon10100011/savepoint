import { auth } from "@/server/auth";

/**
 * 비로그인 사용자를 로그인 화면으로 돌려보내는 낙관적 검사다. 권한 검사 자체는 Server Action·라우트
 * 핸들러에서 다시 한다(proxy는 세션 관리나 인가를 대신하지 못한다).
 *
 * 로그인·가입·`/api/auth`는 기본으로 공개이고, 나머지는 아래에 적은 경로만 공개다.
 * `/`는 정확히 홈만 뜻하고, 다른 항목은 하위 경로까지 포함한다.
 */
export default auth.middleware({
  loginUrl: "/auth/sign-in",
  publicRoutes: ["/", "/search", "/games", "/u", "/dev"],
});

export const config = {
  // 정적 파일과 이미지는 검사하지 않는다.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};

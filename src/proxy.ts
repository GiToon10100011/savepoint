import type { NextRequest } from "next/server";
import { auth } from "@/server/auth";

const LOGIN_URL = "/auth/sign-in";

/**
 * 비로그인 사용자를 로그인 화면으로 돌려보내는 낙관적 검사다. 권한 검사 자체는 Server Action·라우트
 * 핸들러에서 다시 한다(proxy는 세션 관리나 인가를 대신하지 못한다).
 *
 * 로그인·가입·`/api/auth`는 기본으로 공개이고, 나머지는 아래에 적은 경로만 공개다.
 * `/`는 정확히 홈만 뜻하고, 다른 항목은 하위 경로까지 포함한다.
 */
const middleware = auth.middleware({
  loginUrl: LOGIN_URL,
  publicRoutes: ["/", "/search", "/games", "/genres", "/tags", "/companies", "/u", "/dev"],
});

export default async function proxy(request: NextRequest) {
  const response = await middleware(request);

  // SDK는 로그인 화면으로 보낼 때 요청의 쿼리만 옮기고 원래 경로는 붙여 주지 않는다. 제품 요구(보호 경로에서
  // 로그인하면 원래 경로로 돌아온다, user-flows §2)를 위해 `redirectTo`를 덧붙인다. 쿠키 등 나머지 응답은 그대로다.
  const location = response.headers.get("location");
  if (!location) return response;

  const target = new URL(location, request.url);
  const isLoginRedirect =
    target.origin === request.nextUrl.origin && target.pathname === LOGIN_URL && !target.searchParams.has("redirectTo");
  if (isLoginRedirect) {
    const original = request.nextUrl.clone();
    original.searchParams.delete("_rsc"); // Next가 프리페치·내비게이션 요청에 붙이는 내부 파라미터
    target.searchParams.set("redirectTo", original.pathname + original.search);
    response.headers.set("location", target.toString());
  }
  return response;
}

export const config = {
  // 정적 파일과 이미지는 검사하지 않는다.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};

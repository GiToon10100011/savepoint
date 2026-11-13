import { auth } from "@/server/auth";

// 브라우저의 authClient 요청을 같은 출처에서 Neon Auth로 중계한다(쿠키 세션과 OAuth 검증값 처리 포함).
export const { GET, POST, PUT, DELETE, PATCH } = auth.handler();

import { defineConfig } from "@neon/config/v1";

// Neon Auth(Managed Better Auth)만 선언한다. 사용자·세션은 브랜치의 neon_auth 스키마에 저장된다.
// 적용: `npx neon deploy --branch dev --no-env-pull` (브랜치를 지정해 다른 브랜치에 켜지지 않게 한다)
export default defineConfig({
  auth: true,
});

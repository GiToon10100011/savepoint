import { describe, expect, it } from "vitest";
import {
  mergeEnv,
  randomPassword,
  toPooledUrl,
  withCredentials,
} from "@/server/db/connection";

// 테스트에는 가짜 호스트와 값만 쓴다.
const DIRECT = "postgresql://owner:pw@ep-cool-123.ap-southeast-1.aws.neon.tech/neondb?sslmode=require";

describe("toPooledUrl", () => {
  it("엔드포인트 ID 뒤에 -pooler를 붙인다", () => {
    expect(new URL(toPooledUrl(DIRECT)).hostname).toBe(
      "ep-cool-123-pooler.ap-southeast-1.aws.neon.tech",
    );
  });

  it("이미 풀러 호스트면 그대로 둔다", () => {
    const pooled = toPooledUrl(DIRECT);
    expect(toPooledUrl(pooled)).toBe(pooled);
  });

  it("DB 이름과 쿼리를 유지한다", () => {
    const u = new URL(toPooledUrl(DIRECT));
    expect(u.pathname).toBe("/neondb");
    expect(u.searchParams.get("sslmode")).toBe("require");
  });
});

describe("withCredentials", () => {
  it("사용자와 비밀번호만 바꾼다", () => {
    const u = new URL(withCredentials(DIRECT, "app_user", "s3cret_-"));
    expect(u.username).toBe("app_user");
    expect(u.password).toBe("s3cret_-");
    expect(u.hostname).toBe("ep-cool-123.ap-southeast-1.aws.neon.tech");
    expect(u.pathname).toBe("/neondb");
  });
});

describe("mergeEnv", () => {
  it("기존 키를 교체하고 주석과 다른 키는 보존한다", () => {
    const out = mergeEnv("# 주석\nA=1\nB=2\n", { A: "10" });
    expect(out).toBe("# 주석\nA=10\nB=2\n");
  });

  it("없는 키는 끝에 추가한다", () => {
    expect(mergeEnv("A=1\n", { B: "2" })).toBe("A=1\nB=2\n");
  });

  it("빈 파일에서도 줄바꿈으로 끝난다", () => {
    expect(mergeEnv("", { A: "1" })).toBe("A=1\n");
  });

  it("같은 입력에 두 번 적용해도 결과가 같다", () => {
    const once = mergeEnv("A=1\n", { A: "2", B: "3" });
    expect(mergeEnv(once, { A: "2", B: "3" })).toBe(once);
  });
});

describe("randomPassword", () => {
  it("URL에 안전한 문자만 쓰고 매번 다르다", () => {
    const a = randomPassword();
    const b = randomPassword();
    expect(a).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(a).not.toBe(b);
  });
});

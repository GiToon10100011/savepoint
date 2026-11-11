import { sql } from "drizzle-orm";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { runAsUser } from "@/server/db/with-user";

// 풀링된(트랜잭션 모드) 연결로 app_user에 접속한다. 연결이 하나뿐인 풀이라 같은 연결이 재사용된다.
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
afterAll(() => pool.end());

const PROFILE_ID = "6f1c1c1e-7a52-4f0f-9d0c-3f2a8a1b9c10";

async function userSetting() {
  const { rows } = await pool.query("select current_setting('app.user_id', true) as v");
  return rows[0].v ?? "";
}

describe("테스트 설정", () => {
  it("풀링(트랜잭션 모드) 호스트로 접속한다", () => {
    // 직접 연결이면 설정값 누수 검증이 의미가 없으므로 설정 오류를 바로 드러낸다.
    expect(new URL(process.env.DATABASE_URL as string).hostname).toContain("-pooler");
  });
});

describe("app_user 역할", () => {
  it("RLS를 우회하지 않는 일반 역할이다", async () => {
    const { rows } = await pool.query(
      "select current_user as who, r.rolbypassrls as bypass, r.rolsuper as super from pg_roles r where r.rolname = current_user",
    );
    expect(rows[0]).toEqual({ who: "app_user", bypass: false, super: false });
  });
});

describe("runAsUser", () => {
  it("트랜잭션 안에서 두 설정값을 읽을 수 있다", async () => {
    const row = await runAsUser(pool, { authUserId: "auth-1", profileId: PROFILE_ID }, async (tx) => {
      const { rows } = await tx.execute(
        sql`select current_setting('app.user_id', true) as uid, current_setting('app.auth_user_id', true) as aid`,
      );
      return rows[0];
    });
    expect(row).toEqual({ uid: PROFILE_ID, aid: "auth-1" });
  });

  it("프로필이 없는 첫 로그인에서는 app.user_id가 비어 있다", async () => {
    const row = await runAsUser(pool, { authUserId: "auth-new" }, async (tx) => {
      const { rows } = await tx.execute(
        sql`select current_setting('app.user_id', true) as uid, current_setting('app.auth_user_id', true) as aid`,
      );
      return rows[0];
    });
    expect(row).toEqual({ uid: "", aid: "auth-new" });
  });

  it("끝난 뒤 같은 연결을 쓰는 다음 요청으로 값이 새지 않는다", async () => {
    await runAsUser(pool, { authUserId: "auth-1", profileId: PROFILE_ID }, async () => {});
    for (let i = 0; i < 5; i += 1) expect(await userSetting()).toBe("");
  });

  it("오류가 나면 롤백하고 연결을 반환해 다음 요청이 막히지 않는다", async () => {
    for (let i = 0; i < 3; i += 1) {
      await expect(
        runAsUser(pool, { authUserId: "auth-1", profileId: PROFILE_ID }, async () => {
          throw new Error("boom");
        }),
      ).rejects.toThrow("boom");
    }
    // 연결이 1개뿐인 풀에서 위 요청들이 연결을 붙잡고 있다면 여기서 멈춘다.
    expect(await userSetting()).toBe("");
  });

  it("uuid가 아닌 profileId와 빈 authUserId는 DB에 닿기 전에 거부한다", async () => {
    await expect(runAsUser(pool, { authUserId: "a", profileId: "not-a-uuid" }, async () => {})).rejects.toThrow(
      "uuid",
    );
    await expect(runAsUser(pool, { authUserId: "" }, async () => {})).rejects.toThrow("authUserId");
  });
});

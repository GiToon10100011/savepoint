import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Pool, PoolClient } from "pg";

/** 트랜잭션 안에서 쓰는 drizzle 핸들. 하나의 PoolClient에 묶여 있다. */
export type Tx = NodePgDatabase<Record<string, unknown>> & { $client: PoolClient };

export type UserContext = {
  /** 세션의 Neon Auth 사용자 ID. 프로필이 없는 첫 로그인에서도 항상 있다. */
  authUserId: string;
  /** 앱 프로필 ID(uuid). 프로필 생성 전에는 없다. */
  profileId?: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 한 요청을 하나의 트랜잭션으로 실행하고, RLS 정책이 읽는 설정값
 * `app.user_id`·`app.auth_user_id`를 **트랜잭션 로컬**(is_local = true)로 넣는다.
 * 풀링된 연결(트랜잭션 모드)에서도 다음 요청으로 값이 새지 않는다.
 */
export async function runAsUser<T>(
  pool: Pool,
  ctx: UserContext,
  fn: (tx: Tx, client: PoolClient) => Promise<T>,
): Promise<T> {
  if (!ctx.authUserId) throw new Error("authUserId is required");
  if (ctx.profileId !== undefined && !UUID.test(ctx.profileId)) {
    throw new Error("profileId must be a uuid");
  }

  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(
      "select set_config('app.auth_user_id', $1, true), set_config('app.user_id', $2, true)",
      [ctx.authUserId, ctx.profileId ?? ""],
    );
    const result = await fn(drizzle(client), client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

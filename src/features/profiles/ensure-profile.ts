import { eq } from "drizzle-orm";
import type { Pool } from "pg";
import { profiles, type Profile } from "@/server/db/schema";
import { runAsUser } from "@/server/db/with-user";
import { deriveNickname, generateHandle } from "./handle";

export type AuthIdentity = {
  /** Neon Auth 사용자 ID(세션에서 온 값). */
  authUserId: string;
  /** 가입 때 받은 이름. 프로필의 첫 닉네임이 된다. */
  name?: string | null;
};

// 임시 핸들이 우연히 겹칠 확률은 매우 낮다(16^8). 그래도 겹치면 새로 만들어 몇 번 더 시도한다.
const MAX_ATTEMPTS = 5;

export function findProfileByAuthUserId(pool: Pool, authUserId: string): Promise<Profile | undefined> {
  return runAsUser(pool, { authUserId }, async (tx) => {
    const [row] = await tx.select().from(profiles).where(eq(profiles.authUserId, authUserId)).limit(1);
    return row;
  });
}

/**
 * 세션의 사용자에게 프로필이 없으면 만들고, 있으면 그대로 돌려준다(첫 로그인에서 한 번만 만든다).
 * 같은 사용자의 요청이 동시에 들어와도 프로필은 하나만 생긴다: `auth_user_id`가 UNIQUE이고
 * 충돌한 쪽은 `ON CONFLICT DO NOTHING`으로 물러난 뒤 먼저 만들어진 행을 읽는다.
 *
 * 생성 INSERT의 RLS 정책은 `auth_user_id = app.auth_user_id`를 요구하므로 남의 ID로는 만들 수 없다.
 */
export async function ensureProfile(
  pool: Pool,
  identity: AuthIdentity,
  makeHandle: () => string = generateHandle,
): Promise<Profile> {
  const existing = await findProfileByAuthUserId(pool, identity.authUserId);
  return existing ?? createProfileIfAbsent(pool, identity, makeHandle);
}

/**
 * `ensureProfile`의 두 번째 단계: 조회 없이 곧바로 만든다. 확인과 생성 사이에 같은 사용자의 다른 요청이
 * 먼저 프로필을 커밋했다면 오류 없이 그 프로필을 돌려준다. 이 경쟁을 결정적으로 시험할 수 있게 따로 내보낸다.
 */
export async function createProfileIfAbsent(
  pool: Pool,
  identity: AuthIdentity,
  makeHandle: () => string = generateHandle,
): Promise<Profile> {
  const { authUserId } = identity;
  const nickname = deriveNickname(identity.name);
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const created = await runAsUser(pool, { authUserId }, async (tx) => {
      // 대상을 지정하지 않아 auth_user_id와 handle 어느 쪽 충돌이든 오류 없이 건너뛴다.
      const [row] = await tx
        .insert(profiles)
        .values({ authUserId, handle: makeHandle(), nickname })
        .onConflictDoNothing()
        .returning();
      return row;
    });
    if (created) return created;

    // 건너뛰었다면 (a) 동시 요청이 먼저 만들었거나 (b) 핸들이 겹친 것이다. (a)면 그 행을 쓰고 (b)면 다시 시도한다.
    const raced = await findProfileByAuthUserId(pool, authUserId);
    if (raced) return raced;
  }
  throw new Error("프로필을 만들지 못했다(핸들 충돌이 계속됐다)");
}

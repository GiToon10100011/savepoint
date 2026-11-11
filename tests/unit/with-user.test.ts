import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { runAsUser } from "@/server/db/with-user";

/** DB에 닿지 않는 가짜 풀. `failOn`에 든 SQL 문은 거부한다. */
function fakePool(failOn: string[] = []) {
  const release = vi.fn();
  const query = vi.fn(async (text: string) => {
    if (failOn.some((prefix) => text.startsWith(prefix))) throw new Error(`${text} failed`);
    return { rows: [] };
  });
  const pool = { connect: vi.fn(async () => ({ query, release })) } as unknown as Pool;
  return { pool, query, release };
}

const CTX = { authUserId: "auth-1" };

describe("runAsUser 연결 반환", () => {
  it("성공하면 연결을 정상적으로 반환한다", async () => {
    const { pool, release } = fakePool();
    await expect(runAsUser(pool, CTX, async () => "ok")).resolves.toBe("ok");
    expect(release).toHaveBeenCalledWith(false);
  });

  it("작업이 실패해도 롤백이 성공하면 연결은 폐기하지 않는다", async () => {
    const { pool, query, release } = fakePool();
    await expect(
      runAsUser(pool, CTX, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(query).toHaveBeenCalledWith("rollback");
    expect(release).toHaveBeenCalledWith(false);
  });

  it("롤백까지 실패하면 원래 오류를 유지하고 연결을 폐기한다", async () => {
    const { pool, release } = fakePool(["rollback"]);
    await expect(
      runAsUser(pool, CTX, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(release).toHaveBeenCalledWith(true);
  });
});

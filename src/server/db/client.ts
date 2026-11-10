import "server-only";
import { Pool } from "pg";
import { runAsUser, type Tx, type UserContext } from "./with-user";

// 개발 중 HMR로 모듈이 다시 로드돼도 풀이 늘어나지 않도록 globalThis에 둔다.
const globalPools = globalThis as unknown as {
  __savepointAppPool?: Pool;
  __savepointCatalogPool?: Pool;
};

function createPool(envName: "DATABASE_URL" | "DATABASE_URL_CATALOG"): Pool {
  const connectionString = process.env[envName];
  if (!connectionString) throw new Error(`${envName} is not set`);
  return new Pool({ connectionString, max: 5 });
}

/** RLS가 적용되는 `app_user` 풀. 사용자 요청은 항상 `withUser`로만 쓴다. */
export function appPool(): Pool {
  return (globalPools.__savepointAppPool ??= createPool("DATABASE_URL"));
}

/** IGDB 가져오기 전용 `catalog_writer` 풀. 카탈로그 테이블만 쓸 수 있다. */
export function catalogPool(): Pool {
  return (globalPools.__savepointCatalogPool ??= createPool("DATABASE_URL_CATALOG"));
}

export function withUser<T>(ctx: UserContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return runAsUser(appPool(), ctx, (tx) => fn(tx));
}

export type { Tx, UserContext };

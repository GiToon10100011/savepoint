/**
 * 앱 DB 역할을 만들고 연결 문자열을 env 파일에 기록한다. 비밀번호는 출력하지 않는다.
 *
 *   DATABASE_URL_ADMIN=<소유자 직접 연결 URL> npm run db:setup-roles -- .env.local
 *
 * 역할은 SQL로 만든다. 콘솔·CLI로 만든 역할은 neon_superuser(BYPASSRLS) 그룹에 들어가
 * RLS가 무력화되기 때문이다. 여러 번 실행해도 안전하며, 실행할 때마다 비밀번호를 새로 만든다.
 */
import { Client } from "pg";
import { writeSecretEnvFile } from "../../src/server/db/env-file";
import {
  randomPassword,
  toPooledUrl,
  withCredentials,
  withVerifyFull,
} from "../../src/server/db/connection";

type RoleSpec = { name: string; login: boolean; envKey?: string };

const ROLES: RoleSpec[] = [
  { name: "app_user", login: true, envKey: "DATABASE_URL" },
  { name: "catalog_writer", login: true, envKey: "DATABASE_URL_CATALOG" },
  { name: "trigger_owner", login: false },
];

async function ensureRole(client: Client, role: RoleSpec, password?: string) {
  const exists = (await client.query("select 1 from pg_roles where rolname = $1", [role.name]))
    .rowCount;
  if (exists) {
    // 이미 있는 역할은 권한 속성(SUPERUSER·BYPASSRLS 등)을 다시 지정하지 않는다. 같은 값이라도 소유자
    // 역할(superuser 아님)은 ALTER할 수 없어 거부된다. 속성은 만들 때 고정했고 아래 검증이 매번 확인한다.
    if (!password) return;
    const { rows } = await client.query("select format('ALTER ROLE %I PASSWORD %L', $1::text, $2::text) as sql", [
      role.name,
      password,
    ]);
    await client.query(rows[0].sql);
    return;
  }
  const attrs = role.login ? "LOGIN" : "NOLOGIN";
  const base = `CREATE ROLE %I ${attrs} NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`;
  const { rows } = password
    ? await client.query("select format($1 || ' PASSWORD %L', $2::text, $3::text) as sql", [
        base,
        role.name,
        password,
      ])
    : await client.query("select format($1, $2::text) as sql", [base, role.name]);
  await client.query(rows[0].sql);
}

async function main() {
  const envFile = process.argv[2];
  const rawAdminUrl = process.env.DATABASE_URL_ADMIN;
  if (!envFile) throw new Error("사용법: npm run db:setup-roles -- <env 파일>");
  if (!rawAdminUrl) throw new Error("DATABASE_URL_ADMIN(소유자 직접 연결 URL)이 필요하다");
  // 세 연결 문자열 모두 sslmode=verify-full을 명시한다(pg 경고 대응, 현재의 안전한 동작 고정).
  const adminUrl = withVerifyFull(rawAdminUrl);

  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();

  const updates: Record<string, string> = { DATABASE_URL_ADMIN: adminUrl };
  try {
    for (const role of ROLES) {
      const password = role.login ? randomPassword() : undefined;
      await ensureRole(admin, role, password);
      if (password && role.envKey) {
        updates[role.envKey] = toPooledUrl(withCredentials(adminUrl, role.name, password));
      }
      console.log(`role ${role.name}: ok`);
    }

    const { rows } = await admin.query("select format('GRANT CONNECT ON DATABASE %I TO app_user, catalog_writer', current_database()) as sql");
    await admin.query(rows[0].sql);
    await admin.query("GRANT USAGE ON SCHEMA public TO app_user, catalog_writer, trigger_owner");
  } finally {
    await admin.end();
  }

  writeSecretEnvFile(envFile, updates);
  console.log(`wrote ${Object.keys(updates).join(", ")} -> ${envFile}`);

  // 풀링 연결로 실제 접속해 RLS를 우회하지 않는 역할인지 확인한다.
  for (const role of ROLES.filter((r) => r.login)) {
    const client = new Client({ connectionString: updates[role.envKey as string] });
    await client.connect();
    try {
      const { rows } = await client.query(
        "select current_user as who, r.rolbypassrls as bypass, r.rolsuper as super from pg_roles r where r.rolname = current_user",
      );
      const { who, bypass, super: isSuper } = rows[0];
      console.log(`verify ${who}: bypassrls=${bypass} superuser=${isSuper}`);
      if (bypass || isSuper) throw new Error(`${who} must not bypass RLS`);
    } finally {
      await client.end();
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

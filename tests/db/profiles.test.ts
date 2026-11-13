import { randomUUID } from "node:crypto";
import { getTableColumns } from "drizzle-orm";
import { Client, Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createProfileIfAbsent, ensureProfile } from "@/features/profiles/ensure-profile";
import { withVerifyFull } from "@/server/db/connection";
import { profiles } from "@/server/db/schema";
import { runAsUser } from "@/server/db/with-user";

// 앱과 같은 방식으로 접속한다: RLS가 적용되는 app_user, 풀링 연결. 동시성 테스트를 위해 연결을 여럿 둔다.
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 8 });
const catalogPool = new Pool({ connectionString: process.env.DATABASE_URL_CATALOG, max: 1 });
// 정리·검증 전용 소유자 연결. app_user에는 DELETE 권한이 없고, 남의 행 변화를 RLS 없이 확인해야 한다.
const admin = new Client({ connectionString: withVerifyFull(process.env.DATABASE_URL_ADMIN as string) });

const RUN = randomUUID().slice(0, 8);
const LIKE = "test-profiles-%";
const authId = (name: string) => `test-profiles-${RUN}-${name}`;
let seq = 0;
const handle = () => `t${RUN}_${(seq++).toString(36)}`; // 소문자·숫자·_ 만, 20자 이하

type Row = { authUserId: string; handle?: string; nickname?: string; bio?: string | null; avatarUrl?: string | null };

/** `sessionAuthId`의 세션으로 프로필 한 줄을 INSERT한다. 원시 SQL이라 DB가 내는 오류 코드를 그대로 볼 수 있다. */
function insertProfile(sessionAuthId: string, row: Row) {
  return runAsUser(pool, { authUserId: sessionAuthId }, (_tx, client) =>
    client.query<{ id: string; handle: string }>(
      "insert into profiles (auth_user_id, handle, nickname, bio, avatar_url) values ($1, $2, $3, $4, $5) returning id, handle",
      [row.authUserId, row.handle ?? handle(), row.nickname ?? "테스터", row.bio ?? null, row.avatarUrl ?? null],
    ),
  );
}

async function createProfile(name: string, handleValue?: string) {
  const authUserId = authId(name);
  const { rows } = await insertProfile(authUserId, { authUserId, handle: handleValue });
  return { authUserId, id: rows[0].id, handle: rows[0].handle };
}

const asUser = <T>(who: { authUserId: string; id: string }, run: (client: PoolClient) => Promise<T>) =>
  runAsUser(pool, { authUserId: who.authUserId, profileId: who.id }, (_tx, client) => run(client));

const adminRow = async (id: string) =>
  (await admin.query("select * from profiles where id = $1", [id])).rows[0] as Record<string, unknown> | undefined;

beforeAll(async () => {
  await admin.connect();
  await admin.query("delete from profiles where auth_user_id like $1", [LIKE]);
});

afterAll(async () => {
  await admin.query("delete from profiles where auth_user_id like $1", [LIKE]);
  await admin.end();
  await pool.end();
  await catalogPool.end();
});

describe("RLS: 생성", () => {
  it("세션의 사용자 본인 프로필은 만들 수 있다", async () => {
    const me = await createProfile("create-own");
    expect((await adminRow(me.id))?.auth_user_id).toBe(me.authUserId);
  });

  it("세션과 다른 auth_user_id로는 만들 수 없다", async () => {
    await expect(insertProfile(authId("mallory"), { authUserId: authId("victim") })).rejects.toMatchObject({
      code: "42501", // row-level security 위반
    });
  });

  it("세션 컨텍스트 없이는 만들 수 없다", async () => {
    await expect(
      pool.query("insert into profiles (auth_user_id, handle, nickname) values ($1, $2, '무맥락')", [
        authId("no-context"),
        handle(),
      ]),
    ).rejects.toMatchObject({ code: "42501" });
  });
});

describe("RLS: 조회·수정·삭제", () => {
  it("프로필은 누구나 읽을 수 있다(공개 정보)", async () => {
    const a = await createProfile("read-a");
    const b = await createProfile("read-b");
    const { rows } = await asUser(a, (client) => client.query("select id from profiles where id = $1", [b.id]));
    expect(rows).toHaveLength(1);
  });

  it("본인 프로필은 수정할 수 있고 updated_at이 갱신된다", async () => {
    const me = await createProfile("update-own");
    const before = (await adminRow(me.id)) as { created_at: Date; updated_at: Date };
    const result = await asUser(me, (client) =>
      client.query("update profiles set nickname = '바뀐 이름' where id = $1", [me.id]),
    );
    expect(result.rowCount).toBe(1);
    const after = (await adminRow(me.id)) as { nickname: string; updated_at: Date };
    expect(after.nickname).toBe("바뀐 이름");
    expect(after.updated_at.getTime()).toBeGreaterThan(before.updated_at.getTime());
  });

  it("남의 프로필은 수정할 수 없다(0행)", async () => {
    const a = await createProfile("steal-a");
    const b = await createProfile("steal-b");
    const result = await asUser(a, (client) =>
      client.query("update profiles set nickname = '해킹' where id = $1", [b.id]),
    );
    expect(result.rowCount).toBe(0);
    expect((await adminRow(b.id))?.nickname).toBe("테스터");
  });

  it("프로필 ID가 없는 컨텍스트(첫 로그인)로는 아무 프로필도 수정할 수 없다", async () => {
    const target = await createProfile("no-profile-id");
    const result = await runAsUser(pool, { authUserId: authId("first-login") }, (_tx, client) =>
      client.query("update profiles set nickname = '무맥락' where id = $1", [target.id]),
    );
    expect(result.rowCount).toBe(0);
  });

  it.each(["id", "auth_user_id", "created_at"])("%s는 본인도 바꿀 수 없다(컬럼 권한)", async (column) => {
    const me = await createProfile(`immutable-${column}`);
    const value = column === "id" ? randomUUID() : column === "created_at" ? new Date(0).toISOString() : "other-auth-id";
    await expect(
      asUser(me, (client) => client.query(`update profiles set ${column} = $1 where id = $2`, [value, me.id])),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("삭제할 수 없다", async () => {
    const me = await createProfile("delete");
    await expect(asUser(me, (client) => client.query("delete from profiles where id = $1", [me.id]))).rejects.toMatchObject({
      code: "42501",
    });
    expect(await adminRow(me.id)).toBeDefined();
  });

  it("IGDB 가져오기용 catalog_writer 역할은 프로필에 접근할 수 없다", async () => {
    await expect(catalogPool.query("select id from profiles limit 1")).rejects.toMatchObject({ code: "42501" });
  });
});

describe("제약", () => {
  const insertWith = (name: string, extra: Partial<Row>) => {
    const authUserId = authId(name);
    return insertProfile(authUserId, { authUserId, ...extra });
  };

  it.each([
    ["대문자", "Upper_case1"],
    ["너무 짧음", "ab"],
    ["너무 김", "a".repeat(21)],
    ["공백", "has space"],
    ["한글", "한글핸들"],
    ["하이픈", "dash-name"],
  ])("형식이 틀린 핸들은 거절한다: %s", async (_name, bad) => {
    await expect(insertWith("bad-handle", { handle: bad })).rejects.toMatchObject({
      code: "23514",
      constraint: "profiles_handle_format",
    });
  });

  it("같은 핸들은 두 번 쓸 수 없다", async () => {
    const taken = handle();
    await insertWith("dup-1", { handle: taken });
    await expect(insertWith("dup-2", { handle: taken })).rejects.toMatchObject({
      code: "23505",
      constraint: "profiles_handle_unique",
    });
  });

  it("같은 Neon Auth 사용자의 프로필은 하나뿐이다", async () => {
    await insertWith("one-per-user", {});
    await expect(insertWith("one-per-user", {})).rejects.toMatchObject({
      code: "23505",
      constraint: "profiles_auth_user_id_unique",
    });
  });

  it("닉네임은 1–20자이고 이모지도 한 글자로 센다", async () => {
    await expect(insertWith("nick-empty", { nickname: "" })).rejects.toMatchObject({ constraint: "profiles_nickname_length" });
    await expect(insertWith("nick-long", { nickname: "가".repeat(21) })).rejects.toMatchObject({
      constraint: "profiles_nickname_length",
    });
    await expect(insertWith("nick-ok", { nickname: "😀".repeat(20) })).resolves.toBeDefined();
  });

  it("소개는 200자까지다", async () => {
    await expect(insertWith("bio-long", { bio: "가".repeat(201) })).rejects.toMatchObject({ constraint: "profiles_bio_length" });
    await expect(insertWith("bio-ok", { bio: "가".repeat(200) })).resolves.toBeDefined();
  });

  it("아바타 URL은 https만 받는다", async () => {
    for (const bad of ["http://example.com/a.png", "javascript:alert(1)", "//example.com/a.png"]) {
      await expect(insertWith("avatar-bad", { avatarUrl: bad })).rejects.toMatchObject({
        constraint: "profiles_avatar_url_https",
      });
    }
    await expect(insertWith("avatar-ok", { avatarUrl: "https://example.com/a.png" })).resolves.toBeDefined();
  });
});

describe("ensureProfile (첫 세션에서 프로필 만들기)", () => {
  it("프로필이 없으면 만들고 가입 이름으로 닉네임을 정한다", async () => {
    const profile = await ensureProfile(pool, { authUserId: authId("ensure-new"), name: "  김   게이머 " });
    expect(profile.authUserId).toBe(authId("ensure-new"));
    expect(profile.nickname).toBe("김 게이머");
    expect(profile.handle).toMatch(/^user_[0-9a-f]{8}$/);
  });

  it("이름이 없으면 기본 닉네임을 쓴다", async () => {
    const profile = await ensureProfile(pool, { authUserId: authId("ensure-noname"), name: null });
    expect(profile.nickname).toBe("플레이어");
  });

  it("이미 있으면 새로 만들지 않고 같은 프로필을 돌려준다", async () => {
    const first = await ensureProfile(pool, { authUserId: authId("ensure-twice"), name: "처음" });
    const second = await ensureProfile(pool, { authUserId: authId("ensure-twice"), name: "다른 이름" });
    expect(second.id).toBe(first.id);
    expect(second.nickname).toBe("처음"); // 기존 값을 덮어쓰지 않는다
    const { rows } = await admin.query("select count(*)::int as n from profiles where auth_user_id = $1", [authId("ensure-twice")]);
    expect(rows[0].n).toBe(1);
  });

  it("확인과 생성 사이에 다른 요청이 먼저 만들었으면 오류 없이 그 프로필을 쓴다", async () => {
    // 조회는 "없음"을 봤지만 INSERT 전에 같은 사용자의 다른 요청이 커밋한 상황을 직접 만든다(타이밍에 기대지 않는다).
    const winner = await createProfile("ensure-interleave");
    const profile = await createProfileIfAbsent(pool, { authUserId: winner.authUserId, name: "늦은 요청" });
    expect(profile.id).toBe(winner.id);
    const { rows } = await admin.query("select count(*)::int as n from profiles where auth_user_id = $1", [winner.authUserId]);
    expect(rows[0].n).toBe(1);
  });

  it("같은 사용자의 요청을 동시에 여럿 보내도 프로필은 하나만 생긴다(부하 확인)", async () => {
    const identity = { authUserId: authId("ensure-race"), name: "경쟁" };
    const results = await Promise.all(Array.from({ length: 8 }, () => ensureProfile(pool, identity)));
    expect(new Set(results.map((p) => p.id)).size).toBe(1);
    const { rows } = await admin.query("select count(*)::int as n from profiles where auth_user_id = $1", [identity.authUserId]);
    expect(rows[0].n).toBe(1);
  });

  it("핸들이 이미 쓰이고 있으면 새 핸들로 다시 시도한다", async () => {
    const taken = handle();
    await createProfile("collide-existing", taken);
    const fresh = handle();
    const queue = [taken, fresh];
    const profile = await ensureProfile(pool, { authUserId: authId("collide-new") }, () => queue.shift() as string);
    expect(profile.handle).toBe(fresh);
  });

  it("핸들 충돌이 계속되면 오류로 끝난다(무한 반복하지 않는다)", async () => {
    const taken = handle();
    await createProfile("collide-always", taken);
    await expect(ensureProfile(pool, { authUserId: authId("collide-fail") }, () => taken)).rejects.toThrow(
      "프로필을 만들지 못했다",
    );
    expect((await admin.query("select 1 from profiles where auth_user_id = $1", [authId("collide-fail")])).rowCount).toBe(0);
  });
});

describe("스키마 일치", () => {
  it("drizzle 정의의 컬럼과 null 허용 여부가 실제 테이블과 같다", async () => {
    const { rows } = await admin.query(
      "select column_name, is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'profiles'",
    );
    const fromDb = rows.map((r) => `${r.column_name}:${r.is_nullable === "YES" ? "null" : "not null"}`).sort();
    const fromSchema = Object.values(getTableColumns(profiles))
      .map((c) => `${c.name}:${c.notNull ? "not null" : "null"}`)
      .sort();
    expect(fromSchema).toEqual(fromDb);
  });
});

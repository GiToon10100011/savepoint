import { randomUUID } from "node:crypto";
import { getTableColumns } from "drizzle-orm";
import { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withVerifyFull } from "@/server/db/connection";
import { gameRatings } from "@/server/db/schema";
import { runAsUser } from "@/server/db/with-user";

// 앱과 같은 방식으로 접속한다: RLS가 적용되는 app_user, 풀링 연결. 동시 평가 시험을 위해 연결을 여럿 둔다.
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 8 });
// 정리·검증 전용 소유자 연결(RLS 없이 실제 행과 카운터를 확인한다).
const admin = new Client({ connectionString: withVerifyFull(process.env.DATABASE_URL_ADMIN as string) });

const RUN = randomUUID().slice(0, 8);
const PREFIX = `rt-${RUN}-`;
let seq = 0;
const next = () => (seq++).toString(36);

/** mulberry32. `Math.imul`로 32비트 곱셈이 정확해서 하위 비트까지 고르게 섞인다(큰 수를 `*`로 곱하는 LCG는 하위 비트를 잃는다). */
function seeded(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type User = { authUserId: string; profileId: string };

async function makeUser(): Promise<User> {
  const authUserId = `${PREFIX}${next()}`;
  const { rows } = await admin.query("insert into profiles (auth_user_id, handle, nickname) values ($1, $2, '평가자') returning id", [
    authUserId,
    `r${RUN}${next()}`,
  ]);
  return { authUserId, profileId: rows[0].id };
}

async function makeGame(): Promise<string> {
  const { rows } = await admin.query("insert into games (source, slug, title) values ('manual', $1, $2) returning id", [`${PREFIX}g${next()}`, `Rated ${RUN} ${next()}`]);
  return rows[0].id;
}

/** 그 사용자의 세션으로 평가한다(없으면 만들고 있으면 바꾼다). 앱이 쓸 upsert와 같은 모양이다. */
const rate = (user: User, gameId: string, rating: number) =>
  runAsUser(pool, user, (_tx, client) =>
    client.query(
      `insert into game_ratings (user_id, game_id, rating) values ($1, $2, $3)
       on conflict (user_id, game_id) do update set rating = excluded.rating`,
      [user.profileId, gameId, rating],
    ),
  );

const unrate = (user: User, gameId: string) =>
  runAsUser(pool, user, (_tx, client) => client.query("delete from game_ratings where user_id = $1 and game_id = $2", [user.profileId, gameId]));

const counters = async (gameId: string) => (await admin.query("select rating_count, rating_sum from games where id = $1", [gameId])).rows[0] as { rating_count: number; rating_sum: number };

/** 카운터가 실제 평가 행의 합계와 같은지 소유자 권한으로 다시 센다. */
const recount = async (gameId: string) =>
  (await admin.query("select count(*)::int as rating_count, coalesce(sum(rating), 0)::int as rating_sum from game_ratings where game_id = $1", [gameId])).rows[0] as { rating_count: number; rating_sum: number };

beforeAll(async () => {
  await admin.connect();
});

afterAll(async () => {
  // 게임·프로필을 지우면 평가는 함께 지워진다(ON DELETE CASCADE).
  await admin.query("delete from games where slug like $1", [`${PREFIX}%`]);
  await admin.query("delete from profiles where auth_user_id like $1", [`${PREFIX}%`]);
  await admin.end();
  await pool.end();
});

describe("스키마", () => {
  it("Drizzle 정의의 컬럼이 실제 테이블과 같다(어긋남 감지)", async () => {
    const { rows } = await admin.query("select column_name from information_schema.columns where table_schema = 'public' and table_name = 'game_ratings'");
    const actual = rows.map((r) => r.column_name).sort();
    const declared = Object.values(getTableColumns(gameRatings)).map((c) => c.name).sort();
    expect(declared).toEqual(actual);
  });

  it("평점은 1–10 정수만 받는다(0·11·NULL은 거절)", async () => {
    const [user, game] = [await makeUser(), await makeGame()];
    for (const bad of [0, 11, -1]) {
      await expect(rate(user, game, bad)).rejects.toMatchObject({ code: "23514", constraint: "game_ratings_rating_range" });
    }
    await expect(runAsUser(pool, user, (_t, c) => c.query("insert into game_ratings (user_id, game_id, rating) values ($1, $2, null)", [user.profileId, game]))).rejects.toMatchObject({
      code: "23502",
    });
    expect(await recount(game)).toEqual({ rating_count: 0, rating_sum: 0 });
  });

  it("없는 게임에는 평가할 수 없다(FK)", async () => {
    const user = await makeUser();
    await expect(rate(user, randomUUID(), 6)).rejects.toMatchObject({ code: "23503" });
  });

  it("같은 사용자가 같은 게임에 평가를 두 개 만들 수 없다(PK). upsert는 값을 바꾼다", async () => {
    const [user, game] = [await makeUser(), await makeGame()];
    await rate(user, game, 4);
    await expect(
      runAsUser(pool, user, (_t, c) => c.query("insert into game_ratings (user_id, game_id, rating) values ($1, $2, 8)", [user.profileId, game])),
    ).rejects.toMatchObject({ code: "23505" });
    await rate(user, game, 9);
    const { rows } = await admin.query("select rating from game_ratings where user_id = $1 and game_id = $2", [user.profileId, game]);
    expect(rows).toEqual([{ rating: 9 }]);
  });
});

describe("RLS와 컬럼 권한", () => {
  it("다른 사용자의 이름으로 평가를 만들 수 없다", async () => {
    const [alice, bob, game] = [await makeUser(), await makeUser(), await makeGame()];
    await expect(
      runAsUser(pool, alice, (_t, c) => c.query("insert into game_ratings (user_id, game_id, rating) values ($1, $2, 10)", [bob.profileId, game])),
    ).rejects.toMatchObject({ code: "42501" });
    // upsert로 남의 평가를 덮어쓰려는 시도도 막힌다.
    await rate(bob, game, 3);
    await expect(
      runAsUser(pool, alice, (_t, c) =>
        c.query(
          "insert into game_ratings (user_id, game_id, rating) values ($1, $2, 10) on conflict (user_id, game_id) do update set rating = excluded.rating",
          [bob.profileId, game],
        ),
      ),
    ).rejects.toMatchObject({ code: "42501" });
    expect((await admin.query("select rating from game_ratings where user_id = $1", [bob.profileId])).rows).toEqual([{ rating: 3 }]);
  });

  it("다른 사용자의 평가는 고치거나 지울 수 없다(0행)", async () => {
    const [alice, bob, game] = [await makeUser(), await makeUser(), await makeGame()];
    await rate(bob, game, 3);
    const updated = await runAsUser(pool, alice, (_t, c) => c.query("update game_ratings set rating = 10 where user_id = $1 and game_id = $2", [bob.profileId, game]));
    const deleted = await runAsUser(pool, alice, (_t, c) => c.query("delete from game_ratings where user_id = $1 and game_id = $2", [bob.profileId, game]));
    expect([updated.rowCount, deleted.rowCount]).toEqual([0, 0]);
    expect(await counters(game)).toEqual({ rating_count: 1, rating_sum: 3 });
  });

  it("평가의 소유자·게임·시각은 본인도 바꿀 수 없다(컬럼 권한)", async () => {
    const [alice, bob, game] = [await makeUser(), await makeUser(), await makeGame()];
    await rate(alice, game, 5);
    for (const column of ["user_id", "game_id", "created_at"]) {
      const value = column === "user_id" ? bob.profileId : column === "game_id" ? await makeGame() : new Date().toISOString();
      // 컬럼 권한(`permission denied`)과 RLS 정책(`violates row-level security policy`)은 같은 오류 코드(42501)라서
      // 메시지까지 봐야 컬럼 권한이 실제로 막고 있는지 알 수 있다. 정책만 믿으면 권한이 새도 시험이 통과한다.
      await expect(
        runAsUser(pool, alice, (_t, c) => c.query(`update game_ratings set ${column} = $1 where user_id = $2 and game_id = $3`, [value, alice.profileId, game])),
        column,
      ).rejects.toMatchObject({ code: "42501", message: expect.stringMatching(/^permission denied/) });
    }
  });

  it("누구나 평가를 읽을 수 있고, 세션이 없으면 쓸 수 없다", async () => {
    const [alice, bob, game] = [await makeUser(), await makeUser(), await makeGame()];
    await rate(alice, game, 7);
    const seen = await runAsUser(pool, bob, (_t, c) => c.query("select rating from game_ratings where game_id = $1", [game]));
    expect(seen.rows).toEqual([{ rating: 7 }]);
    // 프로필 없이 세션만 있는 상태(첫 로그인 직후): app_me()가 NULL이라 어떤 평가도 쓸 수 없다.
    await expect(
      runAsUser(pool, { authUserId: `${PREFIX}ghost` }, (_t, c) => c.query("insert into game_ratings (user_id, game_id, rating) values ($1, $2, 5)", [alice.profileId, game])),
    ).rejects.toMatchObject({ code: "42501" });
  });
});

describe("평균 평점 카운터", () => {
  it("평가·수정·취소에 따라 개수와 합이 움직이고, 취소하면 원복된다", async () => {
    const [alice, bob, game] = [await makeUser(), await makeUser(), await makeGame()];
    expect(await counters(game)).toEqual({ rating_count: 0, rating_sum: 0 });

    await rate(alice, game, 7);
    expect(await counters(game)).toEqual({ rating_count: 1, rating_sum: 7 });
    await rate(bob, game, 4);
    expect(await counters(game)).toEqual({ rating_count: 2, rating_sum: 11 });

    await rate(alice, game, 10); // 수정: 개수는 그대로, 합만 +3
    expect(await counters(game)).toEqual({ rating_count: 2, rating_sum: 14 });
    await rate(alice, game, 10); // 같은 값으로 다시 저장해도 변하지 않는다
    expect(await counters(game)).toEqual({ rating_count: 2, rating_sum: 14 });

    await unrate(alice, game);
    expect(await counters(game)).toEqual({ rating_count: 1, rating_sum: 4 });
    await unrate(bob, game);
    expect(await counters(game)).toEqual({ rating_count: 0, rating_sum: 0 }); // 완전히 원복
  });

  it("지울 평가가 없으면 아무것도 바뀌지 않는다", async () => {
    const [alice, game] = [await makeUser(), await makeGame()];
    const result = await unrate(alice, game);
    expect(result.rowCount).toBe(0);
    expect(await counters(game)).toEqual({ rating_count: 0, rating_sum: 0 });
  });

  it("무작위로 평가·수정·취소를 섞어도 카운터는 항상 실제 평가의 합계와 같다", { timeout: 90_000 }, async () => {
    const users = await Promise.all(Array.from({ length: 5 }, makeUser));
    const games = await Promise.all(Array.from({ length: 3 }, makeGame));
    const random = seeded(20261114); // 재현 가능한 의사 난수
    // 시험 안에서 따로 계산하는 기대값(사용자·게임 → 현재 별점). DB의 카운터와도, DB를 다시 센 값과도 맞대어 본다.
    const model = new Map<string, number>();
    const done = { created: 0, changed: 0, deleted: 0 };

    for (let i = 0; i < 50; i += 1) {
      const user = users[Math.floor(random() * users.length)];
      const game = games[Math.floor(random() * games.length)];
      const key = `${user.profileId}|${game}`;
      if (random() < 0.25) {
        await unrate(user, game);
        if (model.delete(key)) done.deleted += 1;
      } else {
        const rating = 1 + Math.floor(random() * 10);
        const before = model.get(key);
        await rate(user, game, rating);
        model.set(key, rating);
        if (before === undefined) done.created += 1;
        else if (before !== rating) done.changed += 1;
      }
    }

    // 한 가지 연산만 우연히 나오는 시험이 되지 않도록, 만들기·값 바꾸기·취소가 실제로 여러 번 일어났는지 확인한다.
    expect(done.created).toBeGreaterThanOrEqual(10);
    expect(done.changed).toBeGreaterThanOrEqual(10);
    expect(done.deleted).toBeGreaterThanOrEqual(3);

    for (const game of games) {
      const mine = [...model].filter(([key]) => key.endsWith(`|${game}`)).map(([, rating]) => rating);
      const expected = { rating_count: mine.length, rating_sum: mine.reduce((sum, rating) => sum + rating, 0) };
      expect(await counters(game)).toEqual(expected);
      expect(await recount(game)).toEqual(expected);
    }
  });

  it("같은 게임에 동시에 평가해도 카운터가 틀어지지 않는다", async () => {
    const game = await makeGame();
    const users = await Promise.all(Array.from({ length: 16 }, makeUser));
    await Promise.all(users.map((u, i) => rate(u, game, (i % 10) + 1)));
    expect(await counters(game)).toEqual(await recount(game));
    expect((await counters(game)).rating_count).toBe(16);

    // 절반은 수정, 나머지 절반은 취소를 동시에.
    await Promise.all(users.map((u, i) => (i % 2 === 0 ? rate(u, game, 10) : unrate(u, game))));
    expect(await counters(game)).toEqual(await recount(game));
    expect((await counters(game)).rating_count).toBe(8);
  });

  it("평가를 한 프로필이 사라지면 그 평가도 카운터에서 빠진다(cascade)", async () => {
    const [alice, bob, game] = [await makeUser(), await makeUser(), await makeGame()];
    await rate(alice, game, 8);
    await rate(bob, game, 2);
    await admin.query("delete from profiles where id = $1", [alice.profileId]);
    expect(await counters(game)).toEqual({ rating_count: 1, rating_sum: 2 });
  });

  it("평가가 달린 게임을 지워도 오류 없이 지워진다(cascade)", async () => {
    const [alice, game] = [await makeUser(), await makeGame()];
    await rate(alice, game, 6);
    await expect(admin.query("delete from games where id = $1", [game])).resolves.toMatchObject({ rowCount: 1 });
    expect((await admin.query("select 1 from game_ratings where game_id = $1", [game])).rowCount).toBe(0);
  });

  it("평가는 게임의 updated_at을 건드리지 않는다(게임 정보가 바뀐 것이 아니다)", async () => {
    const [alice, game] = [await makeUser(), await makeGame()];
    const before = (await admin.query("select updated_at from games where id = $1", [game])).rows[0].updated_at;
    await rate(alice, game, 5);
    await unrate(alice, game);
    const after = (await admin.query("select updated_at from games where id = $1", [game])).rows[0].updated_at;
    expect(after).toEqual(before);
  });
});

describe("권한이 좁게 유지된다", () => {
  it("앱 역할은 카운터를 직접 고칠 수 없다", async () => {
    const [alice, game] = [await makeUser(), await makeGame()];
    for (const sql of ["update games set rating_count = 99 where id = $1", "update games set rating_sum = 99 where id = $1"]) {
      await expect(runAsUser(pool, alice, (_t, c) => c.query(sql, [game]))).rejects.toMatchObject({ code: "42501" });
    }
  });

  it("카운터 함수는 앱 역할이 부를 수 없다", async () => {
    const alice = await makeUser();
    await expect(runAsUser(pool, alice, (_t, c) => c.query("select apply_rating_counters()"))).rejects.toMatchObject({ code: "42501" });
  });

  it("함수 소유자 trigger_owner는 평가 카운터만 바꿀 수 있고, 스키마에 객체를 만들거나 직접 쓸 수 없다", async () => {
    const q = async (sql: string) => (await admin.query(sql)).rows[0];
    expect(await q("select pg_get_userbyid(proowner) as owner, prosecdef as secdef, proconfig as config from pg_proc where proname = 'apply_rating_counters'")).toEqual({
      owner: "trigger_owner",
      secdef: true,
      config: ["search_path=public, pg_temp"],
    });
    expect(await q("select has_column_privilege('trigger_owner', 'games', 'rating_count', 'UPDATE') as a, has_column_privilege('trigger_owner', 'games', 'rating_sum', 'UPDATE') as b")).toEqual({ a: true, b: true });
    // 카운터 말고는 어떤 게임 컬럼도 바꿀 수 없다.
    for (const column of ["title", "slug", "source", "summary", "created_by"]) {
      expect((await q(`select has_column_privilege('trigger_owner', 'games', '${column}', 'UPDATE') as ok`)).ok, column).toBe(false);
    }
    expect((await q("select has_schema_privilege('trigger_owner', 'public', 'CREATE') as ok")).ok).toBe(false);
    expect((await q("select has_table_privilege('trigger_owner', 'game_ratings', 'INSERT') as ok")).ok).toBe(false);
    // 마이그레이션을 실행한 역할도 그 역할로 전환(SET ROLE)할 수는 없다. 상속된 소유권만 가진다.
    await expect(admin.query("set role trigger_owner")).rejects.toMatchObject({ code: "42501" });
  });
});

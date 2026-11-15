import { randomUUID } from "node:crypto";
import { getTableColumns } from "drizzle-orm";
import { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withVerifyFull } from "@/server/db/connection";
import { userGameNotes, userGames } from "@/server/db/schema";
import { runAsUser } from "@/server/db/with-user";

// 앱과 같은 방식으로 접속한다: RLS가 적용되는 app_user, 풀링 연결. 동시 등록 시험을 위해 연결을 여럿 둔다.
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 8 });
// 정리·검증 전용 소유자 연결(RLS 없이 실제 행을 확인한다).
const admin = new Client({ connectionString: withVerifyFull(process.env.DATABASE_URL_ADMIN as string) });

const RUN = randomUUID().slice(0, 8);
const PREFIX = `lb-${RUN}-`;
let seq = 0;
const next = () => (seq++).toString(36);

type User = { authUserId: string; profileId: string };

async function makeUser(): Promise<User> {
  const authUserId = `${PREFIX}${next()}`;
  const { rows } = await admin.query("insert into profiles (auth_user_id, handle, nickname) values ($1, $2, '플레이어') returning id", [authUserId, `l${RUN}${next()}`]);
  return { authUserId, profileId: rows[0].id };
}

async function makeGame(): Promise<string> {
  const { rows } = await admin.query("insert into games (source, slug, title) values ('manual', $1, $2) returning id", [`${PREFIX}g${next()}`, `Library ${RUN} ${next()}`]);
  return rows[0].id;
}

type Fields = Partial<{
  status: string | null;
  platform_id: number | null;
  started_on: string | null;
  cleared_on: string | null;
  perfected_on: string | null;
  playtime_minutes: number | null;
  progress_percent: number | null;
  progress_text: string | null;
}>;

/** 그 사용자의 세션으로 라이브러리에 등록한다. 컬럼 이름이 곧 INSERT 목록이라 앱이 쓰는 것과 같은 권한 경로를 지난다. */
function add(user: User, gameId: string, fields: Fields = {}) {
  const columns = ["user_id", "game_id", ...Object.keys(fields)];
  const values = [user.profileId, gameId, ...Object.values(fields)];
  return runAsUser(pool, user, (_t, c) =>
    c.query<{ id: string }>(`insert into user_games (${columns.join(", ")}) values (${values.map((_, i) => `$${i + 1}`).join(", ")}) returning id`, values),
  );
}

/** 그 사용자의 세션으로 항목을 고친다. */
function update(user: User, gameId: string, set: Record<string, unknown>) {
  const names = Object.keys(set);
  return runAsUser(pool, user, (_t, c) =>
    c.query(`update user_games set ${names.map((n, i) => `${n} = $${i + 1}`).join(", ")} where user_id = $${names.length + 1} and game_id = $${names.length + 2}`, [...Object.values(set), user.profileId, gameId]),
  );
}

const entry = async (user: User, gameId: string) =>
  (await admin.query("select *, to_char(last_played_on, 'YYYY-MM-DD') as played from user_games where user_id = $1 and game_id = $2", [user.profileId, gameId])).rows[0];

/** 서비스의 기준 날짜(Asia/Seoul)를 DB에서 읽는다. */
const seoulToday = async () => (await admin.query("select to_char((now() at time zone 'Asia/Seoul')::date, 'YYYY-MM-DD') as d")).rows[0].d as string;

beforeAll(async () => {
  await admin.connect();
});

afterAll(async () => {
  await admin.query("delete from games where slug like $1", [`${PREFIX}%`]);
  await admin.query("delete from profiles where auth_user_id like $1", [`${PREFIX}%`]);
  await admin.query("delete from platforms where slug like $1", [`${PREFIX}%`]);
  await admin.end();
  await pool.end();
});

describe("스키마와 제약", () => {
  it("Drizzle 정의의 컬럼이 실제 테이블과 같다(어긋남 감지)", async () => {
    for (const [table, def] of [["user_games", userGames], ["user_game_notes", userGameNotes]] as const) {
      const { rows } = await admin.query("select column_name from information_schema.columns where table_schema = 'public' and table_name = $1", [table]);
      expect(Object.values(getTableColumns(def)).map((c) => c.name).sort(), table).toEqual(rows.map((r) => r.column_name).sort());
    }
  });

  it("같은 게임을 두 번 등록할 수 없다", async () => {
    const [user, game] = [await makeUser(), await makeGame()];
    await add(user, game);
    await expect(add(user, game)).rejects.toMatchObject({ code: "23505", constraint: "user_games_user_game_unique" });
  });

  it("같은 사용자가 동시에 여러 번 등록해도 한 행이다", async () => {
    const [user, game] = [await makeUser(), await makeGame()];
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => add(user, game)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const r of results.filter((x): x is PromiseRejectedResult => x.status === "rejected")) expect(r.reason).toMatchObject({ code: "23505" });
    expect((await admin.query("select 1 from user_games where user_id = $1 and game_id = $2", [user.profileId, game])).rowCount).toBe(1);
  });

  it("상태를 지정하지 않고 등록할 수 있고(NULL), 7가지 상태를 어떤 순서로든 바꿀 수 있다", async () => {
    const [user, game] = [await makeUser(), await makeGame()];
    await add(user, game);
    expect((await entry(user, game)).status).toBeNull();
    // 전환 순서를 강제하지 않는다: 플레이 예정 → 엔딩 완료도, 엔딩 완료 → 관심 있음도 된다.
    for (const status of ["planned", "cleared", "interested", "perfected", "dropped", "paused", "playing", null]) {
      await update(user, game, { status });
      expect((await entry(user, game)).status).toBe(status);
    }
  });

  it("목록에 없는 상태 값은 거절한다", async () => {
    const [user, game] = [await makeUser(), await makeGame()];
    await expect(add(user, game, { status: "finished" })).rejects.toMatchObject({ code: "22P02" });
  });

  it.each([
    ["진행도 퍼센트 음수", { progress_percent: -1 }, "user_games_progress_percent_range"],
    ["진행도 퍼센트 101", { progress_percent: 101 }, "user_games_progress_percent_range"],
    ["빈 진행도 텍스트", { progress_text: "" }, "user_games_progress_text_length"],
    ["101자 진행도 텍스트", { progress_text: "가".repeat(101) }, "user_games_progress_text_length"],
    ["음수 플레이 시간", { playtime_minutes: -1 }, "user_games_playtime_range"],
    ["너무 긴 플레이 시간", { playtime_minutes: 1_000_001 }, "user_games_playtime_range"],
    ["1970년 이전 시작일", { started_on: "1969-12-31" }, "user_games_dates_range"],
    ["2100년 이후 엔딩일", { cleared_on: "2101-01-01" }, "user_games_dates_range"],
    ["엔딩일이 시작일보다 앞", { started_on: "2026-05-10", cleared_on: "2026-05-09" }, "user_games_cleared_after_started"],
  ])("범위를 벗어난 값은 거절한다: %s", async (_name, fields, constraint) => {
    // 다른 날짜 컬럼이 NULL이어도(NULL AND FALSE = FALSE) 범위를 벗어난 값은 막힌다.
    const [user, game] = [await makeUser(), await makeGame()];
    await expect(add(user, game, fields)).rejects.toMatchObject({ code: "23514", constraint });
  });

  it("경계값은 받아들인다(0%·100%, 0분, 시작일과 같은 날의 엔딩, 시작일 없는 엔딩)", async () => {
    const [user, game] = [await makeUser(), await makeGame()];
    await add(user, game, { progress_percent: 0, playtime_minutes: 0, started_on: "2026-05-10", cleared_on: "2026-05-10", progress_text: "가".repeat(100) });
    await update(user, game, { progress_percent: 100, started_on: null, cleared_on: "2026-05-01", perfected_on: "1970-01-01" });
    expect(await entry(user, game)).toMatchObject({ progress_percent: 100 });
  });

  it("없는 플랫폼은 거절하고, 플랫폼이 지워지면 NULL로 돌아간다", async () => {
    const [user, game] = [await makeUser(), await makeGame()];
    await expect(add(user, game, { platform_id: 2_000_000_000 })).rejects.toMatchObject({ code: "23503" });
    const platform = (await admin.query("insert into platforms (slug, name) values ($1, $2) returning id", [`${PREFIX}p${next()}`, "임시 플랫폼"])).rows[0].id as number;
    await add(user, game, { platform_id: platform });
    await admin.query("delete from platforms where id = $1", [platform]);
    expect((await entry(user, game)).platform_id).toBeNull();
  });

  it("게임이나 프로필이 지워지면 라이브러리 항목도 함께 지워진다(cascade)", async () => {
    const [alice, bob, game] = [await makeUser(), await makeUser(), await makeGame()];
    await add(alice, game);
    await add(bob, game);
    await admin.query("delete from profiles where id = $1", [alice.profileId]);
    expect(await entry(alice, game)).toBeUndefined();
    await admin.query("delete from games where id = $1", [game]);
    expect(await entry(bob, game)).toBeUndefined();
  });
});

describe("평가·리뷰와 독립이다", () => {
  const rating = async (user: User, game: string) => (await admin.query("select rating from game_ratings where user_id = $1 and game_id = $2", [user.profileId, game])).rows;
  const rate = (user: User, game: string, value: number) =>
    runAsUser(pool, user, (_t, c) => c.query("insert into game_ratings (user_id, game_id, rating) values ($1, $2, $3)", [user.profileId, game, value]));

  it("라이브러리에서 지워도 평가는 남는다", async () => {
    const [user, game] = [await makeUser(), await makeGame()];
    await add(user, game, { status: "cleared" });
    await rate(user, game, 8);
    await runAsUser(pool, user, (_t, c) => c.query("delete from user_games where user_id = $1 and game_id = $2", [user.profileId, game]));
    expect(await entry(user, game)).toBeUndefined();
    expect(await rating(user, game)).toEqual([{ rating: 8 }]);
    expect((await admin.query("select rating_count from games where id = $1", [game])).rows[0].rating_count).toBe(1); // 카운터도 그대로
  });

  it("상태를 바꾸거나 엔딩일·100% 달성일을 기록해도 평가가 만들어지지 않는다", async () => {
    const [user, game] = [await makeUser(), await makeGame()];
    await add(user, game);
    await update(user, game, { status: "cleared", started_on: "2026-01-01", cleared_on: "2026-02-01" });
    await update(user, game, { status: "perfected", perfected_on: "2026-03-01" });
    expect(await rating(user, game)).toEqual([]);
    expect((await admin.query("select rating_count, rating_sum from games where id = $1", [game])).rows[0]).toEqual({ rating_count: 0, rating_sum: 0 });
  });

  it("평가는 라이브러리 등록 없이도 할 수 있고, 평가가 라이브러리 항목을 만들지 않는다", async () => {
    const [user, game] = [await makeUser(), await makeGame()];
    await rate(user, game, 6);
    expect(await entry(user, game)).toBeUndefined();
  });
});

describe("RLS와 컬럼 권한", () => {
  it("다른 사용자의 이름으로 등록할 수 없다", async () => {
    const [alice, bob, game] = [await makeUser(), await makeUser(), await makeGame()];
    await expect(
      runAsUser(pool, alice, (_t, c) => c.query("insert into user_games (user_id, game_id) values ($1, $2)", [bob.profileId, game])),
    ).rejects.toMatchObject({ code: "42501", message: expect.stringMatching(/row-level security/) });
  });

  it("다른 사용자의 항목은 고치거나 지울 수 없다(0행)", async () => {
    const [alice, bob, game] = [await makeUser(), await makeUser(), await makeGame()];
    await add(bob, game, { status: "playing" });
    const updated = await runAsUser(pool, alice, (_t, c) => c.query("update user_games set status = 'dropped' where user_id = $1 and game_id = $2", [bob.profileId, game]));
    const deleted = await runAsUser(pool, alice, (_t, c) => c.query("delete from user_games where user_id = $1 and game_id = $2", [bob.profileId, game]));
    expect([updated.rowCount, deleted.rowCount]).toEqual([0, 0]);
    expect((await entry(bob, game)).status).toBe("playing");
  });

  it("라이브러리는 누구에게나 보인다", async () => {
    const [alice, bob, game] = [await makeUser(), await makeUser(), await makeGame()];
    await add(alice, game, { status: "playing" });
    const seen = await runAsUser(pool, bob, (_t, c) => c.query("select status from user_games where user_id = $1", [alice.profileId]));
    expect(seen.rows).toEqual([{ status: "playing" }]);
  });

  // 컬럼 권한과 RLS 정책의 위반은 같은 오류 코드(42501)라서, 메시지가 `permission denied`인지까지 봐야 컬럼 권한이 실제로 막고 있는지 안다.
  it.each([["user_id"], ["game_id"], ["added_at"], ["id"], ["updated_at"]])("만든 뒤에는 %s를 바꿀 수 없다(컬럼 권한)", async (column) => {
    const [alice, bob, game] = [await makeUser(), await makeUser(), await makeGame()];
    await add(alice, game);
    const value = column === "user_id" ? bob.profileId : column === "game_id" ? await makeGame() : column === "id" ? randomUUID() : new Date().toISOString();
    await expect(
      runAsUser(pool, alice, (_t, c) => c.query(`update user_games set ${column} = $1 where user_id = $2 and game_id = $3`, [value, alice.profileId, game])),
    ).rejects.toMatchObject({ code: "42501", message: expect.stringMatching(/^permission denied/) });
  });

  it.each([["added_at", "2000-01-01T00:00:00Z"], ["last_played_on", "2026-01-01"], ["updated_at", "2000-01-01T00:00:00Z"], ["id", randomUUID()]])(
    "등록할 때 %s는 지정할 수 없다(컬럼 권한)",
    async (column, value) => {
      const [user, game] = [await makeUser(), await makeGame()];
      await expect(
        runAsUser(pool, user, (_t, c) => c.query(`insert into user_games (user_id, game_id, ${column}) values ($1, $2, $3)`, [user.profileId, game, value])),
      ).rejects.toMatchObject({ code: "42501", message: expect.stringMatching(/^permission denied/) });
    },
  );

  it("수정하면 updated_at이 갱신되고 등록 시각은 그대로다", async () => {
    const [user, game] = [await makeUser(), await makeGame()];
    await add(user, game);
    const before = await entry(user, game);
    await update(user, game, { status: "playing" });
    const after = await entry(user, game);
    expect(after.added_at).toEqual(before.added_at);
    expect(after.updated_at.getTime()).toBeGreaterThan(before.updated_at.getTime());
  });
});

describe("마지막 플레이일 트리거", () => {
  it("진행도·플레이 시간과 함께 등록하면 오늘(Asia/Seoul)로 채워지고, 없으면 비어 있다", async () => {
    const [a, b, game] = [await makeUser(), await makeUser(), await makeGame()];
    await add(a, game, { progress_percent: 10 });
    await add(b, game, { status: "planned" });
    expect((await entry(a, game)).played).toBe(await seoulToday());
    expect((await entry(b, game)).played).toBeNull();
  });

  it("기준 날짜는 세션 시간대가 아니라 Asia/Seoul이다(어느 시각이든 서울과 날짜가 다른 두 시간대로 확인한다)", async () => {
    // 서울보다 11시간 늦은 곳과 5시간 빠른 곳: 하루 중 어느 시각이든 둘 중 하나는 날짜가 서울과 다르다.
    // `current_date`처럼 세션 시간대를 따르는 구현이면 그쪽에서 틀린 날짜가 찍힌다.
    for (const zone of ["Pacific/Pago_Pago", "Pacific/Kiritimati"]) {
      const [user, game] = [await makeUser(), await makeGame()];
      await runAsUser(pool, user, async (_t, c) => {
        await c.query(`set local time zone '${zone}'`);
        await c.query("insert into user_games (user_id, game_id, progress_percent) values ($1, $2, 10)", [user.profileId, game]);
      });
      expect((await entry(user, game)).played, zone).toBe(await seoulToday());
    }
  });

  it("진행도(퍼센트·텍스트)나 플레이 시간이 값으로 바뀌면 오늘로 맞춘다", async () => {
    const [user, game] = [await makeUser(), await makeGame()];
    await add(user, game);
    for (const change of [{ progress_percent: 30 }, { progress_text: "챕터 3" }, { playtime_minutes: 90 }]) {
      await update(user, game, { last_played_on: "2020-01-01" }); // 수동으로 과거로 돌려 놓고
      expect((await entry(user, game)).played).toBe("2020-01-01");
      await update(user, game, change);
      expect((await entry(user, game)).played, JSON.stringify(change)).toBe(await seoulToday());
    }
  });

  it("값이 그대로이거나 상태·날짜·플랫폼만 바뀌거나 진행도를 지우는 변경은 건드리지 않는다", async () => {
    const [user, game] = [await makeUser(), await makeGame()];
    await add(user, game, { progress_percent: 50, progress_text: "중반", playtime_minutes: 60 });
    await update(user, game, { last_played_on: "2020-01-01" });
    await update(user, game, { progress_percent: 50, playtime_minutes: 60 }); // 같은 값
    await update(user, game, { status: "playing", started_on: "2026-01-01" }); // 진행도가 아닌 변경
    await update(user, game, { progress_percent: null, progress_text: null, playtime_minutes: null }); // 지우기
    expect((await entry(user, game)).played).toBe("2020-01-01");
  });

  it("사용자가 마지막 플레이일을 직접 바꾸면 같은 문장의 진행도 변경이 있어도 그 값을 존중한다", async () => {
    const [user, game] = [await makeUser(), await makeGame()];
    await add(user, game);
    await update(user, game, { progress_percent: 70, last_played_on: "2025-12-25" });
    expect((await entry(user, game)).played).toBe("2025-12-25");
  });
});

describe("개인 메모", () => {
  const putNote = (user: User, userGameId: string, note: string) =>
    runAsUser(pool, user, (_t, c) =>
      c.query("insert into user_game_notes (user_game_id, note) values ($1, $2) on conflict (user_game_id) do update set note = excluded.note", [userGameId, note]),
    );
  const readNotes = (user: User, userGameId: string) => runAsUser(pool, user, (_t, c) => c.query("select note from user_game_notes where user_game_id = $1", [userGameId]));

  it("소유자는 메모를 남기고 고치고 지울 수 있다", async () => {
    const [user, game] = [await makeUser(), await makeGame()];
    const id = (await add(user, game)).rows[0].id;
    await putNote(user, id, "엔딩 보고 나서 다시 해 볼 것");
    expect((await readNotes(user, id)).rows).toEqual([{ note: "엔딩 보고 나서 다시 해 볼 것" }]);
    await putNote(user, id, "수정한 메모");
    expect((await readNotes(user, id)).rows).toEqual([{ note: "수정한 메모" }]);
    await runAsUser(pool, user, (_t, c) => c.query("delete from user_game_notes where user_game_id = $1", [id]));
    expect((await readNotes(user, id)).rowCount).toBe(0);
  });

  it("다른 사용자는 메모를 읽을 수 없다(보이지 않는다)", async () => {
    const [alice, bob, game] = [await makeUser(), await makeUser(), await makeGame()];
    const id = (await add(alice, game)).rows[0].id;
    await putNote(alice, id, "나만 볼 메모");
    expect((await readNotes(bob, id)).rowCount).toBe(0);
    // 라이브러리 항목 자체는 보이지만 메모는 따라오지 않는다.
    const joined = await runAsUser(pool, bob, (_t, c) =>
      c.query("select ug.id, n.note from user_games ug left join user_game_notes n on n.user_game_id = ug.id where ug.id = $1", [id]),
    );
    expect(joined.rows).toEqual([{ id, note: null }]);
  });

  it("다른 사용자의 항목에 메모를 달거나 고치거나 지울 수 없다", async () => {
    const [alice, bob, game] = [await makeUser(), await makeUser(), await makeGame()];
    const id = (await add(alice, game)).rows[0].id;
    await putNote(alice, id, "원래 메모");
    await expect(putNote(bob, id, "덮어쓰기")).rejects.toMatchObject({ code: "42501" });
    const updated = await runAsUser(pool, bob, (_t, c) => c.query("update user_game_notes set note = '변조' where user_game_id = $1", [id]));
    const deleted = await runAsUser(pool, bob, (_t, c) => c.query("delete from user_game_notes where user_game_id = $1", [id]));
    expect([updated.rowCount, deleted.rowCount]).toEqual([0, 0]);
    expect((await readNotes(alice, id)).rows).toEqual([{ note: "원래 메모" }]);
  });

  it("1–2,000자만 받고, 항목을 지우면 메모도 함께 지워진다", async () => {
    const [user, game] = [await makeUser(), await makeGame()];
    const id = (await add(user, game)).rows[0].id;
    await expect(putNote(user, id, "")).rejects.toMatchObject({ code: "23514", constraint: "user_game_notes_note_length" });
    await expect(putNote(user, id, "가".repeat(2001))).rejects.toMatchObject({ code: "23514", constraint: "user_game_notes_note_length" });
    await putNote(user, id, "가".repeat(2000));
    await runAsUser(pool, user, (_t, c) => c.query("delete from user_games where id = $1", [id]));
    expect((await admin.query("select 1 from user_game_notes where user_game_id = $1", [id])).rowCount).toBe(0);
  });
});

import { randomUUID } from "node:crypto";
import { getTableColumns } from "drizzle-orm";
import { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withVerifyFull } from "@/server/db/connection";
import { gameReviewLikes, gameReviews } from "@/server/db/schema";
import { runAsUser } from "@/server/db/with-user";

// 앱과 같은 방식으로 접속한다: RLS가 적용되는 app_user, 풀링 연결. 동시 좋아요 시험을 위해 연결을 여럿 둔다.
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
// 정리·검증 전용 소유자 연결(RLS 없이 실제 행과 카운터를 확인한다).
const admin = new Client({ connectionString: withVerifyFull(process.env.DATABASE_URL_ADMIN as string) });

const RUN = randomUUID().slice(0, 8);
const PREFIX = `rv-${RUN}-`;
let seq = 0;
const next = () => (seq++).toString(36);

/** mulberry32. `Math.imul`로 32비트 곱셈이 정확해서 하위 비트까지 고르게 섞인다. */
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
  const { rows } = await admin.query("insert into profiles (auth_user_id, handle, nickname) values ($1, $2, '리뷰어') returning id", [authUserId, `v${RUN}${next()}`]);
  return { authUserId, profileId: rows[0].id };
}

async function makeGame(): Promise<string> {
  const { rows } = await admin.query("insert into games (source, slug, title) values ('manual', $1, $2) returning id", [`${PREFIX}g${next()}`, `Reviewed ${RUN} ${next()}`]);
  return rows[0].id;
}

type Fields = Partial<{ body: string; has_spoiler: boolean; visibility: string }>;

/** 그 사용자의 세션으로 리뷰를 쓴다. 앱이 쓸 INSERT 열 목록과 같아서 같은 권한 경로를 지난다. */
const write = (user: User, gameId: string, fields: Fields = {}) =>
  runAsUser(pool, user, (_t, c) =>
    c.query<{ id: string }>(
      "insert into game_reviews (user_id, game_id, body, has_spoiler, visibility) values ($1, $2, $3, $4, $5) returning id",
      [user.profileId, gameId, fields.body ?? "재미있게 했어요.", fields.has_spoiler ?? false, fields.visibility ?? "public"],
    ),
  );

/** 그 사용자의 세션으로 리뷰 내용을 고친다(소유자 확인은 RLS가 한다: where에 user_id를 넣지 않아도 남의 행은 0행이다). */
const edit = (user: User, reviewId: string, set: Record<string, unknown>) => {
  const names = Object.keys(set);
  return runAsUser(pool, user, (_t, c) => c.query(`update game_reviews set ${names.map((n, i) => `${n} = $${i + 1}`).join(", ")} where id = $${names.length + 1}`, [...Object.values(set), reviewId]));
};

const remove = (user: User, reviewId: string) => runAsUser(pool, user, (_t, c) => c.query("delete from game_reviews where id = $1", [reviewId]));

/** 좋아요를 누른다. 이미 눌렀다면 아무 일도 하지 않는다(앱이 쓸 ON CONFLICT DO NOTHING). */
const like = (user: User, reviewId: string) =>
  runAsUser(pool, user, (_t, c) => c.query("insert into game_review_likes (review_id, user_id) values ($1, $2) on conflict do nothing", [reviewId, user.profileId]));

const unlike = (user: User, reviewId: string) => runAsUser(pool, user, (_t, c) => c.query("delete from game_review_likes where review_id = $1 and user_id = $2", [reviewId, user.profileId]));

/** 그 사용자의 눈에 보이는 리뷰 id들. `null`이면 세션 없이(로그인하지 않은 방문자) 읽는다. */
async function visible(user: User | null, gameId: string): Promise<string[]> {
  const sql = "select id from game_reviews where game_id = $1";
  const { rows } = user ? await runAsUser(pool, user, (_t, c) => c.query<{ id: string }>(sql, [gameId])) : await pool.query<{ id: string }>(sql, [gameId]);
  return rows.map((r) => r.id);
}

const likeCount = async (reviewId: string) => (await admin.query("select like_count from game_reviews where id = $1", [reviewId])).rows[0]?.like_count as number | undefined;
const likeRows = async (reviewId: string) => (await admin.query("select count(*)::int as n from game_review_likes where review_id = $1", [reviewId])).rows[0].n as number;
const row = async (reviewId: string) => (await admin.query("select * from game_reviews where id = $1", [reviewId])).rows[0];

beforeAll(async () => {
  await admin.connect();
});

afterAll(async () => {
  // 게임·프로필을 지우면 리뷰·좋아요·평가·라이브러리 항목은 함께 지워진다(ON DELETE CASCADE).
  await admin.query("delete from games where slug like $1", [`${PREFIX}%`]);
  await admin.query("delete from profiles where auth_user_id like $1", [`${PREFIX}%`]);
  await admin.end();
  await pool.end();
});

const RLS = { code: "42501", message: expect.stringMatching(/row-level security/) };
const COLUMN_PRIVILEGE = { code: "42501", message: expect.stringMatching(/^permission denied/) };

describe("스키마와 제약", () => {
  it("Drizzle 정의의 컬럼이 실제 테이블과 같다(어긋남 감지)", async () => {
    for (const [table, def] of [["game_reviews", gameReviews], ["game_review_likes", gameReviewLikes]] as const) {
      const { rows } = await admin.query("select column_name from information_schema.columns where table_schema = 'public' and table_name = $1", [table]);
      expect(Object.values(getTableColumns(def)).map((c) => c.name).sort(), table).toEqual(rows.map((r) => r.column_name).sort());
    }
  });

  it("공개 범위·스포일러·좋아요 수의 기본값은 공개·아니오·0이다", async () => {
    const [user, game] = [await makeUser(), await makeGame()];
    const { rows } = await runAsUser(pool, user, (_t, c) => c.query("insert into game_reviews (user_id, game_id, body) values ($1, $2, '기본값') returning id", [user.profileId, game]));
    expect(await row(rows[0].id)).toMatchObject({ visibility: "public", has_spoiler: false, like_count: 0 });
  });

  it("한 사용자가 한 게임에 리뷰를 둘 쓸 수 없다", async () => {
    const [user, game] = [await makeUser(), await makeGame()];
    await write(user, game);
    await expect(write(user, game)).rejects.toMatchObject({ code: "23505", constraint: "game_reviews_user_game_unique" });
  });

  it("같은 사용자가 동시에 여러 번 써도 한 건이다", async () => {
    const [user, game] = [await makeUser(), await makeGame()];
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => write(user, game)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const r of results.filter((x): x is PromiseRejectedResult => x.status === "rejected")) expect(r.reason).toMatchObject({ code: "23505" });
  });

  it("본문은 1–5,000자다(0자·5,001자·공백뿐인 글은 거절, 5,000자는 허용)", async () => {
    const [user, game] = [await makeUser(), await makeGame()];
    await expect(write(user, game, { body: "" })).rejects.toMatchObject({ code: "23514", constraint: "game_reviews_body_length" });
    await expect(write(user, game, { body: "가".repeat(5001) })).rejects.toMatchObject({ code: "23514", constraint: "game_reviews_body_length" });
    for (const blank of [" ", "   ", "\n", " \t\r\n "]) {
      await expect(write(user, game, { body: blank }), JSON.stringify(blank)).rejects.toMatchObject({ code: "23514", constraint: "game_reviews_body_not_blank" });
    }
    // 글자 수는 UTF-16 칸이 아니라 글자 단위다: 이모지 5,000개도 허용된다.
    const { rows } = await write(user, game, { body: "🎮".repeat(5000) });
    expect([...(await row(rows[0].id)).body]).toHaveLength(5000);
  });

  it("없는 게임에는 쓸 수 없다(FK)", async () => {
    const user = await makeUser();
    await expect(write(user, randomUUID())).rejects.toMatchObject({ code: "23503" });
  });

  it("공개 범위는 public·private만 받는다", async () => {
    const [user, game] = [await makeUser(), await makeGame()];
    await expect(write(user, game, { visibility: "friends" })).rejects.toMatchObject({ code: "22P02" });
  });

  it("좋아요 수는 음수가 될 수 없다", async () => {
    const [user, game] = [await makeUser(), await makeGame()];
    const { rows } = await write(user, game);
    await expect(admin.query("update game_reviews set like_count = -1 where id = $1", [rows[0].id])).rejects.toMatchObject({ code: "23514", constraint: "game_reviews_like_count_nonnegative" });
  });
});

describe("평가·라이브러리와 독립이다", () => {
  const rate = (user: User, game: string) => runAsUser(pool, user, (_t, c) => c.query("insert into game_ratings (user_id, game_id, rating) values ($1, $2, 8)", [user.profileId, game]));
  const addToLibrary = (user: User, game: string) => runAsUser(pool, user, (_t, c) => c.query("insert into user_games (user_id, game_id, status) values ($1, $2, 'playing')", [user.profileId, game]));
  const exists = async (table: string, user: User, game: string) => (await admin.query(`select 1 from ${table} where user_id = $1 and game_id = $2`, [user.profileId, game])).rowCount === 1;

  it("평가도 라이브러리 항목도 없이 리뷰를 쓸 수 있고, 리뷰가 그 둘을 만들지 않는다", async () => {
    const [user, game] = [await makeUser(), await makeGame()];
    await write(user, game);
    expect(await exists("game_ratings", user, game)).toBe(false);
    expect(await exists("user_games", user, game)).toBe(false);
  });

  it("평가를 취소하거나 라이브러리에서 지워도 리뷰는 남는다", async () => {
    const [user, game] = [await makeUser(), await makeGame()];
    await rate(user, game);
    await addToLibrary(user, game);
    const { rows } = await write(user, game);
    await runAsUser(pool, user, (_t, c) => c.query("delete from game_ratings where user_id = $1 and game_id = $2", [user.profileId, game]));
    await runAsUser(pool, user, (_t, c) => c.query("delete from user_games where user_id = $1 and game_id = $2", [user.profileId, game]));
    expect(await row(rows[0].id)).toBeDefined();
  });

  it("리뷰를 지워도 평가와 라이브러리 항목은 남는다", async () => {
    const [user, game] = [await makeUser(), await makeGame()];
    await rate(user, game);
    await addToLibrary(user, game);
    const { rows } = await write(user, game);
    await remove(user, rows[0].id);
    expect(await row(rows[0].id)).toBeUndefined();
    expect(await exists("game_ratings", user, game)).toBe(true);
    expect(await exists("user_games", user, game)).toBe(true);
  });
});

describe("공개 범위와 RLS", () => {
  it("공개 리뷰는 누구나(로그인하지 않은 방문자도) 읽고, 비공개 리뷰는 작성자만 읽는다", async () => {
    const [alice, bob, game] = [await makeUser(), await makeUser(), await makeGame()];
    const open = (await write(alice, game)).rows[0].id;
    const secret = (await write(bob, game, { visibility: "private" })).rows[0].id;
    expect((await visible(alice, game)).sort()).toEqual([open].sort()); // alice는 bob의 비공개를 볼 수 없다
    expect((await visible(bob, game)).sort()).toEqual([open, secret].sort()); // bob은 자기 비공개를 본다
    expect(await visible(null, game)).toEqual([open]); // 방문자는 공개만
    // id를 알아도 읽을 수 없다.
    expect((await runAsUser(pool, alice, (_t, c) => c.query("select 1 from game_reviews where id = $1", [secret]))).rowCount).toBe(0);
    expect((await pool.query("select 1 from game_reviews where id = $1", [secret])).rowCount).toBe(0);
  });

  it("공개 범위를 바꾸면 바로 반영되고, 비공개 리뷰의 내용은 타인에게 새지 않는다", async () => {
    const [alice, bob, game] = [await makeUser(), await makeUser(), await makeGame()];
    const id = (await write(alice, game, { body: "공개 글" })).rows[0].id;
    expect(await visible(bob, game)).toEqual([id]);
    await edit(alice, id, { visibility: "private" });
    expect(await visible(bob, game)).toEqual([]);
    expect(await visible(null, game)).toEqual([]);
    expect(await visible(alice, game)).toEqual([id]);
    await edit(alice, id, { visibility: "public" });
    expect(await visible(bob, game)).toEqual([id]);
  });

  it("다른 사용자의 이름으로 리뷰를 만들 수 없다", async () => {
    const [alice, bob, game] = [await makeUser(), await makeUser(), await makeGame()];
    await expect(runAsUser(pool, alice, (_t, c) => c.query("insert into game_reviews (user_id, game_id, body) values ($1, $2, '남의 이름')", [bob.profileId, game]))).rejects.toMatchObject(RLS);
  });

  it("세션 없이는 쓸 수 없다", async () => {
    const [user, game] = [await makeUser(), await makeGame()];
    await expect(pool.query("insert into game_reviews (user_id, game_id, body) values ($1, $2, '세션 없음')", [user.profileId, game])).rejects.toMatchObject(RLS);
  });

  it("다른 사용자의 리뷰는 고치거나 지울 수 없다(0행)", async () => {
    const [alice, bob, game] = [await makeUser(), await makeUser(), await makeGame()];
    const id = (await write(alice, game, { body: "원본" })).rows[0].id;
    expect((await edit(bob, id, { body: "바꿈" })).rowCount).toBe(0);
    expect((await remove(bob, id)).rowCount).toBe(0);
    expect((await row(id)).body).toBe("원본");
    // 비공개 리뷰는 존재 자체가 보이지 않아 마찬가지로 0행이다.
    await edit(alice, id, { visibility: "private" });
    expect((await edit(bob, id, { body: "바꿈" })).rowCount).toBe(0);
    expect((await remove(bob, id)).rowCount).toBe(0);
    expect(await row(id)).toBeDefined();
  });

  it("내용 세 칸(본문·스포일러·공개 범위)만 고칠 수 있다. 소유자·게임·좋아요 수·시각은 본인도 못 바꾼다(컬럼 권한)", async () => {
    const [alice, game, other] = [await makeUser(), await makeGame(), await makeGame()];
    const id = (await write(alice, game)).rows[0].id;
    await edit(alice, id, { body: "수정", has_spoiler: true, visibility: "private" });
    expect(await row(id)).toMatchObject({ body: "수정", has_spoiler: true, visibility: "private" });
    for (const [column, value] of [["user_id", randomUUID()], ["game_id", other], ["like_count", 99], ["created_at", "2000-01-01"], ["updated_at", "2000-01-01"], ["id", randomUUID()]] as const) {
      await expect(edit(alice, id, { [column]: value }), column).rejects.toMatchObject(COLUMN_PRIVILEGE);
    }
  });

  it("수정 시각은 내용을 고칠 때만 바뀌고, 좋아요가 달리는 것은 수정이 아니다", async () => {
    const [alice, bob, game] = [await makeUser(), await makeUser(), await makeGame()];
    const id = (await write(alice, game)).rows[0].id;
    // 시각이 같은 트랜잭션 안에서 같아 보이지 않도록 기준을 하루 전으로 돌려 둔다(소유자 권한, 내용 칸을 건드리지 않아 트리거가 돌지 않는다).
    await admin.query("update game_reviews set updated_at = created_at - interval '1 day' where id = $1", [id]);
    const baseline = (await row(id)).updated_at as Date;
    await like(bob, id);
    expect(await likeCount(id)).toBe(1);
    expect((await row(id)).updated_at).toEqual(baseline); // 좋아요는 수정이 아니다
    await edit(alice, id, { body: "고침" });
    expect(((await row(id)).updated_at as Date).getTime()).toBeGreaterThan(baseline.getTime());
  });
});

describe("좋아요", () => {
  it("누르면 1 늘고 취소하면 줄며, 이미 눌렀다면 아무 일도 하지 않는다", async () => {
    const [alice, bob, game] = [await makeUser(), await makeUser(), await makeGame()];
    const id = (await write(alice, game)).rows[0].id;
    await like(bob, id);
    expect(await likeCount(id)).toBe(1);
    await like(bob, id); // 중복
    expect(await likeCount(id)).toBe(1);
    expect(await likeRows(id)).toBe(1);
    await unlike(bob, id);
    expect(await likeCount(id)).toBe(0);
    expect((await unlike(bob, id)).rowCount).toBe(0); // 이미 취소한 것을 또 취소해도 카운터는 그대로다
    expect(await likeCount(id)).toBe(0);
  });

  it("같은 사용자의 중복 좋아요는 기본 키가 막는다(ON CONFLICT 없이 넣으면 오류)", async () => {
    const [alice, bob, game] = [await makeUser(), await makeUser(), await makeGame()];
    const id = (await write(alice, game)).rows[0].id;
    await like(bob, id);
    await expect(runAsUser(pool, bob, (_t, c) => c.query("insert into game_review_likes (review_id, user_id) values ($1, $2)", [id, bob.profileId]))).rejects.toMatchObject({ code: "23505", constraint: "game_review_likes_pkey" });
  });

  it("자기 리뷰에는 누를 수 없다", async () => {
    const [alice, game] = [await makeUser(), await makeGame()];
    const id = (await write(alice, game)).rows[0].id;
    await expect(like(alice, id)).rejects.toMatchObject(RLS);
    expect(await likeCount(id)).toBe(0);
  });

  it("볼 수 없는 리뷰(남의 비공개)나 없는 리뷰에는 누를 수 없고, 두 경우의 오류가 같아 존재 여부가 드러나지 않는다", async () => {
    const [alice, bob, game] = [await makeUser(), await makeUser(), await makeGame()];
    const secret = (await write(alice, game, { visibility: "private" })).rows[0].id;
    const attempts = await Promise.all([like(bob, secret), like(bob, randomUUID())].map((p) => p.then(() => null, (error: unknown) => error as { code: string; message: string })));
    expect(attempts[0]).toMatchObject(RLS);
    expect(attempts[1]).toMatchObject(RLS);
    expect(attempts[0]?.message).toBe(attempts[1]?.message);
    expect(await likeCount(secret)).toBe(0);
  });

  it("다른 사용자의 이름으로 누를 수 없다", async () => {
    const [alice, bob, carol, game] = [await makeUser(), await makeUser(), await makeUser(), await makeGame()];
    const id = (await write(alice, game)).rows[0].id;
    await expect(runAsUser(pool, bob, (_t, c) => c.query("insert into game_review_likes (review_id, user_id) values ($1, $2)", [id, carol.profileId]))).rejects.toMatchObject(RLS);
    await like(carol, id);
    // 남의 좋아요는 취소할 수 없다(0행).
    expect((await runAsUser(pool, bob, (_t, c) => c.query("delete from game_review_likes where review_id = $1 and user_id = $2", [id, carol.profileId]))).rowCount).toBe(0);
    expect(await likeCount(id)).toBe(1);
  });

  it("좋아요 행은 고칠 수 없다(UPDATE 권한이 없다)", async () => {
    const [alice, bob, carol, game] = [await makeUser(), await makeUser(), await makeUser(), await makeGame()];
    const id = (await write(alice, game)).rows[0].id;
    await like(bob, id);
    await expect(runAsUser(pool, bob, (_t, c) => c.query("update game_review_likes set user_id = $1 where review_id = $2", [carol.profileId, id]))).rejects.toMatchObject(COLUMN_PRIVILEGE);
  });

  it("공개 리뷰의 좋아요는 보이고, 비공개가 된 리뷰의 좋아요 행은 작성자와 누른 본인 외에는 읽을 수 없다", async () => {
    const [alice, bob, carol, game] = [await makeUser(), await makeUser(), await makeUser(), await makeGame()];
    const id = (await write(alice, game)).rows[0].id;
    await like(bob, id);
    const readLikes = async (user: User | null) => {
      const sql = "select user_id from game_review_likes where review_id = $1";
      const { rows } = user ? await runAsUser(pool, user, (_t, c) => c.query<{ user_id: string }>(sql, [id])) : await pool.query<{ user_id: string }>(sql, [id]);
      return rows.map((r) => r.user_id);
    };
    expect(await readLikes(carol)).toEqual([bob.profileId]);
    expect(await readLikes(null)).toEqual([bob.profileId]);
    await edit(alice, id, { visibility: "private" });
    expect(await readLikes(carol)).toEqual([]); // 볼 수 없는 리뷰의 좋아요
    expect(await readLikes(null)).toEqual([]);
    expect(await readLikes(alice)).toEqual([bob.profileId]); // 작성자
    expect(await readLikes(bob)).toEqual([bob.profileId]); // 누른 본인
    // 비공개가 된 뒤에도 누른 본인은 취소할 수 있다.
    await unlike(bob, id);
    expect(await likeCount(id)).toBe(0);
  });

  it("공개 범위를 바꿔도 좋아요 수는 그대로이고, 리뷰를 지우면 좋아요도 함께 지워진다", async () => {
    const [alice, bob, game] = [await makeUser(), await makeUser(), await makeGame()];
    const id = (await write(alice, game)).rows[0].id;
    await like(bob, id);
    await edit(alice, id, { visibility: "private" });
    await edit(alice, id, { visibility: "public" });
    expect(await likeCount(id)).toBe(1);
    await remove(alice, id); // 연쇄로 지워지는 좋아요의 카운터 트리거가 오류를 내지 않는다
    expect(await row(id)).toBeUndefined();
    expect(await likeRows(id)).toBe(0);
  });

  it("좋아요를 누른 프로필이 사라지면 그 좋아요도 카운터에서 빠진다(cascade)", async () => {
    const [alice, bob, carol, game] = [await makeUser(), await makeUser(), await makeUser(), await makeGame()];
    const id = (await write(alice, game)).rows[0].id;
    await like(bob, id);
    await like(carol, id);
    expect(await likeCount(id)).toBe(2);
    await admin.query("delete from profiles where id = $1", [bob.profileId]);
    expect(await likeCount(id)).toBe(1);
    expect(await likeRows(id)).toBe(1);
  });

  it("무작위로 누르고·취소하고·중복으로 눌러도 좋아요 수는 항상 실제 좋아요 행의 수와 같다", { timeout: 120_000 }, async () => {
    const users = await Promise.all(Array.from({ length: 5 }, makeUser));
    // 사용자 0·1·2가 각자 리뷰를 쓰고, 5명 모두가 서로의 리뷰에 좋아요를 누르려 한다(자기 리뷰 시도 포함).
    const reviews = await Promise.all(users.slice(0, 3).map(async (author) => ({ author, id: (await write(author, await makeGame())).rows[0].id as string })));
    const random = seeded(20261115);
    const model = new Map<string, boolean>(); // `${liker}|${review}` → 눌러 둔 상태
    const done = { liked: 0, duplicate: 0, unliked: 0, self: 0 };

    for (let i = 0; i < 70; i += 1) {
      const user = users[Math.floor(random() * users.length)];
      const review = reviews[Math.floor(random() * reviews.length)];
      const key = `${user.profileId}|${review.id}`;
      if (user === review.author) {
        await expect(like(user, review.id)).rejects.toMatchObject(RLS);
        done.self += 1;
      } else if (random() < 0.3) {
        await unlike(user, review.id);
        if (model.get(key)) done.unliked += 1;
        model.set(key, false);
      } else {
        await like(user, review.id);
        if (model.get(key)) done.duplicate += 1;
        else done.liked += 1;
        model.set(key, true);
      }
    }

    // 한 가지 연산만 우연히 나오는 시험이 되지 않도록, 각 연산이 실제로 여러 번 일어났는지 확인한다.
    expect(done.liked).toBeGreaterThanOrEqual(10);
    expect(done.unliked).toBeGreaterThanOrEqual(3);
    expect(done.duplicate).toBeGreaterThanOrEqual(2);
    expect(done.self).toBeGreaterThanOrEqual(3);

    for (const review of reviews) {
      const expected = [...model].filter(([key, on]) => on && key.endsWith(`|${review.id}`)).length;
      expect(await likeCount(review.id)).toBe(expected);
      expect(await likeRows(review.id)).toBe(expected);
    }
  });

  it("서로 다른 사용자가 동시에 눌러도 카운터가 틀어지지 않는다", async () => {
    const [author, game] = [await makeUser(), await makeGame()];
    const likers = await Promise.all(Array.from({ length: 8 }, makeUser));
    const id = (await write(author, game)).rows[0].id;
    await Promise.all(likers.map((user) => like(user, id)));
    expect(await likeCount(id)).toBe(8);
    expect(await likeRows(id)).toBe(8);
    await Promise.all(likers.slice(0, 5).map((user) => unlike(user, id)));
    expect(await likeCount(id)).toBe(3);
  });

  it("같은 사용자가 동시에 여러 번 눌러도 한 번만 센다", async () => {
    const [author, liker, game] = [await makeUser(), await makeUser(), await makeGame()];
    const id = (await write(author, game)).rows[0].id;
    await Promise.all(Array.from({ length: 6 }, () => like(liker, id)));
    expect(await likeCount(id)).toBe(1);
    expect(await likeRows(id)).toBe(1);
  });
});

describe("권한이 좁게 유지된다", () => {
  it("앱 역할은 좋아요 수를 직접 고칠 수 없다", async () => {
    const [alice, game] = [await makeUser(), await makeGame()];
    const id = (await write(alice, game)).rows[0].id;
    await expect(runAsUser(pool, alice, (_t, c) => c.query("update game_reviews set like_count = 99 where id = $1", [id]))).rejects.toMatchObject(COLUMN_PRIVILEGE);
  });

  it("카운터 함수는 앱 역할이 부를 수 없다", async () => {
    const alice = await makeUser();
    await expect(runAsUser(pool, alice, (_t, c) => c.query("select apply_review_like_counters()"))).rejects.toMatchObject({ code: "42501" });
  });

  it("함수 소유자 trigger_owner는 좋아요 수만 바꿀 수 있고, 스키마에 객체를 만들거나 좋아요·리뷰를 직접 쓸 수 없다", async () => {
    const q = async (sql: string) => (await admin.query(sql)).rows[0];
    expect(await q("select pg_get_userbyid(proowner) as owner, prosecdef as secdef, proconfig as config from pg_proc where proname = 'apply_review_like_counters'")).toEqual({
      owner: "trigger_owner",
      secdef: true,
      config: ["search_path=public, pg_temp"],
    });
    expect((await q("select has_column_privilege('trigger_owner', 'game_reviews', 'like_count', 'UPDATE') as ok")).ok).toBe(true);
    // 좋아요 수 말고는 어떤 리뷰 컬럼도 바꿀 수 없다.
    for (const column of ["body", "has_spoiler", "visibility", "user_id", "game_id", "created_at", "updated_at"]) {
      expect((await q(`select has_column_privilege('trigger_owner', 'game_reviews', '${column}', 'UPDATE') as ok`)).ok, column).toBe(false);
    }
    expect((await q("select has_schema_privilege('trigger_owner', 'public', 'CREATE') as ok")).ok).toBe(false);
    expect((await q("select has_table_privilege('trigger_owner', 'game_review_likes', 'INSERT') as ok")).ok).toBe(false);
    expect((await q("select has_table_privilege('trigger_owner', 'game_reviews', 'DELETE') as ok")).ok).toBe(false);
    // 마이그레이션을 실행한 역할도 그 역할로 전환(SET ROLE)할 수는 없다. 상속된 소유권만 가진다.
    await expect(admin.query("set role trigger_owner")).rejects.toMatchObject({ code: "42501" });
  });
});

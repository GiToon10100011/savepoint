import { randomUUID } from "node:crypto";
import { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GameNotFoundError } from "@/features/ratings/ratings";
import type { ReviewInput } from "@/features/reviews/review-form";
import {
  OwnReviewError,
  REVIEW_SORTS,
  ReviewNotFoundError,
  countPublicReviews,
  deleteReview,
  encodeReviewCursor,
  getMyReview,
  listReviews,
  saveReview,
  setReviewLike,
  type ReviewSort,
  type Reviewer,
} from "@/features/reviews/reviews";
import { withVerifyFull } from "@/server/db/connection";
import { runAsUser } from "@/server/db/with-user";

// 앱과 같은 방식으로 접속한다: RLS가 적용되는 app_user, 풀링 연결. 동시 시험을 위해 연결을 여럿 둔다.
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
// 정리·준비 전용 소유자 연결. 작성 시각·좋아요 수처럼 앱이 정할 수 없는 값을 시험 데이터로 정하려고 쓴다.
const admin = new Client({ connectionString: withVerifyFull(process.env.DATABASE_URL_ADMIN as string) });

const RUN = randomUUID().slice(0, 8);
const PREFIX = `rs-${RUN}-`;
let seq = 0;
const next = () => (seq++).toString(36);

async function makeUser(nickname = "리뷰어"): Promise<Reviewer & { handle: string; nickname: string }> {
  const authUserId = `${PREFIX}${next()}`;
  const handle = `s${RUN}${next()}`;
  const { rows } = await admin.query("insert into profiles (auth_user_id, handle, nickname) values ($1, $2, $3) returning id", [authUserId, handle, nickname]);
  return { authUserId, profileId: rows[0].id, handle, nickname };
}

async function makeGame(): Promise<string> {
  const { rows } = await admin.query("insert into games (source, slug, title) values ('manual', $1, $2) returning id", [`${PREFIX}g${next()}`, `Reviewed ${RUN} ${next()}`]);
  return rows[0].id;
}

const input = (over: Partial<ReviewInput> = {}): ReviewInput => ({ body: "재미있게 했어요.", hasSpoiler: false, visibility: "public", ...over });

type Seed = { author: Reviewer; game: string; body?: string; visibility?: "public" | "private"; likes?: number; createdAt: string };
/** 소유자 권한으로 리뷰를 만든다: 작성 시각·좋아요 수를 시험 데이터로 정해야 해서다(좋아요 행 없이 수만 정한다). */
async function seed(s: Seed): Promise<string> {
  const { rows } = await admin.query(
    "insert into game_reviews (user_id, game_id, body, visibility, like_count, created_at, updated_at) values ($1, $2, $3, $4, $5, $6, $6) returning id",
    [s.author.profileId, s.game, s.body ?? `본문 ${next()}`, s.visibility ?? "public", s.likes ?? 0, s.createdAt],
  );
  return rows[0].id;
}

const rate = (user: Reviewer, game: string, rating: number) =>
  runAsUser(pool, user, (_t, c) => c.query("insert into game_ratings (user_id, game_id, rating) values ($1, $2, $3)", [user.profileId, game, rating]));

const row = async (gameId: string, user: Reviewer) => (await admin.query("select * from game_reviews where user_id = $1 and game_id = $2", [user.profileId, gameId])).rows[0];

beforeAll(async () => {
  await admin.connect();
});

afterAll(async () => {
  await admin.query("delete from games where slug like $1", [`${PREFIX}%`]);
  await admin.query("delete from profiles where auth_user_id like $1", [`${PREFIX}%`]);
  await admin.end();
  await pool.end();
});

describe("쓰기·고치기·지우기", () => {
  it("쓰지 않았으면 null이고, 쓰면 내 리뷰로 읽힌다", async () => {
    const [user, game] = [await makeUser(), await makeGame()];
    expect(await getMyReview(pool, user, game)).toBeNull();
    const saved = await saveReview(pool, user, game, input({ body: "처음 쓴 리뷰", hasSpoiler: true }));
    expect(saved).toMatchObject({ body: "처음 쓴 리뷰", hasSpoiler: true, visibility: "public", likeCount: 0 });
    expect(await getMyReview(pool, user, game)).toEqual(saved);
  });

  it("이미 있으면 같은 리뷰의 내용을 바꾼다(한 게임에 하나)", async () => {
    const [user, game] = [await makeUser(), await makeGame()];
    const first = await saveReview(pool, user, game, input({ body: "처음" }));
    const second = await saveReview(pool, user, game, input({ body: "고침", hasSpoiler: true, visibility: "private" }));
    expect(second).toMatchObject({ id: first.id, body: "고침", hasSpoiler: true, visibility: "private" });
    expect((await admin.query("select 1 from game_reviews where user_id = $1 and game_id = $2", [user.profileId, game])).rowCount).toBe(1);
  });

  it("비공개 리뷰도 내 것은 읽는다", async () => {
    const [user, game] = [await makeUser(), await makeGame()];
    await saveReview(pool, user, game, input({ visibility: "private" }));
    expect(await getMyReview(pool, user, game)).toMatchObject({ visibility: "private" });
  });

  it("값이 그대로면 수정 시각이 바뀌지 않고, 값이 바뀌면 바뀐다", async () => {
    const [user, game] = [await makeUser(), await makeGame()];
    await saveReview(pool, user, game, input());
    // 시각이 같은 트랜잭션 안에서 같아 보이지 않도록 기준을 하루 전으로 돌려 둔다(소유자 권한, 내용 칸을 건드리지 않아 트리거가 돌지 않는다).
    await admin.query("update game_reviews set updated_at = created_at - interval '1 day' where user_id = $1 and game_id = $2", [user.profileId, game]);
    const baseline = (await row(game, user)).updated_at as Date;
    await saveReview(pool, user, game, input()); // 같은 값으로 다시 저장
    expect((await row(game, user)).updated_at).toEqual(baseline);
    await saveReview(pool, user, game, input({ body: "달라진 글" }));
    expect(((await row(game, user)).updated_at as Date).getTime()).toBeGreaterThan(baseline.getTime());
  });

  it("없는 게임에는 GameNotFoundError다", async () => {
    const user = await makeUser();
    await expect(saveReview(pool, user, randomUUID(), input())).rejects.toBeInstanceOf(GameNotFoundError);
  });

  it("파서를 거치지 않은 값이 DB 제약에 걸리면 오류로 올리고 아무것도 저장하지 않는다(마지막 방어선)", async () => {
    const [user, game] = [await makeUser(), await makeGame()];
    for (const body of ["", "   ", "가".repeat(5001)]) {
      await expect(saveReview(pool, user, game, input({ body })), JSON.stringify(body.slice(0, 10))).rejects.toMatchObject({ code: "23514" });
    }
    expect(await getMyReview(pool, user, game)).toBeNull();
  });

  it("리뷰를 써도 평가·라이브러리 항목은 생기지 않는다(독립)", async () => {
    const [user, game] = [await makeUser(), await makeGame()];
    await saveReview(pool, user, game, input());
    expect((await admin.query("select 1 from game_ratings where user_id = $1 and game_id = $2", [user.profileId, game])).rowCount).toBe(0);
    expect((await admin.query("select 1 from user_games where user_id = $1 and game_id = $2", [user.profileId, game])).rowCount).toBe(0);
  });

  it("같은 사용자가 동시에 여러 번 저장해도 한 건이고 모두 성공한다", async () => {
    const [user, game] = [await makeUser(), await makeGame()];
    const results = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => saveReview(pool, user, game, input({ body: `동시 ${i}` }))));
    expect(results.filter((r) => r.status === "rejected")).toEqual([]);
    expect((await admin.query("select 1 from game_reviews where user_id = $1 and game_id = $2", [user.profileId, game])).rowCount).toBe(1);
  });

  it("지우면 true, 이미 없으면 false이고 평가·라이브러리는 남는다. 좋아요는 함께 지워진다", async () => {
    const [author, fan, game] = [await makeUser(), await makeUser(), await makeGame()];
    await rate(author, game, 8);
    await runAsUser(pool, author, (_t, c) => c.query("insert into user_games (user_id, game_id) values ($1, $2)", [author.profileId, game]));
    const review = await saveReview(pool, author, game, input());
    await setReviewLike(pool, fan, review.id, true);
    expect(await deleteReview(pool, author, game)).toBe(true);
    expect(await deleteReview(pool, author, game)).toBe(false);
    expect(await getMyReview(pool, author, game)).toBeNull();
    expect((await admin.query("select 1 from game_review_likes where review_id = $1", [review.id])).rowCount).toBe(0);
    expect((await admin.query("select 1 from game_ratings where user_id = $1 and game_id = $2", [author.profileId, game])).rowCount).toBe(1);
    expect((await admin.query("select 1 from user_games where user_id = $1 and game_id = $2", [author.profileId, game])).rowCount).toBe(1);
  });

  it("다른 사용자의 리뷰는 읽거나 지울 수 없다(내 것만 다룬다)", async () => {
    const [alice, bob, game] = [await makeUser(), await makeUser(), await makeGame()];
    await saveReview(pool, alice, game, input({ body: "앨리스의 글" }));
    expect(await getMyReview(pool, bob, game)).toBeNull();
    expect(await deleteReview(pool, bob, game)).toBe(false);
    expect(await getMyReview(pool, alice, game)).toMatchObject({ body: "앨리스의 글" });
  });
});

describe("목록", () => {
  /** 끝까지 한 페이지씩 읽어 모은다. 각 페이지의 크기와 id 중복도 함께 확인한다. */
  async function readAll(viewer: Reviewer | null, game: string, sort: ReviewSort, limit: number) {
    const ids: string[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 50; guard += 1) {
      const page: Awaited<ReturnType<typeof listReviews>> = await listReviews(pool, viewer, game, { sort, limit, cursor });
      expect(page.items.length).toBeLessThanOrEqual(limit);
      ids.push(...page.items.map((i) => i.id));
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    expect(new Set(ids).size, "페이지를 이어 읽을 때 같은 항목이 두 번 나오면 안 된다").toBe(ids.length);
    return ids;
  }

  /** `2026-03-01T00:00:00.000001Z` 같은 시각을 마이크로초 정수로 바꾼다(문자열로 비교하면 소수 초가 있고 없는 값의 순서가 틀린다: `.`이 `Z`보다 앞이다). */
  const micros = (at: string) => {
    const [, base, fraction = ""] = /^(.*?)(?:\.(\d+))?Z$/.exec(at) as RegExpExecArray;
    return Date.parse(`${base}Z`) * 1000 + Number(fraction.padEnd(6, "0"));
  };

  /** 정렬 기준에 따른 기대 순서(시험 안에서 따로 계산한다). 같은 키는 다음 키로 가른다. */
  const expectedOrder = (entries: { id: string; likes: number; at: string }[], sort: ReviewSort) =>
    entries
      .toSorted((a, b) => {
        if (sort === "likes" && a.likes !== b.likes) return b.likes - a.likes;
        if (micros(a.at) !== micros(b.at)) return micros(b.at) - micros(a.at);
        return a.id < b.id ? 1 : -1;
      })
      .map((e) => e.id);

  it("공개 리뷰만 나온다: 비공개는 작성자 본인의 목록에도 나오지 않고, 공개 수에도 세지 않는다", async () => {
    const [alice, bob, game] = [await makeUser(), await makeUser(), await makeGame()];
    const open = await seed({ author: alice, game, createdAt: "2026-02-01T00:00:00Z" });
    await seed({ author: bob, game, visibility: "private", createdAt: "2026-02-02T00:00:00Z" });
    for (const viewer of [alice, bob, null]) {
      expect((await listReviews(pool, viewer, game)).items.map((i) => i.id), viewer?.handle ?? "방문자").toEqual([open]);
    }
    expect(await countPublicReviews(pool, game)).toBe(1);
  });

  it("작성자·본문·좋아요 수·작성 시각과 작성자의 별점(없으면 null)이 함께 온다", async () => {
    const [alice, bob, game] = [await makeUser("앨리스"), await makeUser("밥"), await makeGame()];
    await rate(alice, game, 8); // 별점 4.0
    const a = await seed({ author: alice, game, body: "앨리스의 글", likes: 3, createdAt: "2026-02-01T00:00:00Z" });
    await seed({ author: bob, game, body: "밥의 글", createdAt: "2026-01-01T00:00:00Z" });
    const { items } = await listReviews(pool, null, game);
    expect(items[0]).toEqual({
      id: a,
      body: "앨리스의 글",
      hasSpoiler: false,
      likeCount: 3,
      createdAt: "2026-02-01T00:00:00.000Z",
      edited: false,
      author: { handle: alice.handle, nickname: "앨리스" },
      authorStars: 4,
      likedByMe: false,
      mine: false,
    });
    expect(items[1]).toMatchObject({ author: { nickname: "밥" }, authorStars: null }); // 평가하지 않아도 리뷰는 있다
  });

  it("내가 누른 좋아요와 내 리뷰가 표시되고, 방문자에게는 둘 다 없다", async () => {
    const [alice, bob, carol, game] = [await makeUser(), await makeUser(), await makeUser(), await makeGame()];
    const aliceReview = (await saveReview(pool, alice, game, input({ body: "앨리스" }))).id;
    await saveReview(pool, bob, game, input({ body: "밥" }));
    await setReviewLike(pool, carol, aliceReview, true);
    const flags = async (viewer: Reviewer | null) => Object.fromEntries((await listReviews(pool, viewer, game)).items.map((i) => [i.author.handle, { liked: i.likedByMe, mine: i.mine }]));
    expect(await flags(carol)).toEqual({ [alice.handle]: { liked: true, mine: false }, [bob.handle]: { liked: false, mine: false } });
    expect(await flags(alice)).toEqual({ [alice.handle]: { liked: false, mine: true }, [bob.handle]: { liked: false, mine: false } });
    expect(await flags(null)).toEqual({ [alice.handle]: { liked: false, mine: false }, [bob.handle]: { liked: false, mine: false } });
  });

  it("작성 뒤 내용을 고쳤으면 edited가 참이다", async () => {
    const [alice, game] = [await makeUser(), await makeGame()];
    await saveReview(pool, alice, game, input({ body: "처음" }));
    expect((await listReviews(pool, null, game)).items[0].edited).toBe(false);
    await admin.query("update game_reviews set created_at = created_at - interval '1 day' where user_id = $1 and game_id = $2", [alice.profileId, game]);
    await saveReview(pool, alice, game, input({ body: "고침" }));
    expect((await listReviews(pool, null, game)).items[0].edited).toBe(true);
  });

  describe.each(REVIEW_SORTS)("%s 정렬", (sort) => {
    it("끝까지 이어 읽어도 겹치거나 빠지는 항목이 없고, 기대한 순서다(같은 좋아요 수·같은 시각 포함)", async () => {
      const game = await makeGame();
      const authors = await Promise.all(Array.from({ length: 11 }, () => makeUser()));
      // 좋아요 수가 같은 항목, 시각이 같은 항목, 마이크로초만 다른 항목을 섞는다(JS Date는 마이크로초를 잃는다).
      const plan = [
        [5, "2026-03-01T00:00:00.000001Z"], [5, "2026-03-01T00:00:00.000002Z"], [5, "2026-03-01T00:00:00.000002Z"],
        [0, "2026-03-02T00:00:00Z"], [0, "2026-03-02T00:00:00Z"], [0, "2026-03-03T00:00:00Z"],
        [2, "2026-03-01T00:00:00Z"], [9, "2026-01-01T00:00:00Z"], [2, "2026-03-01T00:00:00Z"], [0, "2026-03-04T00:00:00Z"], [9, "2026-01-02T00:00:00Z"],
      ] as const;
      const entries = await Promise.all(plan.map(async ([likes, at], i) => ({ id: await seed({ author: authors[i], game, likes, createdAt: at }), likes, at })));
      const expected = expectedOrder(entries, sort);
      for (const limit of [3, 4, 11, 12]) expect(await readAll(null, game, sort, limit), `한 페이지 ${limit}건`).toEqual(expected);
    });
  });

  it("정확히 한 페이지만큼이면 다음 커서가 없고, 하나 더 있으면 커서와 함께 한 건이 남는다", async () => {
    const game = await makeGame();
    const authors = await Promise.all(Array.from({ length: 4 }, () => makeUser()));
    for (const [i, author] of authors.entries()) await seed({ author, game, createdAt: `2026-04-0${i + 1}T00:00:00Z` });
    expect((await listReviews(pool, null, game, { limit: 4 })).nextCursor).toBeNull();
    const split = await listReviews(pool, null, game, { limit: 3 });
    expect(split.items).toHaveLength(3);
    expect(split.nextCursor).not.toBeNull();
    expect((await listReviews(pool, null, game, { limit: 3, cursor: split.nextCursor })).items).toHaveLength(1);
  });

  it("조작된 커서나 다른 정렬의 커서, 없는 날짜·시각을 담은 커서는 오류 없이 첫 페이지로 읽는다", async () => {
    const game = await makeGame();
    const authors = await Promise.all(Array.from({ length: 4 }, () => makeUser()));
    for (const [i, author] of authors.entries()) await seed({ author, game, likes: i, createdAt: `2026-05-0${i + 1}T00:00:00Z` });
    const id = randomUUID();
    const forged: Record<ReviewSort, string[]> = {
      likes: [encodeReviewCursor(["3", "2026-13-45 00:00:00+00", id]), encodeReviewCursor(["3", "2026-02-30 00:00:00+00", id]), encodeReviewCursor(["x", "2026-05-01 00:00:00+00", id]), encodeReviewCursor(["3"]), encodeReviewCursor(["3", "2026-05-01 00:00:00+00", "not-a-uuid"])],
      recent: [encodeReviewCursor(["2026-13-45 00:00:00+00", id]), encodeReviewCursor(["0000-01-01 00:00:00+00", id]), encodeReviewCursor(["2026-05-01 00:00:00+00"]), encodeReviewCursor(["2026-05-01 00:00:00+00", id, "extra"])],
    };
    for (const sort of REVIEW_SORTS) {
      for (const cursor of [...forged[sort], "%%%", "", ...forged[sort === "likes" ? "recent" : "likes"].slice(0, 1)]) {
        const page = await listReviews(pool, null, game, { sort, cursor, limit: 2 });
        expect(page.items, `${sort} ${cursor.slice(0, 20)}`).toHaveLength(2);
      }
    }
  });

  it("목록에 없는 정렬 값은 SQL로 흘러가지 않고 기본(좋아요 순)으로 읽힌다", async () => {
    const [alice, game] = [await makeUser(), await makeGame()];
    await seed({ author: alice, game, createdAt: "2026-06-01T00:00:00Z" });
    const page = await listReviews(pool, null, game, { sort: "likes; drop table game_reviews" as unknown as ReviewSort });
    expect(page.items).toHaveLength(1);
    expect((await admin.query("select 1 from game_reviews limit 1")).rowCount).toBeGreaterThanOrEqual(0); // 테이블이 그대로 있다
  });

  it("정렬을 정하지 않거나 알 수 없는 값이면 좋아요 순이다(최신순과 순서가 달라야 시험이 된다)", async () => {
    const game = await makeGame();
    const [a, b, c] = await Promise.all([makeUser(), makeUser(), makeUser()]);
    const newest = await seed({ author: a, game, likes: 1, createdAt: "2026-08-03T00:00:00Z" });
    const oldest = await seed({ author: b, game, likes: 9, createdAt: "2026-08-01T00:00:00Z" });
    const middle = await seed({ author: c, game, likes: 5, createdAt: "2026-08-02T00:00:00Z" });
    const ids = async (query: Parameters<typeof listReviews>[3]) => (await listReviews(pool, null, game, query)).items.map((i) => i.id);
    expect(await ids({})).toEqual([oldest, middle, newest]);
    expect(await ids({ sort: "zzz" as unknown as ReviewSort })).toEqual([oldest, middle, newest]);
    expect(await ids({ sort: "likes" })).toEqual([oldest, middle, newest]);
    expect(await ids({ sort: "recent" })).toEqual([newest, middle, oldest]);
  });

  it("공개 리뷰 수는 읽는 쪽의 권한과 상관없이 공개만 센다(작성자의 세션으로 읽어도 비공개는 세지 않는다)", async () => {
    const [alice, bob, game] = [await makeUser(), await makeUser(), await makeGame()];
    await seed({ author: alice, game, createdAt: "2026-08-04T00:00:00Z" });
    await seed({ author: bob, game, visibility: "private", createdAt: "2026-08-05T00:00:00Z" });
    // 익명 풀은 RLS가 비공개를 이미 숨기므로 조건이 없어도 같은 결과다. 작성자(bob)의 세션으로 읽으면 RLS가 bob에게 자기 비공개 리뷰를
    // 보여 주므로, 쿼리의 조건이 비공개를 걸러야 한다.
    const asBob = { query: (sql: string, params?: unknown[]) => runAsUser(pool, bob, (_t, c) => c.query(sql, params)) } as unknown as Pool;
    expect(await countPublicReviews(asBob, game)).toBe(1);
    expect(await countPublicReviews(pool, game)).toBe(1);
  });

  it("다른 게임의 리뷰는 섞이지 않는다", async () => {
    const [alice, game, other] = [await makeUser(), await makeGame(), await makeGame()];
    const mine = await seed({ author: alice, game, createdAt: "2026-07-01T00:00:00Z" });
    await seed({ author: await makeUser(), game: other, createdAt: "2026-07-02T00:00:00Z" });
    expect((await listReviews(pool, null, game)).items.map((i) => i.id)).toEqual([mine]);
  });
});

describe("좋아요", () => {
  it("누르면 1이 되고, 또 눌러도 그대로이며, 취소하면 0이다(취소를 또 해도 오류가 아니다)", async () => {
    const [alice, bob, game] = [await makeUser(), await makeUser(), await makeGame()];
    const { id } = await saveReview(pool, alice, game, input());
    expect(await setReviewLike(pool, bob, id, true)).toEqual({ liked: true, likeCount: 1 });
    expect(await setReviewLike(pool, bob, id, true)).toEqual({ liked: true, likeCount: 1 });
    expect(await setReviewLike(pool, bob, id, false)).toEqual({ liked: false, likeCount: 0 });
    expect(await setReviewLike(pool, bob, id, false)).toEqual({ liked: false, likeCount: 0 });
  });

  it("이미 눌러 둔 좋아요를 또 누르는 사이 다른 탭이 취소해도, 응답의 내 상태와 수는 같은 시점의 값이다", async () => {
    const [author, fan, game] = [await makeUser(), await makeUser(), await makeGame()];
    const { id } = await saveReview(pool, author, game, input());
    await setReviewLike(pool, fan, id, true); // 이미 눌러 둔 상태: 아래 호출은 아무것도 바꾸지 않는 경로를 지난다
    // 응답을 만드는 마지막 조회 직전에 다른 탭의 취소가 끼어든다(소유자 연결로 직접 지운다. 커밋된 뒤라 마지막 조회가 그 결과를 읽는다).
    let cancelled = false;
    const racing = {
      connect: async () => {
        const client = await pool.connect();
        return new Proxy(client, {
          get(target, property) {
            const value = Reflect.get(target, property, target);
            if (property !== "query") return typeof value === "function" ? value.bind(target) : value;
            return async (...args: unknown[]) => {
              const sql = args[0];
              if (!cancelled && typeof sql === "string" && sql.trimStart().startsWith("select") && sql.includes("like_count")) {
                cancelled = true;
                await admin.query("delete from game_review_likes where review_id = $1 and user_id = $2", [id, fan.profileId]);
              }
              return (value as (...inner: unknown[]) => unknown).apply(target, args);
            };
          },
        });
      },
    } as unknown as Pool;
    const result = await setReviewLike(racing, fan, id, true);
    expect(cancelled, "경쟁 상황이 실제로 만들어졌는지").toBe(true);
    // 요청한 값(liked: true)을 그대로 돌려주면 수는 0인데 눌러 둔 것으로 보여 어긋난다. 읽은 값 그대로여야 한다.
    expect(result).toEqual({ liked: false, likeCount: 0 });
  });

  it("여러 사람이 누른 수가 모이고, 내 상태는 내 것만 반영한다", async () => {
    const [author, bob, carol, game] = [await makeUser(), await makeUser(), await makeUser(), await makeGame()];
    const { id } = await saveReview(pool, author, game, input());
    await setReviewLike(pool, bob, id, true);
    expect(await setReviewLike(pool, carol, id, true)).toEqual({ liked: true, likeCount: 2 });
    expect(await setReviewLike(pool, bob, id, false)).toEqual({ liked: false, likeCount: 1 });
  });

  it("자기 리뷰에는 누르거나 취소할 수 없다", async () => {
    const [alice, game] = [await makeUser(), await makeGame()];
    const { id } = await saveReview(pool, alice, game, input());
    await expect(setReviewLike(pool, alice, id, true)).rejects.toBeInstanceOf(OwnReviewError);
    await expect(setReviewLike(pool, alice, id, false)).rejects.toBeInstanceOf(OwnReviewError);
  });

  it("없는 리뷰와 남의 비공개 리뷰는 같은 오류(ReviewNotFoundError)다", async () => {
    const [alice, bob, game] = [await makeUser(), await makeUser(), await makeGame()];
    const { id } = await saveReview(pool, alice, game, input({ visibility: "private" }));
    await expect(setReviewLike(pool, bob, id, true)).rejects.toBeInstanceOf(ReviewNotFoundError);
    await expect(setReviewLike(pool, bob, randomUUID(), true)).rejects.toBeInstanceOf(ReviewNotFoundError);
    await expect(setReviewLike(pool, bob, id, false)).rejects.toBeInstanceOf(ReviewNotFoundError);
    expect((await admin.query("select like_count from game_reviews where id = $1", [id])).rows[0].like_count).toBe(0);
  });

  it("공개였던 리뷰가 비공개로 바뀌면 더는 누르지 못하고, 작성자가 지운 리뷰에도 못 누른다", async () => {
    const [alice, bob, game] = [await makeUser(), await makeUser(), await makeGame()];
    const { id } = await saveReview(pool, alice, game, input());
    await setReviewLike(pool, bob, id, true);
    await saveReview(pool, alice, game, input({ visibility: "private" }));
    await expect(setReviewLike(pool, bob, id, true)).rejects.toBeInstanceOf(ReviewNotFoundError);
    await deleteReview(pool, alice, game);
    await expect(setReviewLike(pool, bob, id, true)).rejects.toBeInstanceOf(ReviewNotFoundError);
  });

  it("동시에 여러 사용자가 눌러도 모두 성공하고 수가 정확하다", async () => {
    const [author, game] = [await makeUser(), await makeGame()];
    const fans = await Promise.all(Array.from({ length: 8 }, () => makeUser()));
    const { id } = await saveReview(pool, author, game, input());
    const results = await Promise.all(fans.map((fan) => setReviewLike(pool, fan, id, true)));
    expect(results.every((r) => r.liked)).toBe(true);
    expect((await listReviews(pool, null, game)).items[0].likeCount).toBe(8);
  });
});

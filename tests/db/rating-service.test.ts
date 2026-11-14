import { randomUUID } from "node:crypto";
import { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GameNotFoundError, getMyRating, setRating, type Rater } from "@/features/ratings/ratings";
import { withVerifyFull } from "@/server/db/connection";

// 앱과 같은 방식으로 접속한다: RLS가 적용되는 app_user, 풀링 연결.
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
const admin = new Client({ connectionString: withVerifyFull(process.env.DATABASE_URL_ADMIN as string) });

const RUN = randomUUID().slice(0, 8);
const PREFIX = `rs-${RUN}-`;
let seq = 0;
const next = () => (seq++).toString(36);

async function makeUser(): Promise<Rater> {
  const authUserId = `${PREFIX}${next()}`;
  const { rows } = await admin.query("insert into profiles (auth_user_id, handle, nickname) values ($1, $2, '평가자') returning id", [authUserId, `s${RUN}${next()}`]);
  return { authUserId, profileId: rows[0].id };
}

async function makeGame(): Promise<string> {
  const { rows } = await admin.query("insert into games (source, slug, title) values ('manual', $1, $2) returning id", [`${PREFIX}g${next()}`, `Service ${RUN} ${next()}`]);
  return rows[0].id;
}

const count = async (gameId: string) => (await admin.query("select count(*)::int as n from game_ratings where game_id = $1", [gameId])).rows[0].n as number;

beforeAll(async () => {
  await admin.connect();
});

afterAll(async () => {
  await admin.query("delete from games where slug like $1", [`${PREFIX}%`]);
  await admin.query("delete from profiles where auth_user_id like $1", [`${PREFIX}%`]);
  await admin.end();
  await pool.end();
});

describe("setRating / getMyRating", () => {
  it("별점을 남기면 서버가 확정한 상태를 돌려주고, 같은 값을 다시 읽을 수 있다", async () => {
    const [user, game] = [await makeUser(), await makeGame()];
    expect(await getMyRating(pool, user, game)).toBeNull();
    expect(await setRating(pool, user, game, 3.5)).toEqual({ stars: 3.5, ratingCount: 1, ratingSum: 7 });
    expect(await getMyRating(pool, user, game)).toBe(3.5);
  });

  it("수정하면 개수는 그대로이고 합만 바뀐다", async () => {
    const [user, game] = [await makeUser(), await makeGame()];
    await setRating(pool, user, game, 3.5);
    expect(await setRating(pool, user, game, 5)).toEqual({ stars: 5, ratingCount: 1, ratingSum: 10 });
    expect(await getMyRating(pool, user, game)).toBe(5);
    expect(await count(game)).toBe(1);
  });

  it("0.5점부터 5점까지 모든 단위를 저장하고 그대로 읽는다", async () => {
    const [user, game] = [await makeUser(), await makeGame()];
    for (let stored = 1; stored <= 10; stored += 1) {
      const stars = stored / 2;
      expect((await setRating(pool, user, game, stars)).stars).toBe(stars);
      expect(await getMyRating(pool, user, game)).toBe(stars);
    }
  });

  it("취소(null)하면 평가가 사라지고 카운터가 원래대로 돌아온다", async () => {
    const [user, game] = [await makeUser(), await makeGame()];
    await setRating(pool, user, game, 4);
    expect(await setRating(pool, user, game, null)).toEqual({ stars: null, ratingCount: 0, ratingSum: 0 });
    expect(await getMyRating(pool, user, game)).toBeNull();
    expect(await count(game)).toBe(0);
  });

  it("평가가 없는 상태에서 취소해도 오류 없이 그대로다", async () => {
    const [user, game] = [await makeUser(), await makeGame()];
    expect(await setRating(pool, user, game, null)).toEqual({ stars: null, ratingCount: 0, ratingSum: 0 });
  });

  it("여러 사람의 평가가 평균 카운터에 함께 들어가지만 내 별점은 서로 보이지 않는다", async () => {
    const [alice, bob, carol, game] = [await makeUser(), await makeUser(), await makeUser(), await makeGame()];
    await setRating(pool, alice, game, 5);
    const state = await setRating(pool, bob, game, 3);
    expect(state).toEqual({ stars: 3, ratingCount: 2, ratingSum: 16 }); // 합 = 10 + 6
    expect(await getMyRating(pool, alice, game)).toBe(5);
    expect(await getMyRating(pool, bob, game)).toBe(3);
    expect(await getMyRating(pool, carol, game)).toBeNull();
    // 한 사람이 취소해도 다른 사람의 평가는 남는다.
    expect(await setRating(pool, alice, game, null)).toEqual({ stars: null, ratingCount: 1, ratingSum: 6 });
    expect(await getMyRating(pool, bob, game)).toBe(3);
  });

  it.each([0, 0.25, 3.3, 5.5, -1, Number.NaN, Number.POSITIVE_INFINITY])("범위나 단위가 틀린 별점(%s)은 거부하고 아무것도 바꾸지 않는다", async (bad) => {
    const [user, game] = [await makeUser(), await makeGame()];
    await expect(setRating(pool, user, game, bad)).rejects.toThrow(RangeError);
    expect(await count(game)).toBe(0);
  });

  it("없는 게임이면 GameNotFoundError다(남기기도 취소도)", async () => {
    const user = await makeUser();
    await expect(setRating(pool, user, randomUUID(), 4)).rejects.toBeInstanceOf(GameNotFoundError);
    await expect(setRating(pool, user, randomUUID(), null)).rejects.toBeInstanceOf(GameNotFoundError);
  });

  it("실패한 저장은 아무것도 남기지 않는다(트랜잭션)", async () => {
    const [user, game] = [await makeUser(), await makeGame()];
    await setRating(pool, user, game, 4);
    // 없는 게임에 대한 시도가 이미 있는 다른 평가에 영향을 주지 않는다.
    await expect(setRating(pool, user, randomUUID(), 2)).rejects.toBeInstanceOf(GameNotFoundError);
    expect(await getMyRating(pool, user, game)).toBe(4);
    expect(await count(game)).toBe(1);
  });
});

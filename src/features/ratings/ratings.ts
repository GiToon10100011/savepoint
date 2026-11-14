import type { Pool } from "pg";
import { storedToStars, starsToStored, type Stars } from "@/lib/rating";
import { runAsUser } from "@/server/db/with-user";

/** 평가를 남기는 사용자. 세션의 인증 ID와 앱 프로필 ID가 모두 있어야 RLS를 통과한다. */
export type Rater = { authUserId: string; profileId: string };

/** 평가 뒤의 상태: 내 별점(없으면 null)과 그 게임의 평균을 만드는 카운터. */
export type RatingState = { stars: Stars | null; ratingCount: number; ratingSum: number };

export class GameNotFoundError extends Error {
  constructor() {
    super("game not found");
    this.name = "GameNotFoundError";
  }
}

/** 내 별점. 평가하지 않았으면 null. */
export async function getMyRating(pool: Pool, user: Rater, gameId: string): Promise<Stars | null> {
  return runAsUser(pool, user, async (_tx, client) => {
    const { rows } = await client.query<{ rating: number }>("select rating from game_ratings where user_id = $1 and game_id = $2", [user.profileId, gameId]);
    return rows[0] ? storedToStars(rows[0].rating) : null;
  });
}

/**
 * 별점을 남기거나(없으면 만들고 있으면 바꾼다) 취소(`null`)한 뒤, 같은 트랜잭션에서 읽은 상태를 돌려준다.
 * 카운터는 DB 트리거가 같은 문장 안에서 맞추므로 여기서 계산하지 않는다. 평가는 라이브러리·리뷰를 건드리지 않는다.
 * 남의 평가는 RLS가 막는다: 사용자 ID는 항상 세션의 프로필 ID다.
 */
export async function setRating(pool: Pool, user: Rater, gameId: string, stars: Stars | null): Promise<RatingState> {
  const stored = stars === null ? null : starsToStored(stars); // 범위·단위가 틀리면 RangeError
  return runAsUser(pool, user, async (_tx, client) => {
    if (stored === null) {
      await client.query("delete from game_ratings where user_id = $1 and game_id = $2", [user.profileId, gameId]);
    } else {
      try {
        await client.query(
          `insert into game_ratings (user_id, game_id, rating) values ($1, $2, $3)
           on conflict (user_id, game_id) do update set rating = excluded.rating`,
          [user.profileId, gameId, stored],
        );
      } catch (error) {
        // 23503: 없는 게임 ID(FK). 다른 오류는 그대로 올린다.
        if ((error as { code?: string }).code === "23503") throw new GameNotFoundError();
        throw error;
      }
    }
    const { rows } = await client.query<{ rating_count: number; rating_sum: number }>("select rating_count, rating_sum from games where id = $1", [gameId]);
    if (!rows[0]) throw new GameNotFoundError(); // 취소(delete)는 없는 게임이어도 오류가 나지 않으므로 여기서 잡는다
    return { stars, ratingCount: rows[0].rating_count, ratingSum: rows[0].rating_sum };
  });
}

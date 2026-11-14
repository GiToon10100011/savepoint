"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { findGameByIgdbId } from "@/features/games/detail";
import { importIgdbGame } from "@/features/games/import-igdb";
import { isValidStars, type Stars } from "@/lib/rating";
import { appPool, catalogPool } from "@/server/db/client";
import { igdbSource } from "@/server/igdb";
import { getViewer } from "@/server/viewer";
import { GameNotFoundError, setRating, type Rater } from "./ratings";

export type RatingErrorCode = "invalid" | "unauthenticated" | "not_found" | "unavailable" | "failed";

/** 화면에 돌려주는 결과. 성공하면 서버가 확정한 내 별점과 그 게임의 카운터를 준다. */
export type RatingResult = { ok: true; stars: Stars | null; ratingCount: number; ratingSum: number } | { ok: false; code: RatingErrorCode };

// 클라이언트가 보낸 값은 믿지 않는다: 별점은 0.5 단위 0.5–5(또는 취소), ID는 형식까지 확인한다.
const stars = z.number().refine(isValidStars);
const gameInput = z.object({ gameId: z.uuid(), stars: stars.nullable() });
const igdbInput = z.object({ igdbId: z.number().int().positive().max(2_147_483_647), stars });

/**
 * 쓰기는 항상 세션을 먼저 확인한다. 프로필은 첫 로그인에서 만들어진다. 인증 서버나 프로필 조회가 실패해도 액션이 거부되지
 * 않고 결과 코드로 알린다(거부되면 화면이 오류 경계로 가 버리고, 서버에는 처리되지 않은 오류가 남는다).
 */
async function authorize(): Promise<{ user: Rater } | { result: RatingResult }> {
  try {
    const viewer = await getViewer();
    if (!viewer) return { result: { ok: false, code: "unauthenticated" } };
    return { user: { authUserId: viewer.user.id, profileId: viewer.profile.id } };
  } catch (error) {
    return { result: failure(error) };
  }
}

function failure(error: unknown): RatingResult {
  if (error instanceof GameNotFoundError) return { ok: false, code: "not_found" };
  // 원인은 서버 로그에만 남기고(입력값은 남기지 않는다) 사용자에게는 일반 문구를 보여 준다.
  console.error("[ratings] 평가 저장 실패:", error instanceof Error ? error.message : "알 수 없는 오류");
  return { ok: false, code: "failed" };
}

/** 이미 서비스에 있는 게임의 내 별점을 남기거나 바꾸거나(0.5 단위) 취소(`null`)한다. */
export async function rateGameAction(input: unknown): Promise<RatingResult> {
  const session = await authorize();
  if ("result" in session) return session.result;
  const { user } = session;
  const parsed = gameInput.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid" };

  try {
    const state = await setRating(appPool(), user, parsed.data.gameId, parsed.data.stars);
    refresh(); // 같은 응답에 현재 화면의 새 렌더링이 실려 와서 평균 평점도 함께 갱신된다
    return { ok: true, ...state };
  } catch (error) {
    return failure(error);
  }
}

/**
 * 아직 가져오지 않은 IGDB 게임(미리보기 화면)을 **처음 평가하는 순간** 서비스에 등록하고 평가한다. 메타데이터는 클라이언트가
 * 보낸 값이 아니라 IGDB ID로 서버가 직접 조회한 것만 쓴다(아키텍처 §4.3). 성공하면 등록된 게임의 화면으로 이동한다.
 */
export async function rateIgdbGameAction(input: unknown): Promise<RatingResult> {
  const session = await authorize();
  if ("result" in session) return session.result;
  const { user } = session;
  const parsed = igdbInput.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid" };
  const { igdbId } = parsed.data;

  let slug: string;
  try {
    let game = await findGameByIgdbId(appPool(), igdbId);
    if (!game) {
      let draft;
      try {
        draft = await igdbSource().get(igdbId);
      } catch (error) {
        // 키가 없거나 IGDB가 막혔다. 평가는 저장하지 않고 다시 시도하게 한다(기능 명세 B4).
        console.error("[ratings] IGDB 조회 실패:", error instanceof Error ? error.message : "알 수 없는 오류");
        return { ok: false, code: "unavailable" };
      }
      if (!draft) return { ok: false, code: "not_found" };
      game = await importIgdbGame(catalogPool(), draft);
    }
    await setRating(appPool(), user, game.id, parsed.data.stars);
    slug = game.slug;
  } catch (error) {
    return failure(error);
  }
  redirect(`/games/${slug}`);
}

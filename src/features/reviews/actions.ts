"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { ensureIgdbGame } from "@/features/games/ensure-igdb-game";
import { GameNotFoundError } from "@/features/ratings/ratings";
import { appPool } from "@/server/db/client";
import { getViewer } from "@/server/viewer";
import { parseReviewForm, type ReviewFormErrors, type ReviewFormValues } from "./review-form";
import { OwnReviewError, ReviewNotFoundError, deleteReview, saveReview, setReviewLike, type Reviewer } from "./reviews";

export type ReviewErrorCode = "invalid" | "unauthenticated" | "not_found" | "unavailable" | "failed";
export type ReviewResult = { ok: true } | { ok: false; code: ReviewErrorCode };

/** 저장 폼에 돌려주는 상태. 오류 뒤에도 입력이 남도록 값을 함께 돌려준다. */
export type SaveReviewState = {
  /** 저장에 성공했다 */
  saved?: boolean;
  /** 필드에 붙지 않는 오류(로그인 필요, 게임을 못 찾음, 저장 실패) */
  error?: string;
  errors?: ReviewFormErrors;
  values?: ReviewFormValues;
} | null;

/** 좋아요 결과. 성공하면 서버가 확정한 상태를 준다. */
export type LikeResult = { ok: true; liked: boolean; likeCount: number } | { ok: false; code: ReviewErrorCode | "own_review" };

// 클라이언트가 보낸 값은 믿지 않는다: ID는 형식까지 확인한다.
const gameInput = z.object({ gameId: z.uuid() });
const igdbInput = z.object({ igdbId: z.number().int().positive().max(2_147_483_647) });
const likeInput = z.object({ reviewId: z.uuid(), liked: z.boolean() });

const SAVE_FAILED = "저장하지 못했어요. 잠시 후 다시 시도해 주세요.";

/**
 * 쓰기는 항상 세션을 먼저 확인한다. 프로필은 첫 로그인에서 만들어진다. 인증 서버나 프로필 조회가 실패해도 액션이 거부되지
 * 않고 결과로 알린다(거부되면 화면이 오류 경계로 가 버린다).
 */
async function authorize(): Promise<{ user: Reviewer } | { code: "unauthenticated" | "failed" }> {
  try {
    const viewer = await getViewer();
    if (!viewer) return { code: "unauthenticated" };
    return { user: { authUserId: viewer.user.id, profileId: viewer.profile.id } };
  } catch (error) {
    log(error);
    return { code: "failed" };
  }
}

/** 원인은 서버 로그에만 남기고(입력값은 남기지 않는다) 사용자에게는 일반 문구를 보여 준다. */
function log(error: unknown) {
  console.error("[reviews] 처리 실패:", error instanceof Error ? error.message : "알 수 없는 오류");
}

function failure(error: unknown): { ok: false; code: ReviewErrorCode } {
  if (error instanceof GameNotFoundError) return { ok: false, code: "not_found" };
  log(error);
  return { ok: false, code: "failed" };
}

/**
 * 리뷰를 쓰거나 고친다. 폼 값은 서버에서 다시 검증한다. 대상은 숨은 입력 `gameId`(이미 서비스에 있는 게임)나 `igdbId`(아직 가져오지
 * 않은 IGDB 게임의 미리보기 화면)다. 후자는 **처음 기록하는 순간** 서비스에 등록하고 쓴다(평가·라이브러리와 같은 경로, `ensureIgdbGame`).
 */
export async function saveReviewAction(_prev: SaveReviewState, formData: FormData): Promise<SaveReviewState> {
  const session = await authorize();
  const parsed = parseReviewForm(formData);
  if ("code" in session) return { error: session.code === "unauthenticated" ? "로그인이 필요해요." : SAVE_FAILED, values: parsed.values };

  // 둘 다 오면 이미 서비스에 있는 게임(gameId)을 우선한다.
  const game = gameInput.safeParse({ gameId: formData.get("gameId") });
  const igdb = igdbInput.safeParse({ igdbId: Number(formData.get("igdbId")) });
  const target = game.success ? ({ kind: "game", gameId: game.data.gameId } as const) : igdb.success ? ({ kind: "igdb", igdbId: igdb.data.igdbId } as const) : null;
  if (!target) return { error: SAVE_FAILED, values: parsed.values };
  if (!parsed.ok) return { errors: parsed.errors, values: parsed.values };

  if (target.kind === "game") {
    try {
      await saveReview(appPool(), session.user, target.gameId, parsed.data);
    } catch (error) {
      if (error instanceof GameNotFoundError) return { error: "게임을 찾을 수 없어요. 화면을 새로 고쳐 주세요.", values: parsed.values };
      log(error);
      return { error: SAVE_FAILED, values: parsed.values };
    }
    refresh(); // 같은 응답에 현재 화면의 새 렌더링이 실려 와서 리뷰 목록과 `내 기록`이 바로 바뀐다
    return { saved: true, values: parsed.values };
  }

  let slug: string;
  try {
    const ensured = await ensureIgdbGame(target.igdbId);
    if (!ensured.ok) {
      return { error: ensured.code === "unavailable" ? "게임 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요." : "게임을 찾을 수 없어요.", values: parsed.values };
    }
    await saveReview(appPool(), session.user, ensured.game.id, parsed.data);
    slug = ensured.game.slug;
  } catch (error) {
    log(error);
    return { error: SAVE_FAILED, values: parsed.values };
  }
  redirect(`/games/${slug}`);
}

/** 내 리뷰를 지운다. 좋아요도 함께 지워지고 평가·라이브러리는 남는다. */
export async function deleteReviewAction(input: unknown): Promise<ReviewResult> {
  const session = await authorize();
  if ("code" in session) return { ok: false, code: session.code };
  const parsed = gameInput.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid" };

  try {
    await deleteReview(appPool(), session.user, parsed.data.gameId);
    refresh();
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

/**
 * 리뷰 좋아요를 누르거나(`liked: true`) 취소한다. 자기 리뷰와 볼 수 없는 리뷰는 거절된다.
 * 화면을 다시 그리지 않는다: 좋아요 순 목록이 누를 때마다 뒤섞이면 읽던 자리를 잃으므로, 서버가 확정한 상태만 돌려준다.
 */
export async function toggleReviewLikeAction(input: unknown): Promise<LikeResult> {
  const session = await authorize();
  if ("code" in session) return { ok: false, code: session.code };
  const parsed = likeInput.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid" };

  try {
    const state = await setReviewLike(appPool(), session.user, parsed.data.reviewId, parsed.data.liked);
    return { ok: true, ...state };
  } catch (error) {
    if (error instanceof OwnReviewError) return { ok: false, code: "own_review" };
    if (error instanceof ReviewNotFoundError) return { ok: false, code: "not_found" };
    return failure(error);
  }
}

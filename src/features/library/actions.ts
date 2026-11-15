"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { ensureIgdbGame } from "@/features/games/ensure-igdb-game";
import { GameNotFoundError } from "@/features/ratings/ratings";
import { appPool } from "@/server/db/client";
import { getViewer } from "@/server/viewer";
import { parseEntryForm, type EntryFormErrors, type EntryFormValues } from "./entry-form";
import { InvalidPlatformError, NotInLibraryError, addToLibrary, removeFromLibrary, saveLibraryEntry, type LibraryUser } from "./library";

export type LibraryErrorCode = "invalid" | "unauthenticated" | "not_found" | "unavailable" | "failed";
export type LibraryResult = { ok: true } | { ok: false; code: LibraryErrorCode };

/** 저장 폼에 돌려주는 상태. 오류 뒤에도 입력이 남도록 값을 함께 돌려준다. */
export type SaveEntryState = {
  /** 저장에 성공했다 */
  saved?: boolean;
  /** 필드에 붙지 않는 오류(로그인 필요, 이미 지워진 게임, 저장 실패) */
  error?: string;
  errors?: EntryFormErrors;
  values?: EntryFormValues;
} | null;

// 클라이언트가 보낸 값은 믿지 않는다: ID는 형식까지 확인한다.
const gameInput = z.object({ gameId: z.uuid() });
const igdbInput = z.object({ igdbId: z.number().int().positive().max(2_147_483_647) });

const SAVE_FAILED = "저장하지 못했어요. 잠시 후 다시 시도해 주세요.";

/**
 * 쓰기는 항상 세션을 먼저 확인한다. 프로필은 첫 로그인에서 만들어진다. 인증 서버나 프로필 조회가 실패해도 액션이 거부되지
 * 않고 결과로 알린다(거부되면 화면이 오류 경계로 가 버린다).
 */
async function authorize(): Promise<{ user: LibraryUser } | { result: LibraryResult & { ok: false } }> {
  try {
    const viewer = await getViewer();
    if (!viewer) return { result: { ok: false, code: "unauthenticated" } };
    return { user: { authUserId: viewer.user.id, profileId: viewer.profile.id } };
  } catch (error) {
    return { result: failure(error) };
  }
}

function failure(error: unknown): LibraryResult & { ok: false } {
  if (error instanceof GameNotFoundError) return { ok: false, code: "not_found" };
  // 원인은 서버 로그에만 남기고(입력값은 남기지 않는다) 사용자에게는 일반 문구를 보여 준다.
  console.error("[library] 처리 실패:", error instanceof Error ? error.message : "알 수 없는 오류");
  return { ok: false, code: "failed" };
}

/** 이미 서비스에 있는 게임을 라이브러리에 추가한다(상태 미지정). 이미 있으면 그대로 둔다. */
export async function addToLibraryAction(input: unknown): Promise<LibraryResult> {
  const session = await authorize();
  if ("result" in session) return session.result;
  const parsed = gameInput.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid" };

  try {
    await addToLibrary(appPool(), session.user, parsed.data.gameId);
    refresh(); // 같은 응답에 현재 화면의 새 렌더링이 실려 와서 `내 기록`이 바로 바뀐다
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

/**
 * 아직 가져오지 않은 IGDB 게임(미리보기 화면)을 **처음 기록하는 순간** 서비스에 등록하고 라이브러리에 추가한다.
 * 메타데이터는 서버가 IGDB ID로 직접 조회한 것만 쓴다(평가와 같은 경로, `ensureIgdbGame`). 성공하면 등록된 게임 화면으로 이동한다.
 */
export async function addIgdbGameToLibraryAction(input: unknown): Promise<LibraryResult> {
  const session = await authorize();
  if ("result" in session) return session.result;
  const parsed = igdbInput.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid" };

  let slug: string;
  try {
    const ensured = await ensureIgdbGame(parsed.data.igdbId);
    if (!ensured.ok) return { ok: false, code: ensured.code };
    await addToLibrary(appPool(), session.user, ensured.game.id);
    slug = ensured.game.slug;
  } catch (error) {
    return failure(error);
  }
  redirect(`/games/${slug}`);
}

/** 상태·플랫폼·날짜·진행도·플레이 시간·메모를 저장한다. 폼 값은 서버에서 다시 검증한다. */
export async function saveLibraryEntryAction(_prev: SaveEntryState, formData: FormData): Promise<SaveEntryState> {
  const session = await authorize();
  const parsed = parseEntryForm(formData);
  if ("result" in session) {
    return { error: session.result.code === "unauthenticated" ? "로그인이 필요해요." : SAVE_FAILED, values: parsed.values };
  }
  const gameId = gameInput.safeParse({ gameId: formData.get("gameId") });
  if (!gameId.success) return { error: SAVE_FAILED, values: parsed.values };
  if (!parsed.ok) return { errors: parsed.errors, values: parsed.values };

  try {
    await saveLibraryEntry(appPool(), session.user, gameId.data.gameId, parsed.data);
  } catch (error) {
    if (error instanceof NotInLibraryError) return { error: "라이브러리에서 이미 지워진 게임이에요. 화면을 새로 고쳐 주세요.", values: parsed.values };
    if (error instanceof InvalidPlatformError) return { errors: { platformId: "목록에 있는 플랫폼을 골라 주세요." }, values: parsed.values };
    failure(error); // 원인을 서버 로그에 남긴다(입력값은 남기지 않는다)
    return { error: SAVE_FAILED, values: parsed.values };
  }
  refresh();
  return { saved: true, values: parsed.values };
}

/** 라이브러리에서 지운다. 상태·날짜·메모는 사라지고 평가·리뷰는 남는다. */
export async function removeFromLibraryAction(input: unknown): Promise<LibraryResult> {
  const session = await authorize();
  if ("result" in session) return session.result;
  const parsed = gameInput.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid" };

  try {
    await removeFromLibrary(appPool(), session.user, parsed.data.gameId);
    refresh();
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

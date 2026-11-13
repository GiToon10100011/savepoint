"use server";

import { redirect } from "next/navigation";
import { appPool } from "@/server/db/client";
import { requireViewer } from "@/server/viewer";
import { MANUAL_GAMES_PER_HOUR, RateLimitError, createManualGame } from "./manual";
import { parseManualForm, type ManualFormErrors, type ManualFormValues } from "./manual-form";

/** 폼에 돌려주는 상태. 오류 뒤에도 입력이 남도록 값을 함께 돌려준다. */
export type ManualGameState = {
  /** 필드에 붙지 않는 오류(한도 초과, 저장 실패) */
  error?: string;
  errors?: ManualFormErrors;
  values?: ManualFormValues;
} | null;

export async function createGameAction(_prev: ManualGameState, formData: FormData): Promise<ManualGameState> {
  // 쓰기는 항상 세션을 먼저 확인한다. 비로그인이면 입력을 읽기 전에 로그인 화면으로 보낸다(로그인 뒤 이 화면으로 돌아온다).
  const viewer = await requireViewer("/games/new");

  const parsed = parseManualForm(formData);
  if (!parsed.ok) return { errors: parsed.errors, values: parsed.values };

  let slug: string;
  try {
    ({ slug } = await createManualGame(appPool(), { authUserId: viewer.user.id, profileId: viewer.profile.id }, parsed.data));
  } catch (error) {
    if (error instanceof RateLimitError) {
      return { error: `한 시간에 ${MANUAL_GAMES_PER_HOUR}건까지 등록할 수 있어요. 잠시 후 다시 시도해 주세요.`, values: parsed.values };
    }
    // 원인은 서버 로그에만 남기고(입력값은 남기지 않는다) 사용자에게는 일반 문구를 보여 준다.
    console.error("[games] 수동 등록 실패:", error instanceof Error ? error.message : "알 수 없는 오류");
    return { error: "등록하지 못했어요. 잠시 후 다시 시도해 주세요.", values: parsed.values };
  }
  redirect(`/games/${slug}`);
}

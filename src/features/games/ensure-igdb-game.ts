import { appPool, catalogPool } from "@/server/db/client";
import { igdbSource } from "@/server/igdb";
import { findGameByIgdbId } from "./detail";
import { importIgdbGame } from "./import-igdb";

export type EnsureIgdbResult =
  | { ok: true; game: { id: string; slug: string } }
  /** `unavailable`: 키가 없거나 IGDB가 막혔다. `not_found`: IGDB에 없는 ID다. */
  | { ok: false; code: "unavailable" | "not_found" };

/**
 * 아직 가져오지 않은 IGDB 게임(미리보기 화면)을 **처음 기록하는 순간** 서비스에 등록한다(평가·라이브러리 등록이 같이 쓴다).
 * 이미 있으면 그대로 돌려주고 IGDB를 다시 부르지 않는다. 메타데이터는 클라이언트가 보낸 값이 아니라 IGDB ID로 서버가 직접
 * 조회한 것만 쓴다(아키텍처 §4.3). IGDB를 못 부르면 가져오지 않고 알린다(기능 명세 B4). DB 오류는 그대로 던진다.
 */
export async function ensureIgdbGame(igdbId: number): Promise<EnsureIgdbResult> {
  const existing = await findGameByIgdbId(appPool(), igdbId);
  if (existing) return { ok: true, game: existing };

  let draft;
  try {
    draft = await igdbSource().get(igdbId);
  } catch (error) {
    console.error("[games] IGDB 조회 실패:", error instanceof Error ? error.message : "알 수 없는 오류");
    return { ok: false, code: "unavailable" };
  }
  if (!draft) return { ok: false, code: "not_found" };

  const imported = await importIgdbGame(catalogPool(), draft);
  return { ok: true, game: { id: imported.id, slug: imported.slug } };
}

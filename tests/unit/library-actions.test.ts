import { beforeEach, describe, expect, it, vi } from "vitest";

// 바깥 경계(세션·DB 풀·가져오기·이동·새로고침)만 대체하고 액션 자체의 판단을 시험한다.
const mocks = vi.hoisted(() => ({
  getViewer: vi.fn(),
  ensureIgdbGame: vi.fn(),
  addToLibrary: vi.fn(),
  saveLibraryEntry: vi.fn(),
  removeFromLibrary: vi.fn(),
  refresh: vi.fn(),
  redirect: vi.fn(),
  appPool: { name: "app-pool" },
}));

vi.mock("next/cache", () => ({ refresh: mocks.refresh }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/server/viewer", () => ({ getViewer: mocks.getViewer }));
vi.mock("@/server/db/client", () => ({ appPool: () => mocks.appPool }));
vi.mock("@/features/games/ensure-igdb-game", () => ({ ensureIgdbGame: mocks.ensureIgdbGame }));
// 데이터 계층은 대체하되 오류 클래스는 진짜를 쓴다(액션이 `instanceof`로 구분한다).
vi.mock("@/features/library/library", async (original) => ({
  ...(await original<typeof import("@/features/library/library")>()),
  addToLibrary: mocks.addToLibrary,
  saveLibraryEntry: mocks.saveLibraryEntry,
  removeFromLibrary: mocks.removeFromLibrary,
}));

import { addIgdbGameToLibraryAction, addToLibraryAction, removeFromLibraryAction, saveLibraryEntryAction } from "@/features/library/actions";
import { InvalidPlatformError, NotInLibraryError } from "@/features/library/library";
import { GameNotFoundError } from "@/features/ratings/ratings";

const GAME_ID = "123e4567-e89b-42d3-a456-426614174000";
const VIEWER = { user: { id: "auth-user-1", name: "플레이어", email: "player@example.com" }, profile: { id: "223e4567-e89b-42d3-a456-426614174000" } };
const USER = { authUserId: "auth-user-1", profileId: "223e4567-e89b-42d3-a456-426614174000" };
const GENERIC = "저장하지 못했어요. 잠시 후 다시 시도해 주세요.";

/** redirect()가 **정확히** 이 주소로 불렸는지 본다(부분 일치는 다른 주소도 통과시킨다). */
const redirectedTo = (promise: Promise<unknown>, url: string) => expect(promise).rejects.toHaveProperty("message", `NEXT_REDIRECT:${url}`);

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.getViewer.mockResolvedValue(VIEWER);
  mocks.redirect.mockImplementation((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  });
});

describe("addToLibraryAction", () => {
  it("로그인하지 않았으면 아무것도 하지 않고 알린다", async () => {
    mocks.getViewer.mockResolvedValue(null);
    await expect(addToLibraryAction({ gameId: GAME_ID })).resolves.toEqual({ ok: false, code: "unauthenticated" });
    expect(mocks.addToLibrary).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("세션 확인이 실패해도 액션이 거부되지 않고 failed로 알린다", async () => {
    mocks.getViewer.mockRejectedValue(new Error("auth server unreachable"));
    await expect(addToLibraryAction({ gameId: GAME_ID })).resolves.toEqual({ ok: false, code: "failed" });
    expect(mocks.addToLibrary).not.toHaveBeenCalled();
  });

  it("세션의 사용자로 추가하고 화면을 새로 고친다. 클라이언트가 보낸 사용자 ID는 무시한다", async () => {
    await expect(addToLibraryAction({ gameId: GAME_ID, userId: "someone-else", profileId: "323e4567-e89b-42d3-a456-426614174000" })).resolves.toEqual({ ok: true });
    expect(mocks.addToLibrary).toHaveBeenCalledWith(mocks.appPool, USER, GAME_ID);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it.each([["uuid가 아닌 ID", { gameId: "not-a-uuid" }], ["ID 없음", {}], ["숫자 ID", { gameId: 5 }], ["객체가 아닌 입력", "x"], ["null", null]])(
    "잘못된 입력은 처리하지 않는다: %s",
    async (_name, input) => {
      await expect(addToLibraryAction(input)).resolves.toEqual({ ok: false, code: "invalid" });
      expect(mocks.addToLibrary).not.toHaveBeenCalled();
    },
  );

  it("없는 게임이면 not_found, 그 밖의 실패는 failed이고 새로 고치지 않는다", async () => {
    mocks.addToLibrary.mockRejectedValueOnce(new GameNotFoundError());
    await expect(addToLibraryAction({ gameId: GAME_ID })).resolves.toEqual({ ok: false, code: "not_found" });
    mocks.addToLibrary.mockRejectedValueOnce(new Error("connection reset"));
    await expect(addToLibraryAction({ gameId: GAME_ID })).resolves.toEqual({ ok: false, code: "failed" });
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});

describe("addIgdbGameToLibraryAction", () => {
  it("로그인하지 않았으면 IGDB도 부르지 않는다", async () => {
    mocks.getViewer.mockResolvedValue(null);
    await expect(addIgdbGameToLibraryAction({ igdbId: 1942 })).resolves.toEqual({ ok: false, code: "unauthenticated" });
    expect(mocks.ensureIgdbGame).not.toHaveBeenCalled();
  });

  it.each([["0", { igdbId: 0 }], ["음수", { igdbId: -5 }], ["소수", { igdbId: 1.5 }], ["int 범위 초과", { igdbId: 2_147_483_648 }], ["문자열", { igdbId: "1942" }], ["없음", {}]])(
    "잘못된 IGDB ID(%s)는 가져오지 않는다",
    async (_name, input) => {
      await expect(addIgdbGameToLibraryAction(input)).resolves.toEqual({ ok: false, code: "invalid" });
      expect(mocks.ensureIgdbGame).not.toHaveBeenCalled();
      expect(mocks.addToLibrary).not.toHaveBeenCalled();
    },
  );

  it("서비스에 등록하고(또는 이미 있는 게임을) 라이브러리에 추가한 뒤 그 게임 화면으로 보낸다", async () => {
    mocks.ensureIgdbGame.mockResolvedValue({ ok: true, game: { id: GAME_ID, slug: "imported-game" } });
    await redirectedTo(addIgdbGameToLibraryAction({ igdbId: 1942 }), "/games/imported-game");
    expect(mocks.ensureIgdbGame).toHaveBeenCalledWith(1942);
    expect(mocks.addToLibrary).toHaveBeenCalledWith(mocks.appPool, USER, GAME_ID);
  });

  it("IGDB를 못 부르거나 없는 ID면 추가하지 않고 그 이유를 알린다", async () => {
    mocks.ensureIgdbGame.mockResolvedValueOnce({ ok: false, code: "unavailable" });
    await expect(addIgdbGameToLibraryAction({ igdbId: 1942 })).resolves.toEqual({ ok: false, code: "unavailable" });
    mocks.ensureIgdbGame.mockResolvedValueOnce({ ok: false, code: "not_found" });
    await expect(addIgdbGameToLibraryAction({ igdbId: 1942 })).resolves.toEqual({ ok: false, code: "not_found" });
    expect(mocks.addToLibrary).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("가져오기나 추가가 실패하면 이동하지 않는다", async () => {
    mocks.ensureIgdbGame.mockRejectedValueOnce(new Error("db write failed"));
    await expect(addIgdbGameToLibraryAction({ igdbId: 1942 })).resolves.toEqual({ ok: false, code: "failed" });
    mocks.ensureIgdbGame.mockResolvedValueOnce({ ok: true, game: { id: GAME_ID, slug: "g" } });
    mocks.addToLibrary.mockRejectedValueOnce(new Error("connection reset"));
    await expect(addIgdbGameToLibraryAction({ igdbId: 1942 })).resolves.toEqual({ ok: false, code: "failed" });
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});

describe("saveLibraryEntryAction", () => {
  const valid = { gameId: GAME_ID, status: "playing", progressPercent: "40", note: "아주 개인적인 메모" };

  it("로그인하지 않았으면 저장하지 않고 입력값을 돌려준다", async () => {
    mocks.getViewer.mockResolvedValue(null);
    const state = await saveLibraryEntryAction(null, form(valid));
    expect(state).toMatchObject({ error: "로그인이 필요해요.", values: { status: "playing", note: "아주 개인적인 메모" } });
    expect(mocks.saveLibraryEntry).not.toHaveBeenCalled();
  });

  it("세션 확인이 실패하면 일반 오류로 알리고 거부되지 않는다", async () => {
    mocks.getViewer.mockRejectedValue(new Error("auth server unreachable"));
    await expect(saveLibraryEntryAction(null, form(valid))).resolves.toMatchObject({ error: GENERIC });
    expect(mocks.saveLibraryEntry).not.toHaveBeenCalled();
  });

  it("게임 ID가 없거나 uuid가 아니면 저장하지 않는다", async () => {
    for (const gameId of [undefined, "not-a-uuid", "5"]) {
      const fields: Record<string, string> = { status: "playing" };
      if (gameId !== undefined) fields.gameId = gameId;
      await expect(saveLibraryEntryAction(null, form(fields)), String(gameId)).resolves.toMatchObject({ error: GENERIC });
    }
    expect(mocks.saveLibraryEntry).not.toHaveBeenCalled();
  });

  it("폼 값이 틀리면 필드별 오류와 입력값을 돌려주고 저장하지 않는다", async () => {
    const state = await saveLibraryEntryAction(null, form({ ...valid, progressPercent: "150", startedOn: "2026-13-01" }));
    expect(state?.errors).toMatchObject({ progressPercent: expect.any(String), startedOn: expect.any(String) });
    expect(state?.values).toMatchObject({ progressPercent: "150", note: "아주 개인적인 메모" });
    expect(mocks.saveLibraryEntry).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("검증한 값을 세션의 사용자로 저장하고 새로 고친다. 클라이언트가 보낸 사용자 ID는 무시한다", async () => {
    const state = await saveLibraryEntryAction(null, form({ ...valid, userId: "someone-else", profileId: "323e4567-e89b-42d3-a456-426614174000", playtimeHours: "2", playtimeMinutes: "5" }));
    expect(state).toMatchObject({ saved: true, values: { status: "playing" } });
    expect(mocks.saveLibraryEntry).toHaveBeenCalledWith(mocks.appPool, USER, GAME_ID, {
      status: "playing", platformId: null, startedOn: null, clearedOn: null, perfectedOn: null,
      playtimeMinutes: 125, progressPercent: 40, progressText: null, note: "아주 개인적인 메모",
    });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("이미 지워진 항목이면 안내하고, 없는 플랫폼이면 그 칸에 알린다", async () => {
    mocks.saveLibraryEntry.mockRejectedValueOnce(new NotInLibraryError());
    expect(await saveLibraryEntryAction(null, form(valid))).toMatchObject({ error: expect.stringContaining("이미 지워진") });
    mocks.saveLibraryEntry.mockRejectedValueOnce(new InvalidPlatformError());
    expect(await saveLibraryEntryAction(null, form({ ...valid, platformId: "999" }))).toMatchObject({ errors: { platformId: expect.any(String) } });
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("그 밖의 실패는 일반 오류로만 알리고, 메모 같은 입력값은 로그에 남기지 않는다", async () => {
    mocks.saveLibraryEntry.mockRejectedValue(new Error("connection reset"));
    const state = await saveLibraryEntryAction(null, form(valid));
    expect(state).toMatchObject({ error: GENERIC, values: { note: "아주 개인적인 메모" } }); // 화면에는 입력을 되돌려 준다
    expect(mocks.refresh).not.toHaveBeenCalled();
    const logged = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(logged).toContain("connection reset");
    expect(logged).not.toContain("아주 개인적인 메모");
    expect(logged).not.toContain(GAME_ID);
  });
});

describe("removeFromLibraryAction", () => {
  it("로그인하지 않았으면 지우지 않는다", async () => {
    mocks.getViewer.mockResolvedValue(null);
    await expect(removeFromLibraryAction({ gameId: GAME_ID })).resolves.toEqual({ ok: false, code: "unauthenticated" });
    expect(mocks.removeFromLibrary).not.toHaveBeenCalled();
  });

  it("잘못된 ID는 처리하지 않는다", async () => {
    await expect(removeFromLibraryAction({ gameId: "x" })).resolves.toEqual({ ok: false, code: "invalid" });
    expect(mocks.removeFromLibrary).not.toHaveBeenCalled();
  });

  it("세션의 사용자 것만 지우고 새로 고친다", async () => {
    mocks.removeFromLibrary.mockResolvedValue(true);
    await expect(removeFromLibraryAction({ gameId: GAME_ID, userId: "someone-else" })).resolves.toEqual({ ok: true });
    expect(mocks.removeFromLibrary).toHaveBeenCalledWith(mocks.appPool, USER, GAME_ID);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("이미 없어도(false) 오류가 아니다. 실패하면 failed다", async () => {
    mocks.removeFromLibrary.mockResolvedValueOnce(false);
    await expect(removeFromLibraryAction({ gameId: GAME_ID })).resolves.toEqual({ ok: true });
    mocks.removeFromLibrary.mockRejectedValueOnce(new Error("connection reset"));
    await expect(removeFromLibraryAction({ gameId: GAME_ID })).resolves.toEqual({ ok: false, code: "failed" });
  });
});

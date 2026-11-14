import { beforeEach, describe, expect, it, vi } from "vitest";

// 바깥 경계(세션·DB 풀·IGDB·가져오기·이동·새로고침)만 대체하고 액션 자체의 판단을 시험한다.
const mocks = vi.hoisted(() => ({
  getViewer: vi.fn(),
  setRating: vi.fn(),
  findGameByIgdbId: vi.fn(),
  importIgdbGame: vi.fn(),
  igdbGet: vi.fn(),
  refresh: vi.fn(),
  redirect: vi.fn(),
  appPool: { name: "app-pool" },
  catalogPool: { name: "catalog-pool" },
}));

vi.mock("next/cache", () => ({ refresh: mocks.refresh }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/server/viewer", () => ({ getViewer: mocks.getViewer }));
vi.mock("@/server/db/client", () => ({ appPool: () => mocks.appPool, catalogPool: () => mocks.catalogPool }));
vi.mock("@/server/igdb", () => ({ igdbSource: () => ({ get: mocks.igdbGet }) }));
vi.mock("@/features/games/detail", () => ({ findGameByIgdbId: mocks.findGameByIgdbId }));
vi.mock("@/features/games/import-igdb", () => ({ importIgdbGame: mocks.importIgdbGame }));
// 데이터 계층은 대체하되 오류 클래스는 진짜를 쓴다(액션이 `instanceof`로 구분한다).
vi.mock("@/features/ratings/ratings", async (original) => ({ ...(await original<typeof import("@/features/ratings/ratings")>()), setRating: mocks.setRating }));

import { rateGameAction, rateIgdbGameAction } from "@/features/ratings/actions";
import { GameNotFoundError } from "@/features/ratings/ratings";

const GAME_ID = "123e4567-e89b-42d3-a456-426614174000";
const VIEWER = { user: { id: "auth-user-1", name: "플레이어", email: "player@example.com" }, profile: { id: "223e4567-e89b-42d3-a456-426614174000" } };
const RATER = { authUserId: "auth-user-1", profileId: "223e4567-e89b-42d3-a456-426614174000" };
const STATE = { stars: 3.5, ratingCount: 2, ratingSum: 11 };

/** redirect()가 **정확히** 이 주소로 불렸는지 본다(부분 일치는 다른 주소도 통과시킨다). */
const redirectedTo = (promise: Promise<unknown>, url: string) => expect(promise).rejects.toHaveProperty("message", `NEXT_REDIRECT:${url}`);

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.getViewer.mockResolvedValue(VIEWER);
  mocks.setRating.mockResolvedValue(STATE);
  mocks.redirect.mockImplementation((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  });
});

describe("rateGameAction", () => {
  it("로그인하지 않았으면 아무것도 저장하지 않고 알린다", async () => {
    mocks.getViewer.mockResolvedValue(null);
    await expect(rateGameAction({ gameId: GAME_ID, stars: 4 })).resolves.toEqual({ ok: false, code: "unauthenticated" });
    expect(mocks.setRating).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("세션의 사용자로 저장하고 확정된 상태를 돌려준 뒤 화면을 새로 고친다", async () => {
    await expect(rateGameAction({ gameId: GAME_ID, stars: 3.5 })).resolves.toEqual({ ok: true, ...STATE });
    expect(mocks.setRating).toHaveBeenCalledWith(mocks.appPool, RATER, GAME_ID, 3.5);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("클라이언트가 보낸 사용자 ID는 무시하고 세션의 사용자만 쓴다", async () => {
    await rateGameAction({ gameId: GAME_ID, stars: 5, userId: "someone-else", profileId: "323e4567-e89b-42d3-a456-426614174000" });
    expect(mocks.setRating).toHaveBeenCalledWith(mocks.appPool, RATER, GAME_ID, 5);
  });

  it("null은 평가 취소다", async () => {
    mocks.setRating.mockResolvedValue({ stars: null, ratingCount: 1, ratingSum: 4 });
    await expect(rateGameAction({ gameId: GAME_ID, stars: null })).resolves.toEqual({ ok: true, stars: null, ratingCount: 1, ratingSum: 4 });
    expect(mocks.setRating).toHaveBeenCalledWith(mocks.appPool, RATER, GAME_ID, null);
  });

  it.each([
    ["uuid가 아닌 게임 ID", { gameId: "not-a-uuid", stars: 3 }],
    ["게임 ID 없음", { stars: 3 }],
    ["0.5 단위가 아닌 별점", { gameId: GAME_ID, stars: 3.3 }],
    ["범위 밖 별점(0)", { gameId: GAME_ID, stars: 0 }],
    ["범위 밖 별점(5.5)", { gameId: GAME_ID, stars: 5.5 }],
    ["음수 별점", { gameId: GAME_ID, stars: -1 }],
    ["문자열 별점", { gameId: GAME_ID, stars: "5" }],
    ["별점 없음(undefined)", { gameId: GAME_ID }],
    ["NaN", { gameId: GAME_ID, stars: Number.NaN }],
    ["객체가 아닌 입력", "5"],
    ["null 입력", null],
  ])("잘못된 입력은 저장하지 않는다: %s", async (_name, input) => {
    await expect(rateGameAction(input)).resolves.toEqual({ ok: false, code: "invalid" });
    expect(mocks.setRating).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("없는 게임이면 not_found이고 새로 고치지 않는다", async () => {
    mocks.setRating.mockRejectedValue(new GameNotFoundError());
    await expect(rateGameAction({ gameId: GAME_ID, stars: 4 })).resolves.toEqual({ ok: false, code: "not_found" });
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("그 밖의 실패는 일반 오류로만 알리고 입력값은 로그에 남기지 않는다", async () => {
    mocks.setRating.mockRejectedValue(new Error("connection reset"));
    await expect(rateGameAction({ gameId: GAME_ID, stars: 4 })).resolves.toEqual({ ok: false, code: "failed" });
    expect(mocks.refresh).not.toHaveBeenCalled();
    const logged = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(logged).toContain("connection reset");
    expect(logged).not.toContain(GAME_ID);
  });
});

describe("rateIgdbGameAction", () => {
  const DRAFT = { igdbId: 1942, title: "서버가 IGDB에서 읽은 게임" };

  it("로그인하지 않았으면 IGDB도 부르지 않는다", async () => {
    mocks.getViewer.mockResolvedValue(null);
    await expect(rateIgdbGameAction({ igdbId: 1942, stars: 4 })).resolves.toEqual({ ok: false, code: "unauthenticated" });
    expect(mocks.igdbGet).not.toHaveBeenCalled();
    expect(mocks.importIgdbGame).not.toHaveBeenCalled();
  });

  it.each([
    ["IGDB ID 0", { igdbId: 0, stars: 4 }],
    ["음수 IGDB ID", { igdbId: -5, stars: 4 }],
    ["소수 IGDB ID", { igdbId: 1.5, stars: 4 }],
    ["int 범위를 넘는 IGDB ID", { igdbId: 2_147_483_648, stars: 4 }],
    ["문자열 IGDB ID", { igdbId: "1942", stars: 4 }],
    ["취소(null)는 등록되지 않은 게임에는 의미가 없다", { igdbId: 1942, stars: null }],
    ["0.5 단위가 아닌 별점", { igdbId: 1942, stars: 2.2 }],
    ["별점 없음", { igdbId: 1942 }],
  ])("잘못된 입력은 IGDB를 부르거나 가져오지 않는다: %s", async (_name, input) => {
    await expect(rateIgdbGameAction(input)).resolves.toEqual({ ok: false, code: "invalid" });
    expect(mocks.igdbGet).not.toHaveBeenCalled();
    expect(mocks.importIgdbGame).not.toHaveBeenCalled();
    expect(mocks.setRating).not.toHaveBeenCalled();
  });

  it("이미 가져온 게임이면 IGDB를 다시 부르지 않고 평가한 뒤 그 게임 화면으로 보낸다", async () => {
    mocks.findGameByIgdbId.mockResolvedValue({ id: GAME_ID, slug: "already-here" });
    await redirectedTo(rateIgdbGameAction({ igdbId: 1942, stars: 4.5 }), "/games/already-here");
    expect(mocks.findGameByIgdbId).toHaveBeenCalledWith(mocks.appPool, 1942);
    expect(mocks.igdbGet).not.toHaveBeenCalled();
    expect(mocks.importIgdbGame).not.toHaveBeenCalled();
    expect(mocks.setRating).toHaveBeenCalledWith(mocks.appPool, RATER, GAME_ID, 4.5);
  });

  it("처음 평가하면 서버가 IGDB ID로 직접 조회한 메타데이터만 가져오고, 그 게임을 평가한 뒤 이동한다", async () => {
    mocks.findGameByIgdbId.mockResolvedValue(null);
    mocks.igdbGet.mockResolvedValue(DRAFT);
    mocks.importIgdbGame.mockResolvedValue({ id: GAME_ID, slug: "imported-game", created: true });
    // 클라이언트가 메타데이터를 얹어 보내도 가져오기에 쓰이지 않는다.
    await redirectedTo(rateIgdbGameAction({ igdbId: 1942, stars: 5, draft: { title: "클라이언트가 지어낸 제목" } }), "/games/imported-game");
    expect(mocks.igdbGet).toHaveBeenCalledWith(1942);
    expect(mocks.importIgdbGame).toHaveBeenCalledWith(mocks.catalogPool, DRAFT);
    expect(mocks.setRating).toHaveBeenCalledWith(mocks.appPool, RATER, GAME_ID, 5);
  });

  it("IGDB를 부르지 못하면 가져오지도 평가하지도 않고 다시 시도하게 한다", async () => {
    mocks.findGameByIgdbId.mockResolvedValue(null);
    mocks.igdbGet.mockRejectedValue(new Error("IGDB down"));
    await expect(rateIgdbGameAction({ igdbId: 1942, stars: 4 })).resolves.toEqual({ ok: false, code: "unavailable" });
    expect(mocks.importIgdbGame).not.toHaveBeenCalled();
    expect(mocks.setRating).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("IGDB에 없는 ID면 not_found다", async () => {
    mocks.findGameByIgdbId.mockResolvedValue(null);
    mocks.igdbGet.mockResolvedValue(null);
    await expect(rateIgdbGameAction({ igdbId: 1942, stars: 4 })).resolves.toEqual({ ok: false, code: "not_found" });
    expect(mocks.importIgdbGame).not.toHaveBeenCalled();
  });

  it("가져오기가 실패하면 평가하지 않고 이동하지도 않는다", async () => {
    mocks.findGameByIgdbId.mockResolvedValue(null);
    mocks.igdbGet.mockResolvedValue(DRAFT);
    mocks.importIgdbGame.mockRejectedValue(new Error("db write failed"));
    await expect(rateIgdbGameAction({ igdbId: 1942, stars: 4 })).resolves.toEqual({ ok: false, code: "failed" });
    expect(mocks.setRating).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("평가 저장이 실패하면 이동하지 않는다", async () => {
    mocks.findGameByIgdbId.mockResolvedValue({ id: GAME_ID, slug: "already-here" });
    mocks.setRating.mockRejectedValue(new Error("connection reset"));
    await expect(rateIgdbGameAction({ igdbId: 1942, stars: 4 })).resolves.toEqual({ ok: false, code: "failed" });
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

// 바깥 경계(세션·DB 풀·가져오기·이동·새로고침)만 대체하고 액션 자체의 판단을 시험한다.
const mocks = vi.hoisted(() => ({
  getViewer: vi.fn(),
  ensureIgdbGame: vi.fn(),
  saveReview: vi.fn(),
  deleteReview: vi.fn(),
  setReviewLike: vi.fn(),
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
vi.mock("@/features/reviews/reviews", async (original) => ({
  ...(await original<typeof import("@/features/reviews/reviews")>()),
  saveReview: mocks.saveReview,
  deleteReview: mocks.deleteReview,
  setReviewLike: mocks.setReviewLike,
}));

import { deleteReviewAction, saveReviewAction, toggleReviewLikeAction } from "@/features/reviews/actions";
import { GameNotFoundError } from "@/features/ratings/ratings";
import { OwnReviewError, ReviewNotFoundError } from "@/features/reviews/reviews";

const GAME_ID = "123e4567-e89b-42d3-a456-426614174000";
const REVIEW_ID = "423e4567-e89b-42d3-a456-426614174000";
const VIEWER = { user: { id: "auth-user-1", name: "리뷰어", email: "reviewer@example.com" }, profile: { id: "223e4567-e89b-42d3-a456-426614174000" } };
const USER = { authUserId: "auth-user-1", profileId: "223e4567-e89b-42d3-a456-426614174000" };
const GENERIC = "저장하지 못했어요. 잠시 후 다시 시도해 주세요.";
const BODY = "엔딩까지 재미있게 했어요.";

/** redirect()가 **정확히** 이 주소로 불렸는지 본다(부분 일치는 다른 주소도 통과시킨다). */
const redirectedTo = (promise: Promise<unknown>, url: string) => expect(promise).rejects.toHaveProperty("message", `NEXT_REDIRECT:${url}`);

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

const valid = { gameId: GAME_ID, body: BODY, visibility: "public" };

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.getViewer.mockResolvedValue(VIEWER);
  mocks.redirect.mockImplementation((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  });
});

describe("saveReviewAction", () => {
  it("로그인하지 않았으면 아무것도 저장하지 않고 알린다(입력은 돌려준다)", async () => {
    mocks.getViewer.mockResolvedValue(null);
    await expect(saveReviewAction(null, form(valid))).resolves.toEqual({ error: "로그인이 필요해요.", values: { body: BODY, hasSpoiler: false, visibility: "public" } });
    expect(mocks.saveReview).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("세션 확인이 실패해도 액션이 거부되지 않고 일반 문구로 알린다", async () => {
    mocks.getViewer.mockRejectedValue(new Error("auth server unreachable"));
    await expect(saveReviewAction(null, form(valid))).resolves.toMatchObject({ error: GENERIC });
    expect(mocks.saveReview).not.toHaveBeenCalled();
  });

  it("세션의 사용자로 저장하고 화면을 새로 고친다. 클라이언트가 보낸 사용자 ID는 무시한다", async () => {
    mocks.saveReview.mockResolvedValue({});
    const result = await saveReviewAction(null, form({ ...valid, hasSpoiler: "on", visibility: "private", userId: "someone-else", profileId: "323e4567-e89b-42d3-a456-426614174000" }));
    expect(result).toEqual({ saved: true, values: { body: BODY, hasSpoiler: true, visibility: "private" } });
    expect(mocks.saveReview).toHaveBeenCalledWith(mocks.appPool, USER, GAME_ID, { body: BODY, hasSpoiler: true, visibility: "private" });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("폼 값이 올바르지 않으면 저장하지 않고 필드별 오류와 입력을 돌려준다", async () => {
    const result = await saveReviewAction(null, form({ gameId: GAME_ID, body: "   ", visibility: "friends", hasSpoiler: "on" }));
    expect(result).toEqual({
      errors: { body: "리뷰 내용을 입력해 주세요.", visibility: "공개 범위를 골라 주세요." },
      values: { body: "", hasSpoiler: true, visibility: "friends" },
    });
    expect(mocks.saveReview).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it.each([
    ["대상 없음", {}],
    ["uuid가 아닌 gameId", { gameId: "not-a-uuid" }],
    ["숫자가 아닌 igdbId", { igdbId: "abc" }],
    ["0인 igdbId", { igdbId: "0" }],
    ["음수 igdbId", { igdbId: "-4" }],
    ["소수 igdbId", { igdbId: "1.5" }],
    ["범위를 넘는 igdbId", { igdbId: "2147483648" }],
    ["빈 igdbId", { igdbId: "" }],
  ])("저장할 게임을 알 수 없으면 아무것도 하지 않는다: %s", async (_name, target) => {
    await expect(saveReviewAction(null, form({ body: BODY, visibility: "public", ...target }))).resolves.toMatchObject({ error: GENERIC });
    expect(mocks.saveReview).not.toHaveBeenCalled();
    expect(mocks.ensureIgdbGame).not.toHaveBeenCalled();
  });

  it("없는 게임이면 알려 주고, 그 밖의 저장 오류는 일반 문구로 알린다. 로그에는 본문이 남지 않는다", async () => {
    mocks.saveReview.mockRejectedValueOnce(new GameNotFoundError());
    await expect(saveReviewAction(null, form(valid))).resolves.toEqual({ error: "게임을 찾을 수 없어요. 화면을 새로 고쳐 주세요.", values: { body: BODY, hasSpoiler: false, visibility: "public" } });

    mocks.saveReview.mockRejectedValueOnce(new Error("connection terminated"));
    await expect(saveReviewAction(null, form(valid))).resolves.toMatchObject({ error: GENERIC, values: { body: BODY } });
    expect(mocks.refresh).not.toHaveBeenCalled();
    const logged = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(logged).toContain("connection terminated");
    expect(logged).not.toContain(BODY);
  });

  it("gameId와 igdbId가 함께 오면 서비스에 있는 게임(gameId)으로 저장하고 IGDB는 부르지 않는다", async () => {
    mocks.saveReview.mockResolvedValue({});
    await expect(saveReviewAction(null, form({ ...valid, igdbId: "1942" }))).resolves.toMatchObject({ saved: true });
    expect(mocks.saveReview).toHaveBeenCalledWith(mocks.appPool, USER, GAME_ID, expect.anything());
    expect(mocks.ensureIgdbGame).not.toHaveBeenCalled();
  });

  describe("아직 가져오지 않은 IGDB 게임(미리보기)", () => {
    const preview = { igdbId: "1942", body: BODY, visibility: "public" };

    it("처음 쓰는 순간 등록하고 저장한 뒤 등록된 게임 화면으로 이동한다", async () => {
      mocks.ensureIgdbGame.mockResolvedValue({ ok: true, game: { id: GAME_ID, slug: "the-witcher-3" } });
      mocks.saveReview.mockResolvedValue({});
      await redirectedTo(saveReviewAction(null, form(preview)), "/games/the-witcher-3");
      expect(mocks.ensureIgdbGame).toHaveBeenCalledWith(1942);
      expect(mocks.saveReview).toHaveBeenCalledWith(mocks.appPool, USER, GAME_ID, { body: BODY, hasSpoiler: false, visibility: "public" });
    });

    it("폼 값이 올바르지 않으면 게임을 등록하지도 저장하지도 않는다", async () => {
      await expect(saveReviewAction(null, form({ ...preview, body: "" }))).resolves.toMatchObject({ errors: { body: "리뷰 내용을 입력해 주세요." } });
      expect(mocks.ensureIgdbGame).not.toHaveBeenCalled();
      expect(mocks.saveReview).not.toHaveBeenCalled();
    });

    it("IGDB에서 못 가져오면 저장하지 않고 이유를 알린다", async () => {
      mocks.ensureIgdbGame.mockResolvedValueOnce({ ok: false, code: "unavailable" });
      await expect(saveReviewAction(null, form(preview))).resolves.toMatchObject({ error: "게임 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요." });
      mocks.ensureIgdbGame.mockResolvedValueOnce({ ok: false, code: "not_found" });
      await expect(saveReviewAction(null, form(preview))).resolves.toMatchObject({ error: "게임을 찾을 수 없어요." });
      expect(mocks.saveReview).not.toHaveBeenCalled();
      expect(mocks.redirect).not.toHaveBeenCalled();
    });

    it("등록은 됐지만 저장이 실패하면 이동하지 않고 알린다", async () => {
      mocks.ensureIgdbGame.mockResolvedValue({ ok: true, game: { id: GAME_ID, slug: "the-witcher-3" } });
      mocks.saveReview.mockRejectedValue(new Error("db down"));
      await expect(saveReviewAction(null, form(preview))).resolves.toMatchObject({ error: GENERIC });
      expect(mocks.redirect).not.toHaveBeenCalled();
    });
  });
});

describe("deleteReviewAction", () => {
  it("로그인하지 않았으면 아무것도 하지 않는다", async () => {
    mocks.getViewer.mockResolvedValue(null);
    await expect(deleteReviewAction({ gameId: GAME_ID })).resolves.toEqual({ ok: false, code: "unauthenticated" });
    expect(mocks.deleteReview).not.toHaveBeenCalled();
  });

  it("세션 확인이 실패해도 거부되지 않고 failed로 알린다", async () => {
    mocks.getViewer.mockRejectedValue(new Error("auth server unreachable"));
    await expect(deleteReviewAction({ gameId: GAME_ID })).resolves.toEqual({ ok: false, code: "failed" });
  });

  it.each([["uuid가 아닌 ID", { gameId: "not-a-uuid" }], ["ID 없음", {}], ["숫자 ID", { gameId: 5 }], ["객체가 아닌 입력", "x"], ["null", null]])("올바르지 않은 입력은 거절한다: %s", async (_name, input) => {
    await expect(deleteReviewAction(input)).resolves.toEqual({ ok: false, code: "invalid" });
    expect(mocks.deleteReview).not.toHaveBeenCalled();
  });

  it("세션의 사용자로 지우고 화면을 새로 고친다(지울 리뷰가 없어도 성공이다)", async () => {
    mocks.deleteReview.mockResolvedValue(false);
    await expect(deleteReviewAction({ gameId: GAME_ID, userId: "someone-else" })).resolves.toEqual({ ok: true });
    expect(mocks.deleteReview).toHaveBeenCalledWith(mocks.appPool, USER, GAME_ID);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("삭제가 실패하면 failed로 알리고 화면을 새로 고치지 않는다", async () => {
    mocks.deleteReview.mockRejectedValue(new Error("db down"));
    await expect(deleteReviewAction({ gameId: GAME_ID })).resolves.toEqual({ ok: false, code: "failed" });
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});

describe("toggleReviewLikeAction", () => {
  it("로그인하지 않았으면 아무것도 하지 않는다", async () => {
    mocks.getViewer.mockResolvedValue(null);
    await expect(toggleReviewLikeAction({ reviewId: REVIEW_ID, liked: true })).resolves.toEqual({ ok: false, code: "unauthenticated" });
    expect(mocks.setReviewLike).not.toHaveBeenCalled();
  });

  it("세션 확인이 실패해도 거부되지 않고 failed로 알린다", async () => {
    mocks.getViewer.mockRejectedValue(new Error("auth server unreachable"));
    await expect(toggleReviewLikeAction({ reviewId: REVIEW_ID, liked: true })).resolves.toEqual({ ok: false, code: "failed" });
  });

  it.each([
    ["uuid가 아닌 reviewId", { reviewId: "nope", liked: true }],
    ["reviewId 없음", { liked: true }],
    ["liked 없음", { reviewId: REVIEW_ID }],
    ["문자열 liked", { reviewId: REVIEW_ID, liked: "true" }],
    ["숫자 liked", { reviewId: REVIEW_ID, liked: 1 }],
    ["객체가 아닌 입력", "x"],
    ["null", null],
  ])("올바르지 않은 입력은 거절한다: %s", async (_name, input) => {
    await expect(toggleReviewLikeAction(input)).resolves.toEqual({ ok: false, code: "invalid" });
    expect(mocks.setReviewLike).not.toHaveBeenCalled();
  });

  it("세션의 사용자로 누르거나 취소하고 서버가 확정한 상태를 돌려준다. 화면은 다시 그리지 않는다", async () => {
    mocks.setReviewLike.mockResolvedValueOnce({ liked: true, likeCount: 4 }).mockResolvedValueOnce({ liked: false, likeCount: 3 });
    await expect(toggleReviewLikeAction({ reviewId: REVIEW_ID, liked: true, userId: "someone-else" })).resolves.toEqual({ ok: true, liked: true, likeCount: 4 });
    await expect(toggleReviewLikeAction({ reviewId: REVIEW_ID, liked: false })).resolves.toEqual({ ok: true, liked: false, likeCount: 3 });
    expect(mocks.setReviewLike).toHaveBeenNthCalledWith(1, mocks.appPool, USER, REVIEW_ID, true);
    expect(mocks.setReviewLike).toHaveBeenNthCalledWith(2, mocks.appPool, USER, REVIEW_ID, false);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("자기 리뷰는 own_review, 볼 수 없는 리뷰는 not_found, 그 밖의 오류는 failed다", async () => {
    mocks.setReviewLike.mockRejectedValueOnce(new OwnReviewError());
    await expect(toggleReviewLikeAction({ reviewId: REVIEW_ID, liked: true })).resolves.toEqual({ ok: false, code: "own_review" });
    mocks.setReviewLike.mockRejectedValueOnce(new ReviewNotFoundError());
    await expect(toggleReviewLikeAction({ reviewId: REVIEW_ID, liked: true })).resolves.toEqual({ ok: false, code: "not_found" });
    mocks.setReviewLike.mockRejectedValueOnce(new Error("db down"));
    await expect(toggleReviewLikeAction({ reviewId: REVIEW_ID, liked: true })).resolves.toEqual({ ok: false, code: "failed" });
  });
});

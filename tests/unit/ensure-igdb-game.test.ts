import { beforeEach, describe, expect, it, vi } from "vitest";

// 바깥 경계(DB 풀·IGDB·가져오기·이미 가져온 게임 조회)만 대체하고 판단 자체를 시험한다.
const mocks = vi.hoisted(() => ({
  findGameByIgdbId: vi.fn(),
  importIgdbGame: vi.fn(),
  igdbGet: vi.fn(),
  appPool: { name: "app-pool" },
  catalogPool: { name: "catalog-pool" },
}));

vi.mock("@/server/db/client", () => ({ appPool: () => mocks.appPool, catalogPool: () => mocks.catalogPool }));
vi.mock("@/server/igdb", () => ({ igdbSource: () => ({ get: mocks.igdbGet }) }));
vi.mock("@/features/games/detail", () => ({ findGameByIgdbId: mocks.findGameByIgdbId }));
vi.mock("@/features/games/import-igdb", () => ({ importIgdbGame: mocks.importIgdbGame }));

import { ensureIgdbGame } from "@/features/games/ensure-igdb-game";

const DRAFT = { igdbId: 1942, title: "서버가 IGDB에서 읽은 게임" };

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("ensureIgdbGame", () => {
  it("이미 가져온 게임이면 IGDB를 다시 부르지 않고 그 게임을 돌려준다", async () => {
    mocks.findGameByIgdbId.mockResolvedValue({ id: "g1", slug: "already-here" });
    await expect(ensureIgdbGame(1942)).resolves.toEqual({ ok: true, game: { id: "g1", slug: "already-here" } });
    expect(mocks.findGameByIgdbId).toHaveBeenCalledWith(mocks.appPool, 1942);
    expect(mocks.igdbGet).not.toHaveBeenCalled();
    expect(mocks.importIgdbGame).not.toHaveBeenCalled();
  });

  it("처음이면 IGDB ID로 직접 조회한 메타데이터를 catalog 풀로 가져오고 새 게임을 돌려준다", async () => {
    mocks.findGameByIgdbId.mockResolvedValue(null);
    mocks.igdbGet.mockResolvedValue(DRAFT);
    mocks.importIgdbGame.mockResolvedValue({ id: "g2", slug: "imported", created: true });
    await expect(ensureIgdbGame(1942)).resolves.toEqual({ ok: true, game: { id: "g2", slug: "imported" } });
    expect(mocks.igdbGet).toHaveBeenCalledWith(1942);
    expect(mocks.importIgdbGame).toHaveBeenCalledWith(mocks.catalogPool, DRAFT);
  });

  it("IGDB를 부르지 못하면 가져오지 않고 unavailable로 알린다", async () => {
    mocks.findGameByIgdbId.mockResolvedValue(null);
    mocks.igdbGet.mockRejectedValue(new Error("IGDB down"));
    await expect(ensureIgdbGame(1942)).resolves.toEqual({ ok: false, code: "unavailable" });
    expect(mocks.importIgdbGame).not.toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).toContain("IGDB down");
  });

  it("IGDB에 없는 ID면 가져오지 않고 not_found다", async () => {
    mocks.findGameByIgdbId.mockResolvedValue(null);
    mocks.igdbGet.mockResolvedValue(null);
    await expect(ensureIgdbGame(1942)).resolves.toEqual({ ok: false, code: "not_found" });
    expect(mocks.importIgdbGame).not.toHaveBeenCalled();
  });

  it("가져오기(DB) 오류는 삼키지 않고 호출한 쪽으로 올린다", async () => {
    mocks.findGameByIgdbId.mockResolvedValue(null);
    mocks.igdbGet.mockResolvedValue(DRAFT);
    mocks.importIgdbGame.mockRejectedValue(new Error("db write failed"));
    await expect(ensureIgdbGame(1942)).rejects.toThrow("db write failed");
  });

  it("이미 가져온 게임 조회가 실패해도 IGDB를 부르지 않는다(오류를 올린다)", async () => {
    mocks.findGameByIgdbId.mockRejectedValue(new Error("db read failed"));
    await expect(ensureIgdbGame(1942)).rejects.toThrow("db read failed");
    expect(mocks.igdbGet).not.toHaveBeenCalled();
  });
});

import { randomUUID } from "node:crypto";
import { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findSlugByIgdbId, getGameBySlug } from "@/features/games/detail";
import { importIgdbGame } from "@/features/games/import-igdb";
import { withVerifyFull } from "@/server/db/connection";
import type { GameDraft } from "@/server/igdb/mapper";

const appPool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const catalogPool = new Pool({ connectionString: process.env.DATABASE_URL_CATALOG, max: 2 });
const admin = new Client({ connectionString: withVerifyFull(process.env.DATABASE_URL_ADMIN as string) });

const RUN = randomUUID().slice(0, 8);
const PREFIX = `td-${RUN}-`;
let seq = 0;
const next = () => (seq++).toString(36);
const igdbId = () => 900_000_000 + Math.floor(Math.random() * 90_000_000);

const studio = { igdbId: igdbId(), slug: `${PREFIX}studio`, name: "Studio", country: "JP" };
const publisher = { igdbId: igdbId(), slug: `${PREFIX}pub`, name: "Big Publisher", country: "US" };
const platform = { igdbId: igdbId(), slug: `${PREFIX}pl`, name: "Odd Console" };

const draft = (over: Partial<GameDraft> = {}): GameDraft => ({
  igdbId: igdbId(), slug: `${PREFIX}${next()}`, title: "Detail Quest", titleKo: "상세 퀘스트", summary: "요약", releaseDate: "2022-02-25",
  cover: { url: "https://images.example/c.jpg", width: 300, height: 400 }, platforms: [platform],
  genreSlugs: ["rpg", "adventure"], tagSlugs: ["fantasy", "single-player"], developers: [studio], publishers: [publisher, studio], ...over,
});

beforeAll(async () => {
  await admin.connect();
});

afterAll(async () => {
  await admin.query("delete from games where slug like $1", [`${PREFIX}%`]);
  await admin.query("delete from game_companies where slug like $1", [`${PREFIX}%`]);
  await admin.query("delete from platforms where slug like $1", [`${PREFIX}%`]);
  await admin.end();
  await appPool.end();
  await catalogPool.end();
});

describe("getGameBySlug", () => {
  it("게임과 분류·플랫폼·개발사·퍼블리셔를 한 번에 읽는다", async () => {
    const input = draft();
    const { slug } = await importIgdbGame(catalogPool, input);
    const game = await getGameBySlug(appPool, slug);
    expect(game).toMatchObject({
      slug, source: "igdb", title: "Detail Quest", titleKo: "상세 퀘스트", summary: "요약", releaseDate: "2022-02-25",
      coverUrl: "https://images.example/c.jpg", coverWidth: 300, coverHeight: 400, ratingCount: 0, ratingSum: 0,
    });
    expect(game?.genres.map((g) => g.slug)).toEqual(["rpg", "adventure"]); // 장르 ID 순
    expect(game?.tags.map((t) => t.slug).sort()).toEqual(["fantasy", "single-player"]);
    expect(game?.platforms).toEqual([{ slug: platform.slug, name: "Odd Console" }]);
    expect(game?.developers.map((c) => c.name)).toEqual(["Studio"]);
    expect(game?.publishers.map((c) => c.name).sort()).toEqual(["Big Publisher", "Studio"]); // 개발사·퍼블리셔는 별도 목록
  });

  it("회사 이름은 한국어 이름이 있으면 그것을 쓴다", async () => {
    const { slug } = await importIgdbGame(catalogPool, draft());
    await admin.query("update game_companies set name_ko = '스튜디오' where igdb_id = $1", [studio.igdbId]);
    const game = await getGameBySlug(appPool, slug);
    expect(game?.developers.map((c) => c.name)).toEqual(["스튜디오"]);
    expect(game?.publishers.map((c) => c.name)).toContain("Big Publisher");
  });

  it("연결이 없으면 null이 아니라 빈 목록이다", async () => {
    const slug = `${PREFIX}bare-${next()}`;
    await admin.query("insert into games (source, slug, title) values ('manual', $1, 'Bare')", [slug]);
    const game = await getGameBySlug(appPool, slug);
    expect(game).toMatchObject({ source: "manual", titleKo: null, releaseDate: null, coverUrl: null, genres: [], tags: [], platforms: [], developers: [], publishers: [] });
  });

  it("없는 슬러그는 null이다", async () => {
    await expect(getGameBySlug(appPool, `${PREFIX}missing`)).resolves.toBeNull();
  });
});

describe("findSlugByIgdbId", () => {
  it("가져온 게임의 슬러그를 돌려주고, 없으면 null이다", async () => {
    const input = draft();
    const { slug } = await importIgdbGame(catalogPool, input);
    await expect(findSlugByIgdbId(appPool, input.igdbId)).resolves.toBe(slug);
    await expect(findSlugByIgdbId(appPool, igdbId())).resolves.toBeNull();
  });
});

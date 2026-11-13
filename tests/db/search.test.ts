import { randomUUID } from "node:crypto";
import { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PAGE_SIZE, decodeCursor, encodeCursor, escapeLike, popularGames, searchCatalog, searchGames } from "@/features/games/search";
import { withVerifyFull } from "@/server/db/connection";
import type { GameDraft } from "@/server/igdb/mapper";
import type { GameSource } from "@/server/igdb/source";

// 앱과 같은 방식으로 접속한다: RLS가 적용되는 app_user, 풀링 연결. 검색은 비로그인도 쓰는 읽기 전용 경로다.
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
const admin = new Client({ connectionString: withVerifyFull(process.env.DATABASE_URL_ADMIN as string) });

const RUN = randomUUID().slice(0, 8);
const PREFIX = `ts-${RUN}-`;
let seq = 0;
const next = () => (seq++).toString(36);
/** 시험마다 새 토큰을 쓴다. 같은 조각을 공유하면 다른 시험의 행이 trigram 유사도로 함께 검색된다. */
const tok = () => randomUUID().replace(/-/g, "").slice(0, 10);
const igdbId = () => 900_000_000 + Math.floor(Math.random() * 90_000_000);

type GameRow = { title: string; titleKo?: string | null; ratingCount?: number; igdb?: number };

/** 소유자 권한으로 시험용 게임을 만든다. `ratingCount`를 주면 평균이 3점이 되는 합계를 맞춘다. */
async function addGame({ title, titleKo = null, ratingCount = 0, igdb }: GameRow) {
  const { rows } = await admin.query(
    `insert into games (source, external_id, slug, title, title_ko, rating_count, rating_sum)
     values ($1, $2, $3, $4, $5, $6, $7) returning id, slug`,
    [igdb ? "igdb" : "manual", igdb ? String(igdb) : null, `${PREFIX}${next()}`, title, titleKo, ratingCount, ratingCount * 6],
  );
  return rows[0] as { id: string; slug: string };
}

const draft = (title: string, id: number): GameDraft => ({
  igdbId: id, slug: `${PREFIX}draft-${id}`, title, titleKo: null, summary: null, releaseDate: null, cover: null,
  platforms: [], genreSlugs: [], tagSlugs: [], developers: [], publishers: [],
});

beforeAll(async () => {
  await admin.connect();
  await admin.query("delete from games where slug like 'ts-%' and created_at < now() - interval '1 hour'");
});

afterAll(async () => {
  await admin.query("delete from games where slug like $1", [`${PREFIX}%`]);
  await admin.end();
  await pool.end();
});

describe("커서", () => {
  it("인코딩한 커서를 그대로 해석한다", () => {
    const cursor = { score: 2087, ratingCount: 12, id: randomUUID() };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it("int 최댓값의 평가 수는 받아들인다(경계)", () => {
    const cursor = { score: 0, ratingCount: 2_147_483_647, id: randomUUID() };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it("범위를 벗어난 커서로 검색해도 오류 없이 첫 페이지를 돌려준다", async () => {
    const forged = Buffer.from(JSON.stringify([1, 2_147_483_648, randomUUID()])).toString("base64url");
    await expect(popularGames(pool, { cursor: forged })).resolves.toMatchObject({ items: expect.any(Array) });
    await expect(searchGames(pool, `Forged${RUN}`, { cursor: forged })).resolves.toMatchObject({ items: expect.any(Array) });
  });

  it.each([
    ["빈 값", ""],
    ["null", null],
    ["base64가 아닌 값", "%%%"],
    ["JSON이 아닌 값", Buffer.from("not json").toString("base64url")],
    ["타입이 다른 값", Buffer.from(JSON.stringify(["x", 1, randomUUID()])).toString("base64url")],
    ["uuid가 아닌 id", Buffer.from(JSON.stringify([1, 1, "not-a-uuid"])).toString("base64url")],
    ["음수 점수", Buffer.from(JSON.stringify([-1, 1, randomUUID()])).toString("base64url")],
    ["너무 큰 점수", Buffer.from(JSON.stringify([99999, 1, randomUUID()])).toString("base64url")],
    // 평가 수 컬럼은 int라 이보다 큰 값이 쿼리에 들어가면 "out of range" 오류로 끝난다.
    ["int 범위를 넘는 평가 수", Buffer.from(JSON.stringify([1, 2_147_483_648, randomUUID()])).toString("base64url")],
    ["안전하지 않은 정수 평가 수", Buffer.from(JSON.stringify([1, 1e21, randomUUID()])).toString("base64url")],
    ["너무 긴 값", "a".repeat(500)],
  ])("올바르지 않은 커서는 null이다: %s", (_name, value) => {
    expect(decodeCursor(value as string | null)).toBeNull();
  });

  it("LIKE 특수 문자를 이스케이프한다", () => {
    expect(escapeLike("100%_a\\b")).toBe("100\\%\\_a\\\\b");
  });
});

describe("searchGames", () => {
  it("정확히 같은 제목 > 앞부분 일치 > 포함 순으로 보여 준다", async () => {
    const token = `Rank${tok()}`;
    const contains = await addGame({ title: `The Great ${token}`, ratingCount: 50 });
    const prefix = await addGame({ title: `${token} Saga`, ratingCount: 1 });
    const exact = await addGame({ title: token, ratingCount: 0 });
    const { items } = await searchGames(pool, token);
    expect(items.map((i) => i.id).slice(0, 3)).toEqual([exact.id, prefix.id, contains.id]);
  });

  it("대소문자를 가리지 않는다", async () => {
    const t = tok();
    const game = await addGame({ title: `CaseTest${t}` });
    const { items } = await searchGames(pool, `casetest${t.toUpperCase()}`);
    expect(items.map((i) => i.id)).toContain(game.id);
  });

  it("한국어 제목으로도 찾는다(정확·부분 일치)", async () => {
    const t = tok();
    const game = await addGame({ title: `Korean ${t}`, titleKo: `슈퍼${t}모험` });
    for (const text of [`슈퍼${t}모험`, `슈퍼${t}`, `${t}모험`]) {
      const { items } = await searchGames(pool, text);
      expect(items.map((i) => i.id), text).toContain(game.id);
    }
  });

  it("%·_는 글자 그대로 찾고 모든 게임에 일치하지 않는다", async () => {
    await addGame({ title: `Esc${RUN} 100% done` });
    await addGame({ title: `Esc${RUN}_under` });
    const percent = await searchGames(pool, "%");
    expect(percent.items.length).toBeGreaterThan(0);
    for (const item of percent.items) expect(`${item.title} ${item.titleKo ?? ""}`).toContain("%");
    const underscore = await searchGames(pool, "_");
    for (const item of underscore.items) expect(`${item.title} ${item.titleKo ?? ""}`).toContain("_");
  });

  it("따옴표·세미콜론이 든 입력도 안전하게 처리한다(SQL 인젝션 없음)", async () => {
    const before = (await admin.query("select count(*)::int as n from games")).rows[0].n;
    await expect(searchGames(pool, `x'; drop table games; --`)).resolves.toMatchObject({ items: expect.any(Array) });
    expect((await admin.query("select count(*)::int as n from games")).rows[0].n).toBeGreaterThanOrEqual(before);
  });

  it("45건을 20건씩 넘겨도 빠짐·중복 없이 한 번에 가져온 순서와 같다", async () => {
    const token = `Page${tok()}`;
    for (let i = 0; i < 45; i += 1) await addGame({ title: `${token} ${i}`, ratingCount: (i * 7) % 23 });

    const all = (await searchGames(pool, token, { limit: 50 })).items.map((i) => i.id);
    expect(all).toHaveLength(45);

    const walked: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page = await searchGames(pool, token, { cursor });
      expect(page.items.length).toBeLessThanOrEqual(PAGE_SIZE);
      walked.push(...page.items.map((i) => i.id));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor && pages < 10);

    expect(pages).toBe(3);
    expect(new Set(walked).size).toBe(45);
    expect(walked).toEqual(all);
    expect(cursor).toBeNull();
  });

  it("커서가 올바르지 않으면 첫 페이지를 돌려준다", async () => {
    const token = `Bad${tok()}`;
    await addGame({ title: `${token} one` });
    const first = await searchGames(pool, token);
    const withGarbage = await searchGames(pool, token, { cursor: "garbage" });
    expect(withGarbage.items.map((i) => i.id)).toEqual(first.items.map((i) => i.id));
  });

  it("결과에 대표 장르와 출시일 문자열이 들어간다", async () => {
    const t = tok();
    const game = await addGame({ title: `Genre${t}` });
    await admin.query("update games set release_date = '2022-02-25' where id = $1", [game.id]);
    await admin.query("insert into game_genres (game_id, genre_id) select $1, id from genres where slug = 'rpg'", [game.id]);
    const { items } = await searchGames(pool, `Genre${t}`);
    expect(items[0]).toMatchObject({ id: game.id, genre: "RPG", releaseDate: "2022-02-25" });
  });
});

describe("popularGames", () => {
  it("검색어가 없으면 평가 수 순으로 보여 주고 페이지가 이어진다", async () => {
    await addGame({ title: `Pop${RUN} a`, ratingCount: 9000 });
    await addGame({ title: `Pop${RUN} b`, ratingCount: 9001 });
    const first = await popularGames(pool, { limit: 5 });
    expect(first.items.slice(0, 2).map((i) => i.title)).toEqual([`Pop${RUN} b`, `Pop${RUN} a`]);
    for (let i = 1; i < first.items.length; i += 1) expect(first.items[i - 1].ratingCount).toBeGreaterThanOrEqual(first.items[i].ratingCount);

    const second = await popularGames(pool, { limit: 5, cursor: first.nextCursor });
    const ids = new Set(first.items.map((i) => i.id));
    expect(second.items.every((i) => !ids.has(i.id))).toBe(true);
    await expect(searchGames(pool, "   ")).resolves.toMatchObject({ items: expect.any(Array) }); // 공백만 있으면 인기 게임
  });
});

describe("searchCatalog (내부 결과 + IGDB 후보)", () => {
  const fakeSource = (impl: GameSource["search"]) => ({ search: vi.fn(impl), get: vi.fn() }) as unknown as GameSource & { search: ReturnType<typeof vi.fn> };

  it("이미 가져온 게임은 후보에서 빼고, 아직 없는 것만 미리보기 후보로 보여 준다", async () => {
    const token = `Cand${tok()}`;
    const owned = igdbId();
    await addGame({ title: `${token} Owned`, igdb: owned });
    const source = fakeSource(async () => [draft(`${token} Owned`, owned), draft(`${token} Fresh`, igdbId())]);
    const result = await searchCatalog(pool, source, token);
    expect(result.items.map((i) => i.title)).toEqual([`${token} Owned`]);
    expect(result.candidates.map((c) => c.draft.title)).toEqual([`${token} Fresh`]);
    expect(result.candidates[0].internalSlug).toBeNull();
    expect(result.igdbUnavailable).toBe(false);
  });

  it("내부 검색에는 안 걸리지만 이미 가져온 게임은 내부 슬러그로 연결한다", async () => {
    const token = `Link${tok()}`;
    const owned = igdbId();
    const game = await addGame({ title: `Totally Different ${RUN}`, igdb: owned });
    const source = fakeSource(async () => [draft(`${token} Name`, owned)]);
    const result = await searchCatalog(pool, source, token);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].internalSlug).toBe(game.slug);
  });

  it("IGDB가 실패해도 내부 결과는 그대로 보여 준다(기능 명세 B4)", async () => {
    const token = `Down${tok()}`;
    await addGame({ title: `${token} Local` });
    const source = fakeSource(async () => {
      throw new Error("IGDB down");
    });
    const result = await searchCatalog(pool, source, token);
    expect(result.items.map((i) => i.title)).toEqual([`${token} Local`]);
    expect(result).toMatchObject({ candidates: [], igdbUnavailable: true });
  });

  it("검색어가 없거나 다음 페이지이거나 키가 없으면 IGDB를 부르지 않는다", async () => {
    const source = fakeSource(async () => []);
    await searchCatalog(pool, source, "");
    await searchCatalog(pool, source, "anything", { cursor: encodeCursor({ score: 1, ratingCount: 0, id: randomUUID() }) });
    expect(source.search).not.toHaveBeenCalled();
    await expect(searchCatalog(pool, null, `NoKey${RUN}`)).resolves.toMatchObject({ candidates: [], igdbUnavailable: false });
  });

  it("첫 페이지가 가득 차면 IGDB를 부르지 않는다", async () => {
    const token = `Full${tok()}`;
    for (let i = 0; i < PAGE_SIZE; i += 1) await addGame({ title: `${token} ${i}` });
    const source = fakeSource(async () => [draft("x", igdbId())]);
    const result = await searchCatalog(pool, source, token);
    expect(result.items).toHaveLength(PAGE_SIZE);
    expect(source.search).not.toHaveBeenCalled();
  });
});

import { randomUUID } from "node:crypto";
import { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  gamesByCompany,
  gamesByGenre,
  gamesByTag,
  getCompanyBySlug,
  getGenreBySlug,
  getTagBySlug,
} from "@/features/games/browse";
import { PAGE_SIZE } from "@/features/games/search";
import { withVerifyFull } from "@/server/db/connection";

// 앱과 같은 방식으로 접속한다: RLS가 적용되는 app_user, 풀링 연결. 목록은 비로그인도 쓰는 읽기 전용 경로다.
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
const admin = new Client({ connectionString: withVerifyFull(process.env.DATABASE_URL_ADMIN as string) });

const RUN = randomUUID().slice(0, 8);
const PREFIX = `tb-${RUN}-`;
let seq = 0;
const next = () => (seq++).toString(36);

/** 소유자 권한으로 시험용 게임을 만든다. `ratingCount`를 주면 합계도 맞춘다(평균 3점). */
async function addGame(ratingCount = 0) {
  const { rows } = await admin.query(
    `insert into games (source, slug, title, rating_count, rating_sum) values ('manual', $1, $2, $3, $4) returning id, slug`,
    [`${PREFIX}${next()}`, `Browse ${RUN} ${next()}`, ratingCount, ratingCount * 6],
  );
  return rows[0] as { id: string; slug: string };
}

// 분류와 회사는 시험마다 새로 만들어 서로의 목록에 섞이지 않게 한다(끝나면 지운다).
async function addGenre() {
  const slug = `${PREFIX}g${next()}`;
  const { rows } = await admin.query("insert into genres (slug, name) values ($1, $2) returning id", [slug, `장르 ${slug}`]);
  return { id: rows[0].id as number, slug, name: `장르 ${slug}` };
}
async function addTag() {
  const slug = `${PREFIX}t${next()}`;
  const { rows } = await admin.query("insert into tags (slug, name, source) values ($1, $2, 'manual') returning id", [slug, `태그 ${slug}`]);
  return { id: rows[0].id as number, slug, name: `태그 ${slug}` };
}
async function addCompany(nameKo: string | null = null) {
  const slug = `${PREFIX}c${next()}`;
  const { rows } = await admin.query("insert into game_companies (slug, name, name_ko, country) values ($1, $2, $3, 'JP') returning id", [slug, `Company ${slug}`, nameKo]);
  return { id: rows[0].id as string, slug, name: `Company ${slug}`, nameKo };
}

const link = (table: string, column: string, gameId: string, id: string | number) =>
  admin.query(`insert into ${table} (game_id, ${column}) values ($1, $2)`, [gameId, id]);

beforeAll(async () => {
  await admin.connect();
});

afterAll(async () => {
  // 연결 테이블은 ON DELETE CASCADE로 함께 지워진다.
  await admin.query("delete from games where slug like $1", [`${PREFIX}%`]);
  await admin.query("delete from genres where slug like $1", [`${PREFIX}%`]);
  await admin.query("delete from tags where slug like $1", [`${PREFIX}%`]);
  await admin.query("delete from game_companies where slug like $1", [`${PREFIX}%`]);
  await admin.end();
  await pool.end();
});

describe("장르·태그별 게임 목록", () => {
  it("그 장르의 게임만, 평가 수가 많은 순으로 준다", async () => {
    const genre = await addGenre();
    const [few, many, one] = await Promise.all([addGame(5), addGame(9), addGame(1)]);
    for (const game of [few, many, one]) await link("game_genres", "genre_id", game.id, genre.id);
    await addGame(100); // 평가 수가 가장 많아도 장르에 없으면 나오지 않는다

    const page = await gamesByGenre(pool, genre.slug);
    expect(page.items.map((i) => i.slug)).toEqual([many.slug, few.slug, one.slug]);
    expect(page.nextCursor).toBeNull();
  });

  it("평가 수가 같으면 id 내림차순이라 순서가 매번 같다", async () => {
    const tag = await addTag();
    const games = await Promise.all([addGame(2), addGame(2), addGame(2)]);
    for (const game of games) await link("game_tags", "tag_id", game.id, tag.id);

    const expected = games.toSorted((a, b) => (a.id < b.id ? 1 : -1)).map((g) => g.slug);
    expect((await gamesByTag(pool, tag.slug)).items.map((i) => i.slug)).toEqual(expected);
    expect((await gamesByTag(pool, tag.slug)).items.map((i) => i.slug)).toEqual(expected);
  });

  it("20건씩 끊어 읽어도 겹치거나 빠지는 게임이 없다", async () => {
    const tag = await addTag();
    const total = PAGE_SIZE + 5;
    const games = [];
    for (let i = 0; i < total; i += 1) games.push(await addGame(i % 4));
    for (const game of games) await link("game_tags", "tag_id", game.id, tag.id);

    const first = await gamesByTag(pool, tag.slug);
    expect(first.items).toHaveLength(PAGE_SIZE);
    expect(first.nextCursor).not.toBeNull();
    const second = await gamesByTag(pool, tag.slug, { cursor: first.nextCursor });
    expect(second.items).toHaveLength(5);
    expect(second.nextCursor).toBeNull();

    const slugs = [...first.items, ...second.items].map((i) => i.slug);
    expect(new Set(slugs).size).toBe(total);
    expect(new Set(slugs)).toEqual(new Set(games.map((g) => g.slug)));
    // 두 페이지를 이어 붙인 순서가 전체 정렬(평가 수 내림차순)과 같다.
    const counts = [...first.items, ...second.items].map((i) => i.ratingCount);
    expect(counts).toEqual(counts.toSorted((a, b) => b - a));
  });

  it("게임이 없는 분류와 없는 슬러그는 빈 페이지다", async () => {
    const genre = await addGenre();
    expect(await gamesByGenre(pool, genre.slug)).toEqual({ items: [], nextCursor: null });
    expect(await gamesByGenre(pool, `${PREFIX}missing`)).toEqual({ items: [], nextCursor: null });
    expect(await gamesByTag(pool, `${PREFIX}missing`)).toEqual({ items: [], nextCursor: null });
  });

  it("조작된 커서는 첫 페이지로 취급한다(오류로 끝나지 않는다)", async () => {
    const genre = await addGenre();
    const game = await addGame(3);
    await link("game_genres", "genre_id", game.id, genre.id);
    const forged = Buffer.from(JSON.stringify([0, 2_147_483_648, randomUUID()])).toString("base64url");
    const page = await gamesByGenre(pool, genre.slug, { cursor: forged });
    expect(page.items.map((i) => i.slug)).toEqual([game.slug]);
  });

  it("장르와 태그의 이름과 게임 수를 준다. 없으면 null", async () => {
    const genre = await addGenre();
    const tag = await addTag();
    const [a, b] = await Promise.all([addGame(), addGame()]);
    await link("game_genres", "genre_id", a.id, genre.id);
    await link("game_genres", "genre_id", b.id, genre.id);
    await link("game_tags", "tag_id", a.id, tag.id);

    expect(await getGenreBySlug(pool, genre.slug)).toEqual({ slug: genre.slug, name: genre.name, gameCount: 2 });
    expect(await getTagBySlug(pool, tag.slug)).toEqual({ slug: tag.slug, name: tag.name, gameCount: 1 });
    expect(await getGenreBySlug(pool, `${PREFIX}missing`)).toBeNull();
    expect(await getTagBySlug(pool, `${PREFIX}missing`)).toBeNull();
  });
});

describe("회사별 게임 목록", () => {
  it("개발한 게임과 퍼블리싱한 게임을 구분하고, 둘 다 한 게임은 양쪽에 나온다", async () => {
    const company = await addCompany();
    const [devOnly, pubOnly, both] = await Promise.all([addGame(3), addGame(2), addGame(1)]);
    await link("game_developers", "company_id", devOnly.id, company.id);
    await link("game_publishers", "company_id", pubOnly.id, company.id);
    await link("game_developers", "company_id", both.id, company.id);
    await link("game_publishers", "company_id", both.id, company.id);

    const developed = await gamesByCompany(pool, company.slug, "developer");
    const published = await gamesByCompany(pool, company.slug, "publisher");
    expect(developed.items.map((i) => i.slug)).toEqual([devOnly.slug, both.slug]);
    expect(published.items.map((i) => i.slug)).toEqual([pubOnly.slug, both.slug]);
  });

  it("회사 정보와 개발작·퍼블리싱작 수를 준다. 없으면 null", async () => {
    const company = await addCompany("한국어 이름");
    const [a, b, c] = await Promise.all([addGame(), addGame(), addGame()]);
    await link("game_developers", "company_id", a.id, company.id);
    await link("game_developers", "company_id", b.id, company.id);
    await link("game_publishers", "company_id", b.id, company.id);
    await link("game_publishers", "company_id", c.id, company.id);

    expect(await getCompanyBySlug(pool, company.slug)).toEqual({
      slug: company.slug, name: company.name, nameKo: "한국어 이름", country: "JP", developedCount: 2, publishedCount: 2,
    });
    expect(await getCompanyBySlug(pool, `${PREFIX}missing`)).toBeNull();
    expect(await gamesByCompany(pool, `${PREFIX}missing`, "developer")).toEqual({ items: [], nextCursor: null });
  });

  it("회사 목록도 20건씩 이어 읽는다", async () => {
    const company = await addCompany();
    for (let i = 0; i < PAGE_SIZE + 1; i += 1) await link("game_developers", "company_id", (await addGame(i)).id, company.id);
    const first = await gamesByCompany(pool, company.slug, "developer");
    const second = await gamesByCompany(pool, company.slug, "developer", { cursor: first.nextCursor });
    expect(first.items).toHaveLength(PAGE_SIZE);
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    expect(second.items[0].ratingCount).toBe(0); // 평가 수가 가장 적은 게임이 마지막이다
  });
});

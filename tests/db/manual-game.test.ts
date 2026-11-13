import { randomUUID } from "node:crypto";
import { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MANUAL_GAMES_PER_HOUR, RateLimitError, createManualGame, type ManualGameInput } from "@/features/games/manual";
import { withVerifyFull } from "@/server/db/connection";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
const admin = new Client({ connectionString: withVerifyFull(process.env.DATABASE_URL_ADMIN as string) });

const RUN = randomUUID().slice(0, 8);
const AUTH_LIKE = `test-manual-${RUN}-%`;
let seq = 0;
const next = () => (seq++).toString(36);

type User = { authUserId: string; profileId: string };

async function makeUser(name: string): Promise<User> {
  const authUserId = `test-manual-${RUN}-${name}`;
  const { rows } = await admin.query("insert into profiles (auth_user_id, handle, nickname) values ($1, $2, '테스터') returning id", [
    authUserId,
    `m${RUN}${next()}`,
  ]);
  return { authUserId, profileId: rows[0].id };
}

const input = (over: Partial<ManualGameInput> = {}): ManualGameInput => ({
  title: `Indie ${RUN} ${next()}`, titleKo: null, summary: null, releaseDate: null,
  platformSlugs: [], genreSlugs: [], tagSlugs: [], developers: [], publishers: [], ...over,
});

const count = async (sql: string, params: unknown[] = []) => (await admin.query(sql, params)).rows[0].n as number;

let alice: User;

beforeAll(async () => {
  await admin.connect();
  alice = await makeUser("alice");
});

afterAll(async () => {
  await admin.query("delete from games where created_by in (select id from profiles where auth_user_id like $1)", [AUTH_LIKE]);
  await admin.query("delete from game_companies where slug like $1", [`%${RUN}%`]);
  await admin.query("delete from profiles where auth_user_id like $1", [AUTH_LIKE]);
  await admin.end();
  await pool.end();
});

describe("createManualGame", () => {
  it("게임과 분류·플랫폼·개발사·퍼블리셔를 한 번에 등록한다", async () => {
    const dev = `Tiny Studio ${RUN}`;
    const created = await createManualGame(
      pool,
      alice,
      input({
        title: `My Indie Game ${RUN}`, titleKo: "내 인디 게임", summary: "소개", releaseDate: "2024-05-01",
        genreSlugs: ["rpg", "puzzle"], tagSlugs: ["single-player"], platformSlugs: ["pc", "switch"],
        developers: [dev], publishers: [`Pub House ${RUN}`],
      }),
    );
    expect(created.slug).toBe(`my-indie-game-${RUN}`);

    const game = (await admin.query("select source, external_id, created_by, title_ko, summary, to_char(release_date, 'YYYY-MM-DD') as d, cover_url from games where id = $1", [created.id])).rows[0];
    expect(game).toEqual({ source: "manual", external_id: null, created_by: alice.profileId, title_ko: "내 인디 게임", summary: "소개", d: "2024-05-01", cover_url: null });

    const slugs = async (table: string, join: string) =>
      (await admin.query(`select x.slug from ${table} l join ${join} x on x.id = l.${join === "genres" ? "genre_id" : join === "tags" ? "tag_id" : "platform_id"} where l.game_id = $1 order by 1`, [created.id])).rows.map((r) => r.slug);
    expect(await slugs("game_genres", "genres")).toEqual(["puzzle", "rpg"]);
    expect(await slugs("game_tags", "tags")).toEqual(["single-player"]);
    expect(await slugs("game_platforms", "platforms")).toEqual(["pc", "switch"]);

    const devs = (await admin.query("select c.name, c.igdb_id from game_developers d join game_companies c on c.id = d.company_id where d.game_id = $1", [created.id])).rows;
    const pubs = (await admin.query("select c.name from game_publishers p join game_companies c on c.id = p.company_id where p.game_id = $1", [created.id])).rows;
    expect(devs).toEqual([{ name: dev, igdb_id: null }]); // 새 회사는 IGDB와 무관하다
    expect(pubs.map((r) => r.name)).toEqual([`Pub House ${RUN}`]);
  });

  it("이미 있는 회사는 대소문자·한국어 이름이 달라도 새로 만들지 않고 연결한다", async () => {
    const existing = (await admin.query("insert into game_companies (slug, name, name_ko) values ($1, $2, $3) returning id", [`exists-${RUN}-${next()}`, `Known Co ${RUN}`, `아는회사${RUN}`])).rows[0].id;
    const before = await count("select count(*)::int as n from game_companies");
    const a = await createManualGame(pool, alice, input({ developers: [`known co ${RUN}`] })); // 대소문자만 다름
    const b = await createManualGame(pool, alice, input({ developers: [`아는회사${RUN}`] })); // 한국어 이름
    expect(await count("select count(*)::int as n from game_companies")).toBe(before);
    for (const game of [a, b]) {
      expect(await count("select count(*)::int as n from game_developers where game_id = $1 and company_id = $2", [game.id, existing])).toBe(1);
    }
  });

  it("같은 회사를 개발사이자 퍼블리셔로 적어도 회사는 한 행이다", async () => {
    const name = `Dual Role ${RUN}`;
    const game = await createManualGame(pool, alice, input({ developers: [name, name.toUpperCase()], publishers: [name] }));
    expect(await count("select count(*)::int as n from game_companies where lower(name) = lower($1)", [name])).toBe(1);
    expect(await count("select count(*)::int as n from game_developers where game_id = $1", [game.id])).toBe(1);
    expect(await count("select count(*)::int as n from game_publishers where game_id = $1", [game.id])).toBe(1);
  });

  it("한글 제목은 game-<무작위> 슬러그가 되고, 같은 제목을 또 등록해도 슬러그는 다르다", async () => {
    const a = await createManualGame(pool, alice, input({ title: "한글 게임" }));
    const b = await createManualGame(pool, alice, input({ title: "한글 게임" }));
    expect(a.slug).toMatch(/^game-[0-9a-f]{8}$/);
    expect(b.slug).not.toBe(a.slug);
  });

  it("같은 영문 제목은 접미사를 붙여 슬러그가 겹치지 않는다", async () => {
    const title = `Twin ${RUN}`;
    const a = await createManualGame(pool, alice, input({ title }));
    const b = await createManualGame(pool, alice, input({ title }));
    expect(a.slug).toBe(`twin-${RUN}`);
    expect(b.slug).toMatch(new RegExp(`^twin-${RUN}-[0-9a-f]{4}$`));
  });

  it("목록에 없는 장르·태그·플랫폼 슬러그는 무시한다", async () => {
    const game = await createManualGame(pool, alice, input({ genreSlugs: ["rpg", "no-such-genre"], tagSlugs: ["no-such-tag"], platformSlugs: ["nope"] }));
    expect(await count("select count(*)::int as n from game_genres where game_id = $1", [game.id])).toBe(1);
    expect(await count("select count(*)::int as n from game_tags where game_id = $1", [game.id])).toBe(0);
    expect(await count("select count(*)::int as n from game_platforms where game_id = $1", [game.id])).toBe(0);
  });

  it("한 시간에 등록할 수 있는 수를 넘으면 거절하고, 다른 사용자에게는 영향이 없다", async () => {
    const spammer = await makeUser("spammer");
    for (let i = 0; i < MANUAL_GAMES_PER_HOUR; i += 1) await createManualGame(pool, spammer, input());
    await expect(createManualGame(pool, spammer, input())).rejects.toBeInstanceOf(RateLimitError);
    await expect(createManualGame(pool, alice, input())).resolves.toMatchObject({ slug: expect.any(String) });
  });

  it("같은 사용자가 동시에 보내도 한도를 넘어 등록하지 못한다(확인-후-삽입 경쟁)", async () => {
    // 잠금 없이 세면 동시에 시작한 요청들이 서로의 INSERT를 보지 못해 모두 한도 아래로 보고 통과한다.
    const burst = await makeUser("burst");
    const attempts = MANUAL_GAMES_PER_HOUR + 6;
    const results = await Promise.allSettled(Array.from({ length: attempts }, () => createManualGame(pool, burst, input())));
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(MANUAL_GAMES_PER_HOUR);
    expect(rejected).toHaveLength(6);
    for (const r of rejected) expect(r.reason).toBeInstanceOf(RateLimitError);
    expect(await count("select count(*)::int as n from games where created_by = $1", [burst.profileId])).toBe(MANUAL_GAMES_PER_HOUR);
  });

  it("도중에 실패하면 전부 되돌린다(게임만 남지 않는다)", async () => {
    // 회사 이름이 길이 제약(200자)을 어겨 게임 INSERT 뒤 단계에서 실패한다.
    const title = `Atomic ${RUN}`;
    const user = await makeUser("atomic"); // 앞선 시험이 alice의 시간당 한도를 다 썼으므로 새 사용자로 시험한다
    await expect(
      createManualGame(pool, user, input({ title, developers: [`${RUN}${"x".repeat(250)}`] })),
    ).rejects.toMatchObject({ constraint: "game_companies_name_length" });
    expect(await count("select count(*)::int as n from games where title = $1", [title])).toBe(0);
  });

  it("DB 제약을 어긴 값(범위 밖 출시일)은 거절한다", async () => {
    const user = await makeUser("range");
    await expect(createManualGame(pool, user, input({ releaseDate: "1900-01-01" }))).rejects.toMatchObject({ constraint: "games_release_date_range" });
  });
});

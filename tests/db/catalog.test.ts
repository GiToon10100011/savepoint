import { randomUUID } from "node:crypto";
import { Client, Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withVerifyFull } from "@/server/db/connection";
import { runAsUser } from "@/server/db/with-user";

// 앱과 같은 방식으로 접속한다: app_user(RLS), catalog_writer(IGDB 가져오기 전용). 둘 다 풀링 연결이다.
const appPool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
const catalogPool = new Pool({ connectionString: process.env.DATABASE_URL_CATALOG, max: 2 });
// 준비·정리·검증 전용 소유자 연결(RLS를 거치지 않는다).
const admin = new Client({ connectionString: withVerifyFull(process.env.DATABASE_URL_ADMIN as string) });

const RUN = randomUUID().slice(0, 8);
const SLUG_LIKE = `tc-${RUN}-%`;
const AUTH_LIKE = `test-catalog-${RUN}-%`;
let seq = 0;
const slug = () => `tc-${RUN}-${(seq++).toString(36)}`;
const igdbId = () => String(900_000_000 + Math.floor(Math.random() * 90_000_000));

type Me = { authUserId: string; id: string };

async function makeProfile(name: string): Promise<Me> {
  const authUserId = `test-catalog-${RUN}-${name}`;
  const { rows } = await admin.query("insert into profiles (auth_user_id, handle, nickname) values ($1, $2, '테스터') returning id", [
    authUserId,
    `c${RUN}${(seq++).toString(36)}`,
  ]);
  return { authUserId, id: rows[0].id };
}

/** 소유자 권한으로 IGDB 게임을 만든다(다른 역할의 시험 대상). */
async function adminIgdbGame(title = "Test Game") {
  const { rows } = await admin.query("insert into games (source, external_id, slug, title) values ('igdb', $1, $2, $3) returning id, slug", [
    igdbId(),
    slug(),
    title,
  ]);
  return rows[0] as { id: string; slug: string };
}

const asApp = <T>(me: Me, run: (client: PoolClient) => Promise<T>) =>
  runAsUser(appPool, { authUserId: me.authUserId, profileId: me.id }, (_tx, client) => run(client));

/** app_user가 자기 이름으로 수동 게임을 만든다. */
async function manualGame(me: Me, extra: { title?: string } = {}) {
  const { rows } = await asApp(me, (c) =>
    c.query("insert into games (source, slug, title, created_by) values ('manual', $1, $2, $3) returning id, slug", [
      slug(),
      extra.title ?? "내가 등록한 게임",
      me.id,
    ]),
  );
  return rows[0] as { id: string; slug: string };
}

const denied = { code: "42501" } as const; // 권한 없음 또는 RLS 위반

let alice: Me;
let bob: Me;

beforeAll(async () => {
  await admin.connect();
  // 1시간 넘게 남은 이전 실행의 찌꺼기만 지운다(동시에 도는 다른 실행의 행은 건드리지 않는다).
  await admin.query("delete from games where slug like 'tc-%' and created_at < now() - interval '1 hour'");
  await admin.query("delete from game_companies where slug like 'tc-%' and created_at < now() - interval '1 hour'");
  alice = await makeProfile("alice");
  bob = await makeProfile("bob");
});

afterAll(async () => {
  await admin.query("delete from games where slug like $1", [SLUG_LIKE]);
  await admin.query("delete from game_companies where slug like $1", [SLUG_LIKE]);
  await admin.query("delete from tags where slug like $1", [SLUG_LIKE]);
  await admin.query("delete from platforms where slug like $1", [SLUG_LIKE]);
  await admin.query("delete from profiles where auth_user_id like $1", [AUTH_LIKE]);
  await admin.end();
  await appPool.end();
  await catalogPool.end();
});

describe("시드", () => {
  it("장르 15개가 있다(기능 명세 H절)", async () => {
    const { rows } = await admin.query("select slug from genres order by slug");
    expect(rows.map((r) => r.slug)).toEqual(
      [
        "action", "adventure", "fps", "jrpg", "open-world", "puzzle", "racing", "roguelike",
        "rpg", "simulation", "soulslike", "sports", "strategy", "tps", "visual-novel",
      ].sort(),
    );
  });

  it("기본 플랫폼 8개가 IGDB ID와 함께 있다", async () => {
    const { rows } = await admin.query("select slug, igdb_id from platforms where igdb_id in (6,167,48,130,169,49,39,34) order by igdb_id");
    expect(rows).toHaveLength(8);
    expect(rows.find((r) => r.slug === "pc")?.igdb_id).toBe(6);
  });

  it("일본풍은 manual 태그이고 나머지 시드 태그는 igdb 태그다", async () => {
    const { rows } = await admin.query("select slug, source from tags where slug not like 'tc-%'");
    expect(rows.find((r) => r.slug === "japanese-style")?.source).toBe("manual");
    expect(rows.filter((r) => r.source === "igdb").length).toBeGreaterThanOrEqual(30);
  });
});

describe("읽기는 모두에게 열려 있다", () => {
  it("app_user와 catalog_writer 모두 게임을 읽는다", async () => {
    const game = await adminIgdbGame();
    for (const pool of [appPool, catalogPool]) {
      const { rows } = await pool.query("select id from games where id = $1", [game.id]);
      expect(rows).toHaveLength(1);
    }
  });
});

describe("app_user: 수동 등록", () => {
  it("자기 이름으로 수동 게임을 만들 수 있다", async () => {
    const game = await manualGame(alice);
    const { rows } = await admin.query("select source, external_id, created_by from games where id = $1", [game.id]);
    expect(rows[0]).toEqual({ source: "manual", external_id: null, created_by: alice.id });
  });

  it("남의 이름으로는 만들 수 없다", async () => {
    await expect(
      asApp(alice, (c) => c.query("insert into games (source, slug, title, created_by) values ('manual', $1, 'x', $2)", [slug(), bob.id])),
    ).rejects.toMatchObject(denied);
  });

  it("IGDB 게임은 만들 수 없다", async () => {
    await expect(
      asApp(alice, (c) =>
        c.query("insert into games (source, slug, title, created_by) values ('igdb', $1, 'x', $2)", [slug(), alice.id]),
      ),
    ).rejects.toMatchObject(denied);
  });

  it.each(["rating_count", "rating_sum", "external_id", "metadata_synced_at"])("%s는 INSERT에서 지정할 수 없다(컬럼 권한)", async (column) => {
    const value = column === "external_id" ? "'123'" : column === "metadata_synced_at" ? "now()" : "5";
    await expect(
      asApp(alice, (c) =>
        c.query(`insert into games (source, slug, title, created_by, ${column}) values ('manual', $1, 'x', $2, ${value})`, [slug(), alice.id]),
      ),
    ).rejects.toMatchObject(denied);
  });

  it("자기 게임의 제목은 고칠 수 있고 updated_at이 갱신된다", async () => {
    const game = await manualGame(alice);
    const before = (await admin.query("select updated_at from games where id = $1", [game.id])).rows[0].updated_at as Date;
    const result = await asApp(alice, (c) => c.query("update games set title = '바뀐 제목' where id = $1", [game.id]));
    expect(result.rowCount).toBe(1);
    const after = (await admin.query("select title, updated_at from games where id = $1", [game.id])).rows[0];
    expect(after.title).toBe("바뀐 제목");
    expect(after.updated_at.getTime()).toBeGreaterThan(before.getTime());
  });

  it("남이 등록한 게임과 IGDB 게임은 고칠 수 없다(0행)", async () => {
    const bobs = await manualGame(bob);
    const igdb = await adminIgdbGame("원본 제목");
    for (const target of [bobs.id, igdb.id]) {
      const result = await asApp(alice, (c) => c.query("update games set title = '해킹' where id = $1", [target]));
      expect(result.rowCount).toBe(0);
    }
    expect((await admin.query("select title from games where id = $1", [igdb.id])).rows[0].title).toBe("원본 제목");
  });

  it.each([
    ["slug", "'tc-other'"],
    ["source", "'igdb'"],
    ["created_by", "null"],
    ["rating_count", "3"],
    ["rating_sum", "9"],
    ["external_id", "'1'"],
  ])("자기 게임이라도 %s는 바꿀 수 없다(컬럼 권한)", async (column, value) => {
    const game = await manualGame(alice);
    await expect(asApp(alice, (c) => c.query(`update games set ${column} = ${value} where id = $1`, [game.id]))).rejects.toMatchObject(denied);
  });

  it("삭제할 수 없다", async () => {
    const game = await manualGame(alice);
    await expect(asApp(alice, (c) => c.query("delete from games where id = $1", [game.id]))).rejects.toMatchObject(denied);
  });
});

describe("app_user: 분류·회사·연결", () => {
  it("자기 수동 게임에 장르·태그·플랫폼·개발사·퍼블리셔를 연결하고 지울 수 있다", async () => {
    const game = await manualGame(alice);
    const company = await asApp(alice, (c) =>
      c.query("insert into game_companies (slug, name) values ($1, '내 스튜디오') returning id", [slug()]),
    );
    const companyId = company.rows[0].id;
    await asApp(alice, async (c) => {
      await c.query("insert into game_genres (game_id, genre_id) select $1, id from genres where slug = 'rpg'", [game.id]);
      await c.query("insert into game_tags (game_id, tag_id) select $1, id from tags where slug = 'single-player'", [game.id]);
      await c.query("insert into game_platforms (game_id, platform_id) select $1, id from platforms where slug = 'pc'", [game.id]);
      await c.query("insert into game_developers (game_id, company_id) values ($1, $2)", [game.id, companyId]);
      await c.query("insert into game_publishers (game_id, company_id) values ($1, $2)", [game.id, companyId]);
    });
    // 개발사와 퍼블리셔는 서로 다른 테이블이다: 같은 회사가 양쪽에 따로 연결된다.
    const dev = await admin.query("select count(*)::int as n from game_developers where game_id = $1", [game.id]);
    const pub = await admin.query("select count(*)::int as n from game_publishers where game_id = $1", [game.id]);
    expect([dev.rows[0].n, pub.rows[0].n]).toEqual([1, 1]);

    const removed = await asApp(alice, (c) => c.query("delete from game_genres where game_id = $1", [game.id]));
    expect(removed.rowCount).toBe(1);
  });

  it.each(["game_genres", "game_tags", "game_platforms"])("남의 수동 게임에는 %s를 연결할 수 없다", async (table) => {
    const bobs = await manualGame(bob);
    const sql: Record<string, string> = {
      game_genres: "insert into game_genres (game_id, genre_id) select $1, id from genres limit 1",
      game_tags: "insert into game_tags (game_id, tag_id) select $1, id from tags limit 1",
      game_platforms: "insert into game_platforms (game_id, platform_id) select $1, id from platforms limit 1",
    };
    await expect(asApp(alice, (c) => c.query(sql[table], [bobs.id]))).rejects.toMatchObject(denied);
  });

  it("IGDB 게임에는 연결을 넣을 수도 지울 수도 없다", async () => {
    const igdb = await adminIgdbGame();
    await admin.query("insert into game_genres (game_id, genre_id) select $1, id from genres where slug = 'rpg'", [igdb.id]);
    await expect(
      asApp(alice, (c) => c.query("insert into game_genres (game_id, genre_id) select $1, id from genres where slug = 'action'", [igdb.id])),
    ).rejects.toMatchObject(denied);
    const removed = await asApp(alice, (c) => c.query("delete from game_genres where game_id = $1", [igdb.id]));
    expect(removed.rowCount).toBe(0);
  });

  it("IGDB와 무관한 새 회사와 manual 태그는 만들 수 있다", async () => {
    await asApp(alice, async (c) => {
      await c.query("insert into game_companies (slug, name, name_ko, country) values ($1, 'My Studio', '내 스튜디오', 'KR')", [slug()]);
      await c.query("insert into tags (slug, name, source) values ($1, '내 태그', 'manual')", [slug()]);
    });
  });

  it("IGDB 회사(igdb_id)·igdb 태그·장르·플랫폼은 만들 수 없다", async () => {
    await expect(asApp(alice, (c) => c.query("insert into game_companies (slug, name, igdb_id) values ($1, 'x', 1)", [slug()]))).rejects.toMatchObject(denied);
    await expect(asApp(alice, (c) => c.query("insert into tags (slug, name, source) values ($1, 'x', 'igdb')", [slug()]))).rejects.toMatchObject(denied);
    await expect(asApp(alice, (c) => c.query("insert into genres (slug, name) values ($1, 'x')", [slug()]))).rejects.toMatchObject(denied);
    await expect(asApp(alice, (c) => c.query("insert into platforms (slug, name) values ($1, 'x')", [slug()]))).rejects.toMatchObject(denied);
  });

  it("회사·태그·장르·플랫폼을 고치거나 지울 수 없다", async () => {
    await expect(asApp(alice, (c) => c.query("update genres set name = 'x' where slug = 'rpg'"))).rejects.toMatchObject(denied);
    await expect(asApp(alice, (c) => c.query("delete from tags where slug = 'fantasy'"))).rejects.toMatchObject(denied);
    await expect(asApp(alice, (c) => c.query("update game_companies set name = 'x'"))).rejects.toMatchObject(denied);
  });
});

describe("catalog_writer: IGDB 가져오기", () => {
  const withCatalog = <T>(run: (c: PoolClient) => Promise<T>) =>
    catalogPool.connect().then(async (c) => {
      try {
        return await run(c);
      } finally {
        c.release();
      }
    });

  it("IGDB 게임과 회사·플랫폼을 만들고 연결할 수 있다", async () => {
    await withCatalog(async (c) => {
      const game = await c.query("insert into games (source, external_id, slug, title, metadata_synced_at) values ('igdb', $1, $2, 'Imported', now()) returning id", [igdbId(), slug()]);
      const company = await c.query("insert into game_companies (slug, name, igdb_id, country) values ($1, 'Studio', $2, 'JP') returning id", [slug(), Number(igdbId())]);
      const platform = await c.query("insert into platforms (slug, name, igdb_id) values ($1, 'Odd Console', $2) returning id", [slug(), Number(igdbId())]);
      const gameId = game.rows[0].id;
      await c.query("insert into game_developers (game_id, company_id) values ($1, $2)", [gameId, company.rows[0].id]);
      await c.query("insert into game_publishers (game_id, company_id) values ($1, $2)", [gameId, company.rows[0].id]);
      await c.query("insert into game_platforms (game_id, platform_id) values ($1, $2)", [gameId, platform.rows[0].id]);
      await c.query("insert into game_genres (game_id, genre_id) select $1, id from genres where slug = 'rpg'", [gameId]);
      await c.query("insert into game_tags (game_id, tag_id) select $1, id from tags where slug = 'fantasy'", [gameId]);
    });
  });

  it("수동 게임은 만들 수 없고, 수동 게임에 연결도 못 한다", async () => {
    const manual = await manualGame(alice);
    await expect(
      withCatalog((c) => c.query("insert into games (source, slug, title) values ('manual', $1, 'x')", [slug()])),
    ).rejects.toMatchObject(denied);
    await expect(
      withCatalog((c) => c.query("insert into game_genres (game_id, genre_id) select $1, id from genres limit 1", [manual.id])),
    ).rejects.toMatchObject(denied);
  });

  it("등록자(created_by)를 넣을 수 없다", async () => {
    await expect(
      withCatalog((c) => c.query("insert into games (source, external_id, slug, title, created_by) values ('igdb', $1, $2, 'x', $3)", [igdbId(), slug(), alice.id])),
    ).rejects.toMatchObject(denied);
  });

  it("IGDB가 아닌 회사·플랫폼, 태그, 장르는 만들 수 없다", async () => {
    await expect(withCatalog((c) => c.query("insert into game_companies (slug, name) values ($1, 'x')", [slug()]))).rejects.toMatchObject(denied);
    await expect(withCatalog((c) => c.query("insert into platforms (slug, name) values ($1, 'x')", [slug()]))).rejects.toMatchObject(denied);
    await expect(withCatalog((c) => c.query("insert into tags (slug, name, source) values ($1, 'x', 'igdb')", [slug()]))).rejects.toMatchObject(denied);
    await expect(withCatalog((c) => c.query("insert into genres (slug, name) values ($1, 'x')", [slug()]))).rejects.toMatchObject(denied);
  });

  it("메타데이터는 고칠 수 있지만 슬러그·카운터·출처는 못 바꾼다", async () => {
    const game = await adminIgdbGame("Old");
    const ok = await withCatalog((c) => c.query("update games set title = 'New', summary = 's', metadata_synced_at = now() where id = $1", [game.id]));
    expect(ok.rowCount).toBe(1);
    for (const column of ["slug = 'tc-x'", "rating_count = 1", "source = 'manual'", "external_id = '2'"]) {
      await expect(withCatalog((c) => c.query(`update games set ${column} where id = $1`, [game.id]))).rejects.toMatchObject(denied);
    }
  });

  it("수동 게임은 고칠 수 없다(0행)", async () => {
    const manual = await manualGame(alice, { title: "원본" });
    const result = await withCatalog((c) => c.query("update games set title = '덮어쓰기' where id = $1", [manual.id]));
    expect(result.rowCount).toBe(0);
  });
});

describe("제약", () => {
  const insertIgdb = (over: Record<string, string | number | null>) => {
    const row = { source: "igdb", external_id: igdbId(), slug: slug(), title: "T", ...over };
    const cols = Object.keys(row);
    return admin.query(`insert into games (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")})`, Object.values(row));
  };

  it.each([
    ["예약어 new(수동 등록 경로)", "new"],
    ["IGDB 미리보기 경로 igdb-123", "igdb-123"],
    ["대문자", "Upper-case"],
    ["끝이 하이픈", "ends-with-"],
    ["밑줄", "has_underscore"],
    ["한글", "한글슬러그"],
  ])("슬러그로 쓸 수 없다: %s", async (_name, bad) => {
    await expect(insertIgdb({ slug: bad })).rejects.toMatchObject({ code: "23514", constraint: "games_slug_format" });
  });

  it.each(["a", "doom--1", "the-legend-of-zelda", "igdb-abc", "igdb"])("슬러그로 쓸 수 있다: %s", async (ok) => {
    // 고정 슬러그는 실행 사이에 겹치므로 실행 접두사를 붙여 시험한다. 형식 규칙은 접미 부분에 그대로 적용된다.
    await expect(insertIgdb({ slug: `tc-${RUN}-ok-${ok}` })).resolves.toBeDefined();
  });

  it("출처와 외부 ID·등록자의 조합이 맞아야 한다", async () => {
    await expect(insertIgdb({ external_id: "abc" })).rejects.toMatchObject({ constraint: "games_source_shape" });
    await expect(insertIgdb({ external_id: null })).rejects.toMatchObject({ constraint: "games_source_shape" });
    await expect(insertIgdb({ created_by: alice.id })).rejects.toMatchObject({ constraint: "games_source_shape" });
    await expect(admin.query("insert into games (source, external_id, slug, title) values ('manual', '1', $1, 'x')", [slug()])).rejects.toMatchObject({
      constraint: "games_source_shape",
    });
  });

  it("같은 IGDB 게임은 두 번 넣을 수 없다", async () => {
    const id = igdbId();
    await insertIgdb({ external_id: id });
    await expect(insertIgdb({ external_id: id })).rejects.toMatchObject({ code: "23505", constraint: "games_source_external_id_unique" });
  });

  it("제목·소개·출시일·커버 규칙", async () => {
    await expect(insertIgdb({ title: "" })).rejects.toMatchObject({ constraint: "games_title_length" });
    await expect(insertIgdb({ title: "a".repeat(201) })).rejects.toMatchObject({ constraint: "games_title_length" });
    await expect(insertIgdb({ summary: "a".repeat(5001) })).rejects.toMatchObject({ constraint: "games_summary_length" });
    await expect(insertIgdb({ release_date: "1900-01-01" })).rejects.toMatchObject({ constraint: "games_release_date_range" });
    await expect(insertIgdb({ cover_url: "http://images.example/c.jpg" })).rejects.toMatchObject({ constraint: "games_cover_url_https" });
    await expect(insertIgdb({ cover_width: 100 })).rejects.toMatchObject({ constraint: "games_cover_size" });
    await expect(insertIgdb({ cover_width: 0, cover_height: 10 })).rejects.toMatchObject({ constraint: "games_cover_size" });
    await expect(insertIgdb({ cover_url: "https://images.example/c.jpg", cover_width: 300, cover_height: 400, release_date: "2022-02-25" })).resolves.toBeDefined();
  });

  it("평가 카운터는 평균이 1–10 범위를 벗어나는 값을 가질 수 없다", async () => {
    await expect(insertIgdb({ rating_count: 1, rating_sum: 11 })).rejects.toMatchObject({ constraint: "games_rating_counters" });
    await expect(insertIgdb({ rating_count: 0, rating_sum: 1 })).rejects.toMatchObject({ constraint: "games_rating_counters" });
    await expect(insertIgdb({ rating_count: 2, rating_sum: 1 })).rejects.toMatchObject({ constraint: "games_rating_counters" });
    await expect(insertIgdb({ rating_count: 2, rating_sum: 15 })).resolves.toBeDefined();
  });

  it("게임을 지우면 연결도 함께 지워지고, 등록자가 탈퇴해도 수동 게임은 남는다", async () => {
    const carol = await makeProfile("carol");
    const game = await manualGame(carol);
    await asApp(carol, (c) => c.query("insert into game_genres (game_id, genre_id) select $1, id from genres where slug = 'rpg'", [game.id]));
    await admin.query("delete from profiles where id = $1", [carol.id]);
    const kept = await admin.query("select created_by from games where id = $1", [game.id]);
    expect(kept.rows[0].created_by).toBeNull();

    await admin.query("delete from games where id = $1", [game.id]);
    const links = await admin.query("select count(*)::int as n from game_genres where game_id = $1", [game.id]);
    expect(links.rows[0].n).toBe(0);
  });
});

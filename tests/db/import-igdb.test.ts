import { randomUUID } from "node:crypto";
import { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { importIgdbGame } from "@/features/games/import-igdb";
import { withVerifyFull } from "@/server/db/connection";
import type { DraftCompany, DraftPlatform, GameDraft } from "@/server/igdb/mapper";

// 앱과 같은 방식으로 접속한다: IGDB 가져오기 전용 catalog_writer, 풀링 연결. 동시 가져오기 시험을 위해 연결을 여럿 둔다.
const catalogPool = new Pool({ connectionString: process.env.DATABASE_URL_CATALOG, max: 8 });
const admin = new Client({ connectionString: withVerifyFull(process.env.DATABASE_URL_ADMIN as string) });

const RUN = randomUUID().slice(0, 8);
const PREFIX = `ti-${RUN}-`;
let seq = 0;
const next = () => (seq++).toString(36);
const igdbId = () => 900_000_000 + Math.floor(Math.random() * 90_000_000);

const company = (name: string, over: Partial<DraftCompany> = {}): DraftCompany => ({
  igdbId: igdbId(), slug: `${PREFIX}co-${next()}`, name, country: "JP", ...over,
});
const platform = (name = "Odd Console"): DraftPlatform => ({ igdbId: igdbId(), slug: `${PREFIX}pl-${next()}`, name });

function draft(over: Partial<GameDraft> = {}): GameDraft {
  return {
    igdbId: igdbId(), slug: `${PREFIX}${next()}`, title: "Test Quest", titleKo: "테스트 퀘스트", summary: "요약",
    releaseDate: "2022-02-25", cover: { url: "https://images.example/c.jpg", width: 300, height: 400 },
    platforms: [], genreSlugs: ["rpg", "adventure"], tagSlugs: ["fantasy", "single-player"],
    developers: [], publishers: [], ...over,
  };
}

const count = async (sql: string, params: unknown[] = []) => (await admin.query(sql, params)).rows[0].n as number;
const linkCount = (table: string, gameId: string) => count(`select count(*)::int as n from ${table} where game_id = $1`, [gameId]);

beforeAll(async () => {
  await admin.connect();
  // 1시간 넘게 남은 이전 실행의 찌꺼기만 지운다(동시에 도는 다른 실행의 행은 건드리지 않는다).
  await admin.query("delete from games where slug like 'ti-%' and created_at < now() - interval '1 hour'");
  await admin.query("delete from game_companies where slug like 'ti-%' and created_at < now() - interval '1 hour'");
});

afterAll(async () => {
  const like = `${PREFIX}%`;
  await admin.query("delete from games where slug like $1", [like]);
  await admin.query("delete from game_companies where slug like $1", [like]);
  await admin.query("delete from platforms where slug like $1", [like]);
  await admin.end();
  await catalogPool.end();
});

describe("importIgdbGame", () => {
  it("게임과 개발사·퍼블리셔·플랫폼·장르·태그를 한 번에 넣고 연결한다", async () => {
    const studio = company("Studio");
    const publisher = company("Big Publisher");
    const newPlatform = platform();
    const input = draft({
      developers: [studio],
      publishers: [publisher, studio],
      // 시드에 있는 PC(IGDB ID 6)는 새로 만들지 않고 그 행에 연결해야 한다.
      platforms: [{ igdbId: 6, slug: "win", name: "PC (Microsoft Windows)" }, newPlatform],
    });
    const result = await importIgdbGame(catalogPool, input);
    expect(result).toMatchObject({ slug: input.slug, created: true });

    const game = (await admin.query("select * from games where id = $1", [result.id])).rows[0];
    expect(game).toMatchObject({
      source: "igdb", external_id: String(input.igdbId), title: "Test Quest", title_ko: "테스트 퀘스트",
      cover_url: "https://images.example/c.jpg", cover_width: 300, cover_height: 400, created_by: null,
    });
    expect(game.metadata_synced_at).not.toBeNull();

    const devs = (await admin.query("select c.name from game_developers d join game_companies c on c.id = d.company_id where d.game_id = $1", [result.id])).rows;
    const pubs = (await admin.query("select c.name from game_publishers p join game_companies c on c.id = p.company_id where p.game_id = $1 order by 1", [result.id])).rows;
    expect(devs.map((r) => r.name)).toEqual(["Studio"]);
    expect(pubs.map((r) => r.name)).toEqual(["Big Publisher", "Studio"]); // 같은 회사가 개발사이자 퍼블리셔

    const platforms = (await admin.query("select p.slug from game_platforms gp join platforms p on p.id = gp.platform_id where gp.game_id = $1 order by 1", [result.id])).rows;
    expect(platforms.map((r) => r.slug).sort()).toEqual([newPlatform.slug, "pc"].sort());
    expect(await count("select count(*)::int as n from platforms where igdb_id = 6")).toBe(1);

    const genres = (await admin.query("select g.slug from game_genres gg join genres g on g.id = gg.genre_id where gg.game_id = $1 order by 1", [result.id])).rows;
    const tags = (await admin.query("select t.slug from game_tags gt join tags t on t.id = gt.tag_id where gt.game_id = $1 order by 1", [result.id])).rows;
    expect(genres.map((r) => r.slug)).toEqual(["adventure", "rpg"]);
    expect(tags.map((r) => r.slug)).toEqual(["fantasy", "single-player"]);
  });

  it("같은 게임을 다시 가져오면 새로 만들지 않고 같은 행을 돌려준다(중복 없음)", async () => {
    const input = draft({ developers: [company("Studio")], platforms: [platform()] });
    const first = await importIgdbGame(catalogPool, input);
    const second = await importIgdbGame(catalogPool, input);
    expect(second.id).toBe(first.id);
    expect([first.created, second.created]).toEqual([true, false]);
    expect(await count("select count(*)::int as n from games where source = 'igdb' and external_id = $1", [String(input.igdbId)])).toBe(1);
    for (const table of ["game_genres", "game_tags", "game_platforms", "game_developers"]) {
      expect(await linkCount(table, first.id), table).toBe(table === "game_genres" || table === "game_tags" ? 2 : 1);
    }
  });

  it("같은 게임을 동시에 여러 번 가져와도 한 행만 남는다", async () => {
    const input = draft({ developers: [company("Racer Studio")], publishers: [company("Racer Pub")], platforms: [platform()] });
    const results = await Promise.all(Array.from({ length: 8 }, () => importIgdbGame(catalogPool, input)));
    expect(new Set(results.map((r) => r.id)).size).toBe(1);
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(await count("select count(*)::int as n from games where external_id = $1", [String(input.igdbId)])).toBe(1);
    expect(await linkCount("game_developers", results[0].id)).toBe(1);
    expect(await linkCount("game_genres", results[0].id)).toBe(2);
  });

  it("이미 있는 플랫폼은 다시 가져와도 식별 값을 소모하지 않는다(시퀀스 소진 방지)", async () => {
    // `ON CONFLICT DO NOTHING`도 충돌하기 전에 nextval을 평가해 값을 태운다. 게임마다 같은 플랫폼으로 INSERT를
    // 시도하면 행은 그대로인데 시퀀스만 계속 가서 smallint 시절에는 32,767에서 가져오기가 막혔다.
    const lastValue = async () =>
      Number((await admin.query("select last_value from platforms_id_seq")).rows[0].last_value);
    const shared = platform("Shared Console");
    const first = draft({ platforms: [shared] });
    await importIgdbGame(catalogPool, first); // 새 플랫폼이라 한 번은 소모한다
    const afterFirst = await lastValue();

    for (let i = 0; i < 6; i += 1) {
      await importIgdbGame(catalogPool, draft({ platforms: [shared, { igdbId: 6, slug: "win", name: "PC (Microsoft Windows)" }] })); // 다른 게임, 같은 플랫폼
    }
    await importIgdbGame(catalogPool, first); // 같은 게임을 다시
    expect(await lastValue()).toBe(afterFirst);
    expect(await count("select count(*)::int as n from platforms where igdb_id = $1", [shared.igdbId])).toBe(1);
  });

  it("플랫폼 ID는 integer라 smallint 한도(32,767)를 넘는 값도 받는다", async () => {
    const { rows } = await admin.query(
      `select data_type from information_schema.columns
       where (table_name = 'platforms' and column_name = 'id') or (table_name = 'game_platforms' and column_name = 'platform_id')`,
    );
    expect(rows.map((r) => r.data_type)).toEqual(["integer", "integer"]);
    const seq = await admin.query("select s.seqmax::bigint as max from pg_sequence s join pg_class c on c.oid = s.seqrelid where c.relname = 'platforms_id_seq'");
    expect(Number(seq.rows[0].max)).toBe(2_147_483_647);
  });

  it("다시 가져오면 메타데이터와 연결을 최신으로 바꾸되 슬러그(영구 주소)는 유지한다", async () => {
    const first = draft({ genreSlugs: ["rpg", "adventure"], tagSlugs: ["fantasy"], platforms: [platform()] });
    const created = await importIgdbGame(catalogPool, first);

    const updated = await importIgdbGame(catalogPool, {
      ...first,
      slug: `${PREFIX}changed-${next()}`, // IGDB가 슬러그를 바꿔도 주소는 그대로여야 한다
      title: "Renamed Quest",
      summary: "새 요약",
      genreSlugs: ["action"],
      tagSlugs: [],
      platforms: [],
    });
    expect(updated).toMatchObject({ id: created.id, slug: created.slug, created: false });

    const game = (await admin.query("select title, summary from games where id = $1", [created.id])).rows[0];
    expect(game).toEqual({ title: "Renamed Quest", summary: "새 요약" });
    const genres = (await admin.query("select g.slug from game_genres gg join genres g on g.id = gg.genre_id where gg.game_id = $1", [created.id])).rows;
    expect(genres.map((r) => r.slug)).toEqual(["action"]); // 사라진 장르가 남지 않는다
    expect(await linkCount("game_tags", created.id)).toBe(0);
    expect(await linkCount("game_platforms", created.id)).toBe(0);
  });

  it("같은 IGDB 회사는 한 행으로 합치고 이름을 갱신한다", async () => {
    const shared = company("Old Name");
    const a = await importIgdbGame(catalogPool, draft({ developers: [shared] }));
    const b = await importIgdbGame(catalogPool, draft({ developers: [{ ...shared, name: "New Name" }] }));
    expect(await count("select count(*)::int as n from game_companies where igdb_id = $1", [shared.igdbId])).toBe(1);
    const row = (await admin.query("select name from game_companies where igdb_id = $1", [shared.igdbId])).rows[0];
    expect(row.name).toBe("New Name");
    expect(await linkCount("game_developers", a.id)).toBe(1);
    expect(await linkCount("game_developers", b.id)).toBe(1);
  });

  it("슬러그가 이미 쓰이고 있으면 IGDB ID를 붙여 피한다(수동 게임·수동 회사와 충돌)", async () => {
    const takenGame = `${PREFIX}taken-${next()}`;
    const takenCompany = `${PREFIX}taken-co-${next()}`;
    await admin.query("insert into games (source, slug, title) values ('manual', $1, '수동 게임')", [takenGame]);
    await admin.query("insert into game_companies (slug, name) values ($1, '수동 회사')", [takenCompany]);

    const input = draft({ slug: takenGame, developers: [company("IGDB 회사", { slug: takenCompany })] });
    const result = await importIgdbGame(catalogPool, input);
    expect(result.slug).toBe(`${takenGame}-igdb-${input.igdbId}`);
    const igdbCompany = (await admin.query("select slug from game_companies where igdb_id = $1", [input.developers[0].igdbId])).rows[0];
    expect(igdbCompany.slug).toBe(`${takenCompany}-igdb-${input.developers[0].igdbId}`);

    // 다시 가져와도 같은 슬러그에 머물고 수동 행은 그대로다.
    expect(await importIgdbGame(catalogPool, input)).toMatchObject({ id: result.id, slug: result.slug, created: false });
    expect((await admin.query("select title from games where slug = $1", [takenGame])).rows[0].title).toBe("수동 게임");
  });

  it("도중에 실패하면 전부 되돌린다(반쯤 가져온 게임이 남지 않는다)", async () => {
    // 국가 코드가 형식 제약(대문자 2자)을 어겨 회사 단계에서 실패한다. 게임 INSERT는 그 앞에서 이미 실행됐다.
    const input = draft({ developers: [company("Bad Country", { country: "xx" })] });
    await expect(importIgdbGame(catalogPool, input)).rejects.toMatchObject({ constraint: "game_companies_country_format" });
    expect(await count("select count(*)::int as n from games where external_id = $1", [String(input.igdbId)])).toBe(0);
    expect(await count("select count(*)::int as n from game_companies where igdb_id = $1", [input.developers[0].igdbId])).toBe(0);
  });

  it("실패한 가져오기 뒤에도 풀이 정상이다(연결이 반환된다)", async () => {
    for (let i = 0; i < 12; i += 1) {
      await expect(importIgdbGame(catalogPool, draft({ title: "" }))).rejects.toMatchObject({ constraint: "games_title_length" });
    }
    await expect(importIgdbGame(catalogPool, draft())).resolves.toMatchObject({ created: true });
  });
});

import { randomUUID } from "node:crypto";
import { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { EntryInput } from "@/features/library/entry-form";
import {
  InvalidPlatformError,
  LIBRARY_SORTS,
  NotInLibraryError,
  addToLibrary,
  getLibraryEntry,
  listLibrary,
  removeFromLibrary,
  saveLibraryEntry,
  type LibrarySort,
  type LibraryUser,
} from "@/features/library/library";
import { GameNotFoundError } from "@/features/ratings/ratings";
import { withVerifyFull } from "@/server/db/connection";
import { runAsUser } from "@/server/db/with-user";

// 앱과 같은 방식으로 접속한다: RLS가 적용되는 app_user, 풀링 연결. 동시 등록 시험을 위해 연결을 여럿 둔다.
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 8 });
// 정리·준비 전용 소유자 연결. 등록 시각처럼 앱이 정할 수 없는 값을 시험 데이터로 정하려고 쓴다.
const admin = new Client({ connectionString: withVerifyFull(process.env.DATABASE_URL_ADMIN as string) });

const RUN = randomUUID().slice(0, 8);
const PREFIX = `ls-${RUN}-`;
let seq = 0;
const next = () => (seq++).toString(36);

async function makeUser(): Promise<LibraryUser> {
  const authUserId = `${PREFIX}${next()}`;
  const { rows } = await admin.query("insert into profiles (auth_user_id, handle, nickname) values ($1, $2, '플레이어') returning id", [authUserId, `s${RUN}${next()}`]);
  return { authUserId, profileId: rows[0].id };
}

async function makeGame(title = `Service ${RUN} ${next()}`, titleKo: string | null = null): Promise<string> {
  const { rows } = await admin.query("insert into games (source, slug, title, title_ko) values ('manual', $1, $2, $3) returning id", [`${PREFIX}g${next()}`, title, titleKo]);
  return rows[0].id;
}

async function makePlatform(name: string) {
  const slug = `${PREFIX}p${next()}`;
  const { rows } = await admin.query("insert into platforms (slug, name) values ($1, $2) returning id", [slug, name]);
  return { id: rows[0].id as number, slug, name };
}

const input = (over: Partial<EntryInput> = {}): EntryInput => ({
  status: null, platformId: null, startedOn: null, clearedOn: null, perfectedOn: null,
  playtimeMinutes: null, progressPercent: null, progressText: null, note: null, ...over,
});

const rate = (user: LibraryUser, game: string, value: number) =>
  runAsUser(pool, user, (_t, c) => c.query("insert into game_ratings (user_id, game_id, rating) values ($1, $2, $3)", [user.profileId, game, value]));

beforeAll(async () => {
  await admin.connect();
});

afterAll(async () => {
  await admin.query("delete from games where slug like $1", [`${PREFIX}%`]);
  await admin.query("delete from profiles where auth_user_id like $1", [`${PREFIX}%`]);
  await admin.query("delete from platforms where slug like $1", [`${PREFIX}%`]);
  await admin.end();
  await pool.end();
});

describe("등록·저장·삭제", () => {
  it("라이브러리에 없으면 null이고, 추가하면 상태 미지정 항목이 생긴다", async () => {
    const [user, game] = [await makeUser(), await makeGame()];
    expect(await getLibraryEntry(pool, user, game)).toBeNull();
    const entry = await addToLibrary(pool, user, game);
    expect(entry).toMatchObject({ status: null, platformId: null, startedOn: null, clearedOn: null, progressPercent: null, note: null, lastPlayedOn: null });
    expect(await getLibraryEntry(pool, user, game)).toEqual(entry);
  });

  it("두 번 추가해도 오류 없이 같은 항목이고, 고쳐 둔 값은 그대로다(멱등)", async () => {
    const [user, game] = [await makeUser(), await makeGame()];
    const first = await addToLibrary(pool, user, game);
    await saveLibraryEntry(pool, user, game, input({ status: "playing", progressPercent: 40 }));
    const second = await addToLibrary(pool, user, game);
    expect(second.id).toBe(first.id);
    expect(second).toMatchObject({ status: "playing", progressPercent: 40 });
  });

  it("동시에 여러 번 눌러도 한 항목만 생기고 모두 성공한다", async () => {
    const [user, game] = [await makeUser(), await makeGame()];
    const results = await Promise.all(Array.from({ length: 8 }, () => addToLibrary(pool, user, game)));
    expect(new Set(results.map((r) => r.id)).size).toBe(1);
    expect((await admin.query("select 1 from user_games where user_id = $1 and game_id = $2", [user.profileId, game])).rowCount).toBe(1);
  });

  it("없는 게임이면 GameNotFoundError다", async () => {
    const user = await makeUser();
    await expect(addToLibrary(pool, user, randomUUID())).rejects.toBeInstanceOf(GameNotFoundError);
  });

  it("추가해도 평가는 만들어지지 않는다", async () => {
    const [user, game] = [await makeUser(), await makeGame()];
    await addToLibrary(pool, user, game);
    expect((await admin.query("select 1 from game_ratings where user_id = $1", [user.profileId])).rowCount).toBe(0);
  });

  it("모든 칸을 저장하고 같은 값으로 읽는다(마지막 플레이일은 트리거가 채운다)", async () => {
    const [user, game, platform] = [await makeUser(), await makeGame(), await makePlatform("시험 플랫폼")];
    await addToLibrary(pool, user, game);
    const saved = await saveLibraryEntry(
      pool, user, game,
      input({
        status: "cleared", platformId: platform.id, startedOn: "2026-05-01", clearedOn: "2026-05-20", perfectedOn: "2026-06-01",
        playtimeMinutes: 125, progressPercent: 100, progressText: "엔딩 봄", note: "다음엔 하드 모드\n두 번째 줄",
      }),
    );
    expect(saved).toMatchObject({
      status: "cleared", platformId: platform.id, startedOn: "2026-05-01", clearedOn: "2026-05-20", perfectedOn: "2026-06-01",
      playtimeMinutes: 125, progressPercent: 100, progressText: "엔딩 봄", note: "다음엔 하드 모드\n두 번째 줄",
    });
    expect(saved.lastPlayedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(await getLibraryEntry(pool, user, game)).toEqual(saved);
  });

  it("메모는 고치면 바뀌고, 비우면(null) 지워진다", async () => {
    const [user, game] = [await makeUser(), await makeGame()];
    await addToLibrary(pool, user, game);
    await saveLibraryEntry(pool, user, game, input({ note: "첫 메모" }));
    expect((await saveLibraryEntry(pool, user, game, input({ note: "수정" }))).note).toBe("수정");
    expect((await saveLibraryEntry(pool, user, game, input({ note: null }))).note).toBeNull();
    expect((await admin.query("select 1 from user_game_notes where user_game_id = (select id from user_games where user_id = $1 and game_id = $2)", [user.profileId, game])).rowCount).toBe(0);
  });

  it("상태를 어떤 순서로든 바꿀 수 있고(플레이 예정 → 엔딩 완료 → 관심 있음), 날짜를 지울 수 있다", async () => {
    const [user, game] = [await makeUser(), await makeGame()];
    await addToLibrary(pool, user, game);
    await saveLibraryEntry(pool, user, game, input({ status: "planned" }));
    await saveLibraryEntry(pool, user, game, input({ status: "cleared", startedOn: "2026-01-01", clearedOn: "2026-01-02" }));
    const back = await saveLibraryEntry(pool, user, game, input({ status: "interested" }));
    expect(back).toMatchObject({ status: "interested", startedOn: null, clearedOn: null });
  });

  it("엔딩일·100% 달성일을 기록해도 평가가 자동으로 생기지 않는다", async () => {
    const [user, game] = [await makeUser(), await makeGame()];
    await addToLibrary(pool, user, game);
    await saveLibraryEntry(pool, user, game, input({ status: "perfected", startedOn: "2026-01-01", clearedOn: "2026-02-01", perfectedOn: "2026-03-01" }));
    expect((await admin.query("select 1 from game_ratings where user_id = $1", [user.profileId])).rowCount).toBe(0);
    expect((await admin.query("select rating_count from games where id = $1", [game])).rows[0].rating_count).toBe(0);
  });

  it("라이브러리에 없으면 NotInLibraryError이고 아무것도 만들지 않는다(메모도)", async () => {
    const [user, game] = [await makeUser(), await makeGame()];
    await expect(saveLibraryEntry(pool, user, game, input({ status: "playing", note: "메모" }))).rejects.toBeInstanceOf(NotInLibraryError);
    expect((await admin.query("select 1 from user_games where user_id = $1", [user.profileId])).rowCount).toBe(0);
  });

  it("없는 플랫폼이면 InvalidPlatformError이고 다른 칸도 바뀌지 않는다", async () => {
    const [user, game] = [await makeUser(), await makeGame()];
    await addToLibrary(pool, user, game);
    await saveLibraryEntry(pool, user, game, input({ status: "playing", note: "원래 메모" }));
    await expect(saveLibraryEntry(pool, user, game, input({ status: "dropped", platformId: 2_000_000_000, note: "바뀌면 안 됨" }))).rejects.toBeInstanceOf(InvalidPlatformError);
    expect(await getLibraryEntry(pool, user, game)).toMatchObject({ status: "playing", note: "원래 메모" });
  });

  it("저장 도중 DB 제약에 걸리면 이미 바꾼 칸까지 모두 되돌린다(트랜잭션)", async () => {
    const [user, game] = [await makeUser(), await makeGame()];
    await addToLibrary(pool, user, game);
    await saveLibraryEntry(pool, user, game, input({ status: "playing", note: "원래 메모" }));
    // 상태 UPDATE는 성공하고 메모 INSERT가 2,000자 제약에 걸린다 → 상태도 원래대로여야 한다.
    await expect(saveLibraryEntry(pool, user, game, input({ status: "dropped", note: "가".repeat(2001) }))).rejects.toMatchObject({ code: "23514" });
    expect(await getLibraryEntry(pool, user, game)).toMatchObject({ status: "playing", note: "원래 메모" });
  });

  it("엔딩일이 시작일보다 앞서면 DB가 거절한다(파서를 거치지 않은 값의 마지막 방어선)", async () => {
    const [user, game] = [await makeUser(), await makeGame()];
    await addToLibrary(pool, user, game);
    await expect(saveLibraryEntry(pool, user, game, input({ startedOn: "2026-05-10", clearedOn: "2026-05-09" }))).rejects.toMatchObject({ code: "23514", constraint: "user_games_cleared_after_started" });
  });

  it("삭제하면 항목과 메모가 사라지고 평가는 남는다. 두 번째 삭제는 false다", async () => {
    const [user, game] = [await makeUser(), await makeGame()];
    await addToLibrary(pool, user, game);
    await saveLibraryEntry(pool, user, game, input({ status: "cleared", note: "메모" }));
    await rate(user, game, 9);
    expect(await removeFromLibrary(pool, user, game)).toBe(true);
    expect(await getLibraryEntry(pool, user, game)).toBeNull();
    expect((await admin.query("select 1 from user_game_notes n join user_games ug on ug.id = n.user_game_id where ug.user_id = $1", [user.profileId])).rowCount).toBe(0);
    expect((await admin.query("select rating from game_ratings where user_id = $1 and game_id = $2", [user.profileId, game])).rows).toEqual([{ rating: 9 }]);
    expect(await removeFromLibrary(pool, user, game)).toBe(false);
  });

  it("다른 사용자의 항목은 읽거나 고치거나 지울 수 없다", async () => {
    const [alice, bob, game] = [await makeUser(), await makeUser(), await makeGame()];
    await addToLibrary(pool, alice, game);
    await saveLibraryEntry(pool, alice, game, input({ status: "playing", note: "앨리스의 메모" }));
    expect(await getLibraryEntry(pool, bob, game)).toBeNull(); // 내 항목만 읽는다
    await expect(saveLibraryEntry(pool, bob, game, input({ status: "dropped" }))).rejects.toBeInstanceOf(NotInLibraryError);
    expect(await removeFromLibrary(pool, bob, game)).toBe(false);
    expect(await getLibraryEntry(pool, alice, game)).toMatchObject({ status: "playing", note: "앨리스의 메모" });
  });
});

describe("목록", () => {
  type Seed = {
    title: string;
    status?: string | null;
    platformId?: number | null;
    genre?: string;
    addedAt: string;
    lastPlayedOn?: string | null;
    clearedOn?: string | null;
    rating?: number;
  };

  /** 소유자 권한으로 항목을 만든다: 등록 시각·마지막 플레이일처럼 앱이 정할 수 없는 값을 시험 데이터로 정해야 해서다. */
  async function seed(user: LibraryUser, s: Seed) {
    const game = await makeGame(`List ${RUN} ${next()}`, s.title);
    const { rows } = await admin.query(
      `insert into user_games (user_id, game_id, status, platform_id, added_at, last_played_on, cleared_on)
       values ($1, $2, $3, $4, $5, $6, $7) returning id`,
      [user.profileId, game, s.status ?? null, s.platformId ?? null, s.addedAt, s.lastPlayedOn ?? null, s.clearedOn ?? null],
    );
    if (s.genre) await admin.query("insert into game_genres (game_id, genre_id) select $1, id from genres where slug = $2", [game, s.genre]);
    if (s.rating) await rate(user, game, s.rating);
    return { id: rows[0].id as string, game, ...s };
  }

  /** 끝까지 한 페이지씩 읽어 모은다. 각 페이지의 크기와 id 중복도 함께 확인한다. */
  async function readAll(user: LibraryUser, query: Parameters<typeof listLibrary>[2], limit: number) {
    const ids: string[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 50; guard += 1) {
      const page: Awaited<ReturnType<typeof listLibrary>> = await listLibrary(pool, user, { ...query, limit, cursor });
      expect(page.items.length).toBeLessThanOrEqual(limit);
      ids.push(...page.items.map((i) => i.id));
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    expect(new Set(ids).size, "페이지를 이어 읽을 때 같은 항목이 두 번 나오면 안 된다").toBe(ids.length);
    return ids;
  }

  /** 정렬 기준에 따른 기대 순서(시험 안에서 따로 계산한다). 같은 키는 id 방향으로 가른다. */
  const expectedOrder = (entries: { id: string; key: string | number }[], dir: "desc" | "asc") =>
    entries.toSorted((a, b) => {
      if (a.key !== b.key) return (a.key < b.key ? -1 : 1) * (dir === "desc" ? -1 : 1);
      return (a.id < b.id ? -1 : 1) * (dir === "desc" ? -1 : 1);
    }).map((e) => e.id);

  it("내 항목만 나오고, 별점·플랫폼 이름·상태가 함께 온다", async () => {
    const [me, other] = [await makeUser(), await makeUser()];
    const platform = await makePlatform("내 플랫폼");
    const mine = await seed(me, { title: "가나", status: "playing", platformId: platform.id, addedAt: "2026-01-01T00:00:00Z", rating: 7 });
    await seed(other, { title: "다라", addedAt: "2026-01-02T00:00:00Z" });
    const page = await listLibrary(pool, me);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ id: mine.id, gameId: mine.game, titleKo: "가나", status: "playing", platformName: "내 플랫폼", myRating: 3.5 });
    expect(page.nextCursor).toBeNull();
  });

  it("평가하지 않은 항목의 별점은 null이다", async () => {
    const me = await makeUser();
    await seed(me, { title: "가나", addedAt: "2026-01-01T00:00:00Z" });
    expect((await listLibrary(pool, me)).items[0].myRating).toBeNull();
  });

  describe.each(LIBRARY_SORTS)("%s 정렬", (sort) => {
    it("끝까지 이어 읽어도 겹치거나 빠지는 항목이 없고, 기대한 순서다(같은 값·값 없음 포함)", async () => {
      const me = await makeUser();
      // 같은 날짜·같은 평점·같은 제목이 섞이고 값이 없는 항목이 있어 키가 겹친다. 7개를 3개씩 끊어 읽는다.
      const seeds: Seed[] = [
        { title: "다다", addedAt: "2026-03-01T00:00:00Z", lastPlayedOn: "2026-05-02", clearedOn: "2026-04-01", rating: 8 },
        { title: "가가", addedAt: "2026-03-02T00:00:00Z", lastPlayedOn: "2026-05-02", clearedOn: "2026-04-01", rating: 8 },
        { title: "나나", addedAt: "2026-03-03T00:00:00Z", lastPlayedOn: "2026-05-01", clearedOn: "2026-04-05", rating: 2 },
        { title: "나나", addedAt: "2026-03-03T00:00:00Z", lastPlayedOn: null, clearedOn: null },
        { title: "라라", addedAt: "2026-03-04T00:00:00Z", lastPlayedOn: null, clearedOn: null, rating: 10 },
        { title: "마마", addedAt: "2026-03-05T00:00:00Z", lastPlayedOn: "2026-04-30", clearedOn: null },
        { title: "바바", addedAt: "2026-03-05T00:00:00Z", lastPlayedOn: "2026-05-02", clearedOn: "2026-04-01", rating: 8 },
      ];
      const rows = await Promise.all(seeds.map((s) => seed(me, s)));
      const key = (r: (typeof rows)[number]): string | number =>
        sort === "added" ? new Date(r.addedAt).toISOString()
        : sort === "played" ? (r.lastPlayedOn ?? "1970-01-01")
        : sort === "cleared" ? (r.clearedOn ?? "1970-01-01")
        : sort === "rating" ? (r.rating ?? 0)
        : r.title;
      const expected = expectedOrder(rows.map((r) => ({ id: r.id, key: key(r) })), sort === "title" ? "asc" : "desc");
      expect(await readAll(me, { sort }, 3)).toEqual(expected);
      expect(await readAll(me, { sort }, 50)).toEqual(expected); // 한 페이지로 읽어도 같은 순서
    });
  });

  it("정확히 한 페이지만큼이면 다음 커서가 없고, 하나 더 있으면 커서와 함께 한 건이 남는다", async () => {
    const me = await makeUser();
    for (let i = 0; i < 4; i += 1) await seed(me, { title: `가${i}`, addedAt: `2026-01-0${i + 1}T00:00:00Z` });
    const exact = await listLibrary(pool, me, { limit: 4 });
    expect(exact.items).toHaveLength(4);
    expect(exact.nextCursor).toBeNull();
    const split = await listLibrary(pool, me, { limit: 3 });
    expect(split.items).toHaveLength(3);
    expect(split.nextCursor).not.toBeNull();
    expect((await listLibrary(pool, me, { limit: 3, cursor: split.nextCursor })).items).toHaveLength(1);
  });

  it("긴 한글 제목으로 정렬해도 커서가 버려지지 않아 끝까지 이어 읽힌다", async () => {
    // 제목 200자(한글 3바이트)면 커서가 700자를 넘는다. 상한이 작으면 `더 보기`가 첫 페이지를 되풀이한다.
    const me = await makeUser();
    const base = "가".repeat(195);
    const rows = [];
    for (let i = 0; i < 12; i += 1) rows.push(await seed(me, { title: `${base}${String(i).padStart(2, "0")}한`, addedAt: "2026-01-01T00:00:00Z" }));
    const ids = await readAll(me, { sort: "title" }, 5);
    expect(ids).toEqual(rows.map((r) => r.id)); // 제목 끝의 숫자 순
  });

  describe("필터", () => {
    async function library() {
      const me = await makeUser();
      const pc = await makePlatform("피씨");
      const switchP = await makePlatform("스위치");
      const rows = {
        playing: await seed(me, { title: "가1", status: "playing", platformId: pc.id, genre: "rpg", addedAt: "2026-01-01T00:00:00Z", rating: 8 }),
        planned: await seed(me, { title: "가2", status: "planned", platformId: switchP.id, genre: "puzzle", addedAt: "2026-01-02T00:00:00Z" }),
        cleared: await seed(me, { title: "가3", status: "cleared", platformId: pc.id, genre: "rpg", addedAt: "2026-01-03T00:00:00Z", rating: 5 }),
        perfected: await seed(me, { title: "가4", status: "perfected", addedAt: "2026-01-04T00:00:00Z" }),
        dropped: await seed(me, { title: "가5", status: "dropped", addedAt: "2026-01-05T00:00:00Z" }),
        unset: await seed(me, { title: "가6", status: null, addedAt: "2026-01-06T00:00:00Z", rating: 9 }),
      };
      return { me, pc, switchP, rows };
    }
    const ids = async (me: LibraryUser, query: Parameters<typeof listLibrary>[2]) => (await listLibrary(pool, me, query)).items.map((i) => i.id);

    it("전체는 모두, 상태별은 그 상태만 준다", async () => {
      const { me, rows } = await library();
      expect(await ids(me, { filter: "all" })).toHaveLength(6);
      expect(await ids(me, {})).toHaveLength(6);
      for (const status of ["playing", "planned", "cleared", "perfected", "dropped"] as const) {
        expect(await ids(me, { filter: status }), status).toEqual([rows[status].id]);
      }
      expect(await ids(me, { filter: "interested" })).toEqual([]); // 그 상태가 없으면 비어 있다
    });

    it("상태 미지정은 상태가 없는 항목만 준다", async () => {
      const { me, rows } = await library();
      expect(await ids(me, { filter: "unset" })).toEqual([rows.unset.id]);
    });

    it("평가함은 내가 평가한 게임만 준다(라이브러리 상태와 무관)", async () => {
      const { me, rows } = await library();
      expect((await ids(me, { filter: "rated" })).toSorted()).toEqual([rows.playing.id, rows.cleared.id, rows.unset.id].toSorted());
    });

    it("장르·플랫폼 필터와 조합한다", async () => {
      const { me, pc, switchP, rows } = await library();
      expect((await ids(me, { genre: "rpg" })).toSorted()).toEqual([rows.playing.id, rows.cleared.id].toSorted());
      expect(await ids(me, { genre: "puzzle" })).toEqual([rows.planned.id]);
      expect((await ids(me, { platform: pc.slug })).toSorted()).toEqual([rows.playing.id, rows.cleared.id].toSorted());
      expect(await ids(me, { platform: switchP.slug })).toEqual([rows.planned.id]);
      expect(await ids(me, { genre: "rpg", platform: pc.slug, filter: "cleared" })).toEqual([rows.cleared.id]);
      expect(await ids(me, { genre: "puzzle", platform: pc.slug })).toEqual([]);
    });

    it("없는 장르·플랫폼 슬러그는 빈 목록이다(오류가 아니다)", async () => {
      const { me } = await library();
      expect(await ids(me, { genre: "no-such-genre" })).toEqual([]);
      expect(await ids(me, { platform: "no-such-platform" })).toEqual([]);
    });

    it("필터를 건 채로도 끝까지 이어 읽는다", async () => {
      const me = await makeUser();
      const rows = [];
      for (let i = 0; i < 7; i += 1) rows.push(await seed(me, { title: `나${i}`, status: i % 2 === 0 ? "playing" : "planned", addedAt: `2026-02-0${i + 1}T00:00:00Z` }));
      const playing = rows.filter((_, i) => i % 2 === 0).map((r) => r.id).reverse(); // 최근 등록 순
      expect(await readAll(me, { filter: "playing" }, 2)).toEqual(playing);
    });
  });

  it("조작된 커서나 다른 정렬의 커서는 첫 페이지로 취급한다(오류로 끝나지 않는다)", async () => {
    const me = await makeUser();
    for (let i = 0; i < 3; i += 1) await seed(me, { title: `다${i}`, addedAt: `2026-02-0${i + 1}T00:00:00Z`, lastPlayedOn: "2026-03-01" });
    const first = await listLibrary(pool, me, { sort: "added", limit: 2 });
    const firstIds = first.items.map((i) => i.id);
    const addedCursor = first.nextCursor;
    expect(addedCursor).not.toBeNull();
    const forged = Buffer.from(JSON.stringify(["2026-13-45", randomUUID()])).toString("base64url");
    for (const cursor of [forged, "%%%", addedCursor]) {
      // 마지막 경우는 `added` 커서를 `played` 정렬에 쓴 것이다(키 형식이 달라 버려진다).
      const page = await listLibrary(pool, me, { sort: cursor === addedCursor ? "played" : "added", cursor, limit: 2 });
      expect(page.items.length, String(cursor)).toBe(2);
    }
    // 같은 정렬의 올바른 커서는 이어서 읽는다.
    const second = await listLibrary(pool, me, { sort: "added", limit: 2, cursor: addedCursor });
    expect(second.items.map((i) => i.id).filter((id) => firstIds.includes(id))).toEqual([]);
  });

  it("목록에 없는 정렬·필터 값은 SQL로 흘러가지 않고 기본값으로 읽힌다", async () => {
    const me = await makeUser();
    await seed(me, { title: "가나", addedAt: "2026-01-01T00:00:00Z" });
    // 타입을 우회해 잘못된 값을 넣어도 오류 없이 기본 정렬·전체로 읽힌다.
    const page = await listLibrary(pool, me, { sort: "added; drop table user_games" as unknown as LibrarySort, filter: "x'; drop table user_games;--" as never });
    expect(page.items).toHaveLength(1);
    expect((await admin.query("select 1 from user_games limit 1")).rowCount).toBeGreaterThanOrEqual(0); // 테이블이 그대로 있다
  });
});

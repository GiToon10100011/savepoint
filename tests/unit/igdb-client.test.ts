import { describe, expect, it, vi } from "vitest";
import { IgdbError, createIgdbClient, type IgdbClientOptions } from "@/server/igdb/client";

const SECRET = "sec-ret-value-must-not-leak";

type Call = { url: string; headers: Record<string, string>; body: string; at: number };
type Setup = Partial<IgdbClientOptions> & { api?: (call: Call, apiCallNumber: number) => Response };

/** 가짜 fetch: 토큰 주소는 `tok-N`을 돌려주고, 그 밖의 주소는 `api` 응답(기본 200)을 돌려준다. */
function setup({ api, ...options }: Setup = {}) {
  const calls: Call[] = [];
  const sleeps: number[] = [];
  let tokenNumber = 0;
  const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const call: Call = { url, headers: Object.fromEntries(new Headers(init?.headers).entries()), body: String(init?.body ?? ""), at: Date.now() };
    calls.push(call);
    if (url.includes("id.twitch.tv")) {
      tokenNumber += 1;
      return Response.json({ access_token: `tok-${tokenNumber}`, expires_in: 3600 });
    }
    const apiCalls = calls.filter((c) => !c.url.includes("id.twitch.tv")).length;
    return api ? api(call, apiCalls) : Response.json([{ id: 1 }]);
  });
  const client = createIgdbClient({
    clientId: "cid",
    clientSecret: SECRET,
    fetch: fetchFn as unknown as typeof fetch,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    minIntervalMs: 0,
    ...options,
  });
  const apiCalls = () => calls.filter((c) => !c.url.includes("id.twitch.tv"));
  const tokenCalls = () => calls.filter((c) => c.url.includes("id.twitch.tv"));
  return { client, sleeps, apiCalls, tokenCalls };
}

const status = (code: number, headers?: Record<string, string>) => new Response("{}", { status: code, headers });

describe("토큰", () => {
  it("한 번 받은 토큰을 다음 요청에 다시 쓴다", async () => {
    const { client, apiCalls, tokenCalls } = setup();
    await client.query("games", "fields name;");
    await client.query("games", "fields name;");
    expect(tokenCalls()).toHaveLength(1);
    expect(apiCalls().map((c) => c.headers.authorization)).toEqual(["Bearer tok-1", "Bearer tok-1"]);
    expect(apiCalls()[0].headers["client-id"]).toBe("cid");
  });

  it("동시에 처음 부르는 요청들은 토큰을 한 번만 받는다", async () => {
    const { client, tokenCalls } = setup();
    await Promise.all(Array.from({ length: 5 }, () => client.query("games", "fields name;")));
    expect(tokenCalls()).toHaveLength(1);
  });

  it("만료 직전에 새로 받는다", async () => {
    let clock = 0;
    const { client, apiCalls, tokenCalls } = setup({ now: () => clock });
    await client.query("games", "fields name;");
    clock = 3600 * 1000 - 30_000; // 만료 30초 전: 1분 여유 안이라 새로 받아야 한다
    await client.query("games", "fields name;");
    expect(tokenCalls()).toHaveLength(2);
    expect(apiCalls()[1].headers.authorization).toBe("Bearer tok-2");
  });

  it("401이면 토큰을 새로 받아 한 번만 다시 시도한다", async () => {
    const { client, apiCalls, tokenCalls } = setup({ api: (_c, n) => (n === 1 ? status(401) : Response.json([{ id: 7 }])) });
    await expect(client.query("games", "fields name;")).resolves.toEqual([{ id: 7 }]);
    expect(tokenCalls()).toHaveLength(2);
    expect(apiCalls().map((c) => c.headers.authorization)).toEqual(["Bearer tok-1", "Bearer tok-2"]);
  });

  it("계속 401이면 무한히 반복하지 않고 실패한다", async () => {
    const { client, apiCalls } = setup({ api: () => status(401) });
    await expect(client.query("games", "fields name;")).rejects.toMatchObject({ name: "IgdbError", status: 401 });
    expect(apiCalls()).toHaveLength(2);
  });

  it("토큰 발급이 실패하면 API를 부르지 않고 상태 코드로 실패한다", async () => {
    const fetchFn = vi.fn(async () => status(400));
    const client = createIgdbClient({ clientId: "cid", clientSecret: SECRET, fetch: fetchFn as unknown as typeof fetch, minIntervalMs: 0 });
    await expect(client.query("games", "x")).rejects.toMatchObject({ status: 400 });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

describe("재시도", () => {
  it("429는 지수 백오프로 재시도해 성공하면 결과를 돌려준다", async () => {
    const { client, sleeps, apiCalls } = setup({ api: (_c, n) => (n <= 2 ? status(429) : Response.json([{ id: 3 }])) });
    await expect(client.query("games", "x")).resolves.toEqual([{ id: 3 }]);
    expect(sleeps).toEqual([500, 1000]);
    expect(apiCalls()).toHaveLength(3);
  });

  it("Retry-After가 더 길면 그만큼 기다린다", async () => {
    const { client, sleeps } = setup({ api: (_c, n) => (n === 1 ? status(429, { "retry-after": "3" }) : Response.json([])) });
    await client.query("games", "x");
    expect(sleeps).toEqual([3000]);
  });

  it("재시도 횟수를 넘으면 마지막 상태 코드로 실패한다", async () => {
    const { client, apiCalls, sleeps } = setup({ api: () => status(429), maxRetries: 2 });
    await expect(client.query("games", "x")).rejects.toMatchObject({ status: 429 });
    expect(apiCalls()).toHaveLength(3);
    expect(sleeps).toEqual([500, 1000]);
  });

  it("5xx도 재시도한다", async () => {
    const { client, apiCalls } = setup({ api: (_c, n) => (n === 1 ? status(503) : Response.json([{ id: 1 }])) });
    await expect(client.query("games", "x")).resolves.toEqual([{ id: 1 }]);
    expect(apiCalls()).toHaveLength(2);
  });

  it("그 밖의 4xx(질의 오류 등)는 재시도하지 않는다", async () => {
    const { client, apiCalls, sleeps } = setup({ api: () => status(400) });
    await expect(client.query("games", "x")).rejects.toMatchObject({ status: 400 });
    expect(apiCalls()).toHaveLength(1);
    expect(sleeps).toEqual([]);
  });
});

describe("속도 제한", () => {
  it("동시에 보낸 요청도 최소 간격을 두고 시작한다", async () => {
    const { client, apiCalls } = setup({ minIntervalMs: 30, sleep: undefined });
    await Promise.all(Array.from({ length: 5 }, () => client.query("games", "x")));
    const starts = apiCalls().map((c) => c.at).sort((a, b) => a - b);
    const gaps = starts.slice(1).map((t, i) => t - starts[i]);
    expect(gaps).toHaveLength(4);
    for (const gap of gaps) expect(gap).toBeGreaterThanOrEqual(25); // 타이머 오차 여유
  });

  it("기본 간격은 초당 4건(250ms)이다", async () => {
    const clock = 1_000;
    const { client, sleeps } = setup({ minIntervalMs: undefined, now: () => clock });
    await Promise.all([client.query("games", "x"), client.query("games", "x"), client.query("games", "x")]);
    // 각 요청은 앞 요청이 시작한 시각을 기준으로 250ms를 기다린다(가짜 시계는 멈춰 있어 둘 다 250).
    expect(sleeps).toEqual([250, 250]);
  });

  it("타이머가 늦게 깨도 앞 요청이 실제로 시작한 시각부터 간격을 둔다(따라붙어 한꺼번에 시작하지 않는다)", async () => {
    // 시작 시각을 미리 예약만 해 두면, 이벤트 루프가 밀려 늦게 깬 뒤 기다리던 요청들이 연달아 시작해 간격이 사라진다.
    let clock = 1_000;
    const timers: { at: number; wake: () => void }[] = [];
    const starts: number[] = [];
    const client = createIgdbClient({
      clientId: "cid",
      clientSecret: SECRET,
      minIntervalMs: 250,
      now: () => clock,
      sleep: (ms) => new Promise<void>((resolve) => timers.push({ at: clock + ms, wake: resolve })),
      fetch: (async (input: RequestInfo | URL) => {
        if (String(input).includes("id.twitch.tv")) return Response.json({ access_token: "tok", expires_in: 3600 });
        starts.push(clock);
        return Response.json([]);
      }) as unknown as typeof fetch,
    });
    const advanceTo = (to: number) => {
      clock = to;
      for (const timer of timers.filter((t) => t.at <= to)) {
        timers.splice(timers.indexOf(timer), 1);
        timer.wake();
      }
    };

    const all = Promise.all([client.query("games", "x"), client.query("games", "x"), client.query("games", "x")]);
    await vi.waitFor(() => expect(starts).toEqual([1_000]));
    advanceTo(2_000); // 1,250에 깼어야 할 타이머가 750ms 늦게 깬다
    await vi.waitFor(() => expect(starts.length).toBeGreaterThanOrEqual(2));
    advanceTo(2_250);
    await all;

    expect(starts).toEqual([1_000, 2_000, 2_250]);
  });

  it("처음 토큰을 기다리는 동안 슬롯을 쓰지 않는다(토큰이 오는 순간 동시 요청이 한꺼번에 나가지 않는다)", async () => {
    // 슬롯을 잡은 뒤에 Twitch 응답을 기다리면 그 시간만큼 간격이 사라져, 첫 요청들이 토큰이 오자마자 연달아 나간다.
    let clock = 1_000;
    const timers: { at: number; wake: () => void }[] = [];
    const starts: number[] = [];
    let releaseToken!: () => void;
    const tokenGate = new Promise<void>((resolve) => {
      releaseToken = resolve;
    });
    const client = createIgdbClient({
      clientId: "cid",
      clientSecret: SECRET,
      minIntervalMs: 250,
      now: () => clock,
      sleep: (ms) => new Promise<void>((resolve) => timers.push({ at: clock + ms, wake: resolve })),
      fetch: (async (input: RequestInfo | URL) => {
        if (String(input).includes("id.twitch.tv")) {
          await tokenGate;
          return Response.json({ access_token: "tok", expires_in: 3600 });
        }
        starts.push(clock);
        return Response.json([]);
      }) as unknown as typeof fetch,
    });
    const advanceTo = (to: number) => {
      clock = to;
      for (const timer of timers.filter((t) => t.at <= to)) {
        timers.splice(timers.indexOf(timer), 1);
        timer.wake();
      }
    };

    const all = Promise.all([client.query("games", "x"), client.query("games", "x")]);
    await new Promise<void>((resolve) => setImmediate(resolve)); // 요청들이 각자 대기(슬롯·토큰)에 들어가게 한다
    advanceTo(1_300); // 토큰 응답이 300ms 걸리는 동안 시계가 흐른다
    releaseToken();
    await vi.waitFor(() => expect(starts.length).toBeGreaterThanOrEqual(1));
    advanceTo(1_550);
    await all;

    expect(starts).toEqual([1_300, 1_550]);
  });
});

describe("비밀", () => {
  it("실패 메시지에 키나 토큰이 들어가지 않는다", async () => {
    const { client } = setup({ api: () => status(500), maxRetries: 0 });
    const error = await client.query("games", "x").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(IgdbError);
    expect(String((error as Error).message)).not.toMatch(/sec-ret|tok-/);

    const tokenFailure = createIgdbClient({
      clientId: "cid",
      clientSecret: SECRET,
      fetch: (async () => status(403)) as unknown as typeof fetch,
      minIntervalMs: 0,
    });
    const tokenError = await tokenFailure.query("games", "x").catch((e: unknown) => e);
    expect(String((tokenError as Error).message)).not.toContain(SECRET);
  });
});

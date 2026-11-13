/**
 * IGDB(Twitch) API 클라이언트. 키를 읽는 일은 `index.ts`(server-only)가 맡고, 여기는 `fetch`와 시계를 받는
 * 순수한 팩토리라 네트워크 없이 시험한다.
 *
 * - 앱 토큰(client credentials)을 메모리에 캐시하고 만료 직전에 갱신한다. 동시에 처음 부르는 요청은 한 번만 받아 온다.
 * - 초당 4건 제한(문서)을 응답 헤더가 아니라 클라이언트에서 지킨다: 요청 시작 시각을 최소 간격으로 줄 세운다.
 * - 429·5xx는 지수 백오프로 재시도하고, 401은 토큰을 새로 받아 한 번만 다시 시도한다.
 */

const TOKEN_URL = "https://id.twitch.tv/oauth2/token";
const API_URL = "https://api.igdb.com/v4";

/** IGDB 호출 실패. 메시지에는 상태 코드만 담고 키·토큰은 절대 넣지 않는다. */
export class IgdbError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "IgdbError";
  }
}

export type IgdbClientOptions = {
  clientId: string;
  clientSecret: string;
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** 요청 시작 사이의 최소 간격. 기본 250ms(초당 4건). */
  minIntervalMs?: number;
  /** 429·5xx 재시도 횟수(처음 시도 제외). 기본 3. */
  maxRetries?: number;
  /** 백오프의 기본값. 시도마다 두 배가 된다. 기본 500ms. */
  baseBackoffMs?: number;
};

export type IgdbClient = {
  /** Apicalypse 질의를 보내 JSON 배열을 돌려준다. `endpoint`는 `games` 같은 이름이다. */
  query<T>(endpoint: string, body: string): Promise<T[]>;
};

const TOKEN_SKEW_MS = 60_000; // 만료 1분 전에 갱신한다
const MAX_BACKOFF_MS = 10_000;

export function createIgdbClient(options: IgdbClientOptions): IgdbClient {
  const { clientId, clientSecret } = options;
  const doFetch = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const minInterval = options.minIntervalMs ?? 250;
  const maxRetries = options.maxRetries ?? 3;
  const baseBackoff = options.baseBackoffMs ?? 500;

  let token: { value: string; expiresAt: number } | null = null;
  let tokenRequest: Promise<string> | null = null;
  // 직전 요청이 실제로 시작한 시각. 호출 순서대로 이어 붙여 줄을 세운다.
  let previousStart: Promise<number> = Promise.resolve(Number.NEGATIVE_INFINITY);

  async function fetchToken(): Promise<string> {
    const response = await doFetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: "client_credentials" }),
    });
    if (!response.ok) throw new IgdbError(`Twitch 토큰 발급 실패(HTTP ${response.status})`, response.status);
    const data = (await response.json().catch(() => null)) as { access_token?: string; expires_in?: number } | null;
    if (!data?.access_token || typeof data.expires_in !== "number") throw new IgdbError("Twitch 토큰 응답 형식이 다르다", 502);
    token = { value: data.access_token, expiresAt: now() + data.expires_in * 1000 - TOKEN_SKEW_MS };
    return token.value;
  }

  function getToken(): Promise<string> {
    if (token && now() < token.expiresAt) return Promise.resolve(token.value);
    // 동시에 처음 부르는 요청이 토큰을 여러 번 받지 않게 진행 중인 요청을 함께 기다린다.
    tokenRequest ??= fetchToken().finally(() => {
      tokenRequest = null;
    });
    return tokenRequest;
  }

  /**
   * 요청 시작 사이에 `minInterval` 이상을 둔다. 호출 순서대로 줄을 서고, 앞 요청이 **실제로 시작한 시각**을 기준으로
   * 기다린다. 시작 시각을 미리 예약만 하면 이벤트 루프가 밀려 타이머가 늦게 깰 때 뒤 요청들이 따라붙어 연달아 시작한다.
   */
  async function waitForSlot(): Promise<void> {
    const before = previousStart;
    let markStarted!: (at: number) => void;
    previousStart = new Promise<number>((resolve) => {
      markStarted = resolve;
    });
    try {
      const wait = (await before) + minInterval - now();
      if (wait > 0) await sleep(wait);
    } finally {
      // sleep이 실패해도 뒤 요청이 영원히 기다리지 않게 항상 시작 시각을 알린다.
      markStarted(now());
    }
  }

  function backoffMs(attempt: number, retryAfter: string | null): number {
    const seconds = Number(retryAfter);
    const hinted = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0;
    return Math.min(Math.max(baseBackoff * 2 ** attempt, hinted), MAX_BACKOFF_MS);
  }

  async function query<T>(endpoint: string, body: string): Promise<T[]> {
    let refreshedToken = false;
    for (let attempt = 0; ; attempt += 1) {
      await waitForSlot();
      const accessToken = await getToken();
      const response = await doFetch(`${API_URL}/${endpoint}`, {
        method: "POST",
        headers: { "Client-ID": clientId, Authorization: `Bearer ${accessToken}`, "content-type": "text/plain" },
        body,
      });

      if (response.ok) return (await response.json()) as T[];

      if (response.status === 401 && !refreshedToken) {
        refreshedToken = true;
        token = null;
        continue;
      }
      const retryable = response.status === 429 || response.status >= 500;
      if (retryable && attempt < maxRetries) {
        await sleep(backoffMs(attempt, response.headers.get("retry-after")));
        continue;
      }
      throw new IgdbError(`IGDB 요청 실패(HTTP ${response.status})`, response.status);
    }
  }

  return { query };
}

# 기술 아키텍처와 구현 계획

- 근거: [기능 명세서](../product/feature-specification.md), [데이터 모델](data-model.md), [REA](../rea/overview.md)
- 저장소는 빈 상태에서 시작했으므로 기존 스택 제약이 없다. 요구사항의 권장 구성에서 **데이터베이스·인증만 Supabase 대신 Neon**으로 바꿨다(사용자 결정).

## 1. 스택

| 영역 | 선택 | 이유 |
|---|---|---|
| 프레임워크 | Next.js 16 (App Router), React 19, TypeScript | 서버 컴포넌트로 읽기를 서버에서 처리하고 Server Action으로 쓰기를 처리한다. 모바일 웹 성능에 유리 |
| 스타일 | Tailwind CSS v4 (CSS-first `@theme`) | 디자인 토큰(CSS 변수)을 Tailwind 테마가 참조하게 해 임의 값 사용을 막는다 |
| DB | Neon Lakebase Postgres, 리전 `aws-ap-southeast-1` | Neon Auth가 AWS만 지원. 한국에서 가장 가까운 AWS 리전. `pg_trgm`, 브랜치(dev/test 분리) 사용 |
| ORM | Drizzle ORM + drizzle-kit | SQL 마이그레이션을 커밋하고, 트리거·RLS는 수동 SQL 마이그레이션으로 관리 |
| 인증 | Neon Auth(Managed Better Auth), `@neon/auth` | 이메일/비밀번호 + Google. 세션은 서버에서 `auth.getSession()` |
| 외부 데이터 | IGDB (서버 전용) | 개발사/퍼블리셔 구분, 장르·키워드, 플랫폼, 커버 제공 |
| 테스트 | Vitest(단위·DB 통합), Playwright(E2E, headless) | 아래 §8 |
| 배포 | Vercel (요청 시) | 기본값. 지금은 로컬 개발 |

선택하지 않은 것: Supabase(사용자가 Neon 선택), Data API/PostgREST(새 앱에는 권장되지 않음, 서버에서 직접 질의), 클라이언트에서 DB 직접 접근.

## 2. 디렉터리 구조

```text
src/
  app/                      # 라우트 (user-flows §2)
    (public)/ (app)/ auth/ api/
  components/
    ui/                     # button, input, card, chip, checkbox, radio, tooltip
    game/                   # game-card, game-rating, game-status
    calendar/               # calendar-grid, calendar-event
    navigation/             # mobile-navigation, desktop-navigation
  features/                 # 기능 단위: 서버 로직 + 전용 컴포넌트
    games/ ratings/ library/ reviews/ calendar/ profiles/ follows/ companies/ feed/
  server/
    db/                     # drizzle 클라이언트, withUser() 트랜잭션 헬퍼, schema/
    igdb/                   # client.ts(토큰·레이트 리밋), mapper.ts, import.ts
    auth.ts                 # createNeonAuth 설정
  styles/                   # tokens.css, typography.css, globals.css
  lib/                      # 날짜·포맷·검증(zod)
drizzle/                    # SQL 마이그레이션 (트리거·RLS 포함)
docs/
tests/                      # unit/, db/, e2e/
```

기능 폴더(`features/*`)가 자기 쿼리·액션·검증을 소유하고, `components/`는 기능에 의존하지 않는 표현 컴포넌트만 둔다.

## 3. 인증과 인가

1. `src/app/api/auth/[...path]/route.ts`가 Neon Auth 핸들러를 노출하고, `src/proxy.ts`가 보호 경로를 막는다. 공개 경로는 `/`(홈만), `/search`, `/games`, `/u`, `/dev`(하위 경로 포함)이고 나머지는 로그인이 필요하다. proxy는 **낙관적 검사**일 뿐이다. 보호 경로에서 로그인하면 원래 경로로 돌아와야 하는데(기능 명세 A1), SDK는 로그인 화면으로 보낼 때 요청의 쿼리만 옮기고 원래 경로는 붙여 주지 않는다. 그래서 `auth.middleware(...)`의 응답을 얇게 감싸 `redirectTo=<원래 경로>`를 덧붙이고(`_rsc` 같은 Next 내부 파라미터는 뺀다), proxy가 통과시킨 오래된 세션을 화면에서 비로그인으로 판정하는 경우를 위해 `requireViewer(returnTo)`도 같은 파라미터를 붙인다. `?redirectTo=`는 `safeRedirectPath`로 거른 사이트 안 경로만 따른다(`//evil.example`·`/\evil.example`·인증 화면은 `/`로 돌린다).
2. 첫 세션에서 `profiles`를 만든다(`ensureProfile`). 닉네임은 가입 때 이름, 핸들은 임시값 `user_xxxxxxxx`다. **핸들 설정 화면은 9단계(프로필)에서 만들고**, 그때까지 내비의 프로필 칸은 `/u/{handle}` 대신 `/account`(내 계정)로 간다.
3. **모든 쓰기는 Server Action**이며 순서는 `세션 확인 → 입력 검증(zod) → withUser({ authUserId, profileId }, tx => …)`다. 첫 로그인처럼 프로필이 아직 없으면 `profileId`는 생략한다.
4. `withUser`는 트랜잭션을 열고 `set_config('app.user_id', <profileId>, true)`와 `set_config('app.auth_user_id', <세션의 auth 사용자 ID>, true)`를 **둘 다** 설정한 뒤 `app_user` 권한으로 질의한다(프로필 생성 시에는 `app.user_id`가 비어 있고 `app.auth_user_id`만 RLS에 쓰인다). 풀링된 연결(트랜잭션 모드)에서도 안전하도록 항상 `is_local = true`를 쓴다.
5. RLS가 두 번째 방어선이다(정책은 [데이터 모델 §5](data-model.md#5-rls-정책)).
6. 비밀 값(`DATABASE_URL`, `NEON_AUTH_COOKIE_SECRET`, IGDB 키)은 서버 환경 변수로만 쓰고 클라이언트 번들에 넣지 않는다. `.env*`는 커밋하지 않는다.
7. **카탈로그 쓰기(IGDB 가져오기)만 예외**로 `catalog_writer` 역할을 쓴다([§4.3](#43-연동-방식)). `app_user`는 게임 메타데이터 테이블을 읽기만 한다(수동 등록 제외).

**인증 구현 메모** (2단계에서 확인한 것)
- **세션은 요청 시점에만 읽는다.** `getSessionUser()`는 `await connection()`으로 시작한다. 프리렌더·프리페치 중에는 인증 서버로 `fetch`할 수 없어 거절되는데, SDK가 그 거절을 오류로 기록해 페이지를 한 번 열 때마다 로그가 찍힌다(E2E 한 번에 41건). 세션을 읽는 컴포넌트는 항상 `<Suspense>` 안에 둔다.
- **서버 SDK의 오류 코드는 정규화돼 온다.** `auth.signIn/signUp`은 Better Auth의 `INVALID_EMAIL_OR_PASSWORD` 같은 코드를 `invalid_credentials` 등 소문자 코드로 바꿔 돌려준다. HTTP로 직접 보면 원래 코드가 보여서 헷갈린다(처음에 그 기준으로 짜서 E2E가 잡아냈다). 또 이미 가입된 이메일(`USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL`)은 SDK 변환표에 없어 `validation_failed`로 뭉개지므로 영어 원문 메시지로 가린다(`src/features/auth/messages.ts`).
- **로그아웃 실패는 알린다.** `auth.signOut()`은 인증 서버에 닿지 못하면 예외 없이 `{ error }`를 돌려주고 세션 쿠키를 지우지 않는다. 그때 홈으로 보내면 세션이 살아 있는데 로그아웃한 것처럼 보이므로(공용 기기에서 위험하다) 이동하지 않고 오류를 보여 준다(`SignOutForm`). `signIn`·`signUp`도 같은 방식으로 `{ error }`를 확인한다.
- **E2E 서버 선택.** 개발 서버는 디렉터리당 하나뿐이라 `npm run dev`가 열려 있으면 Playwright의 기본 서버가 뜨지 못한다. `E2E_SERVER=prod`(운영 빌드로 실행)나 `E2E_BASE_URL`(떠 있는 서버 재사용)을 쓴다. 인증 E2E는 실제 Neon Auth(dev)에 가입하고 끝나면 계정을 지운다.
- **범위 밖(후속).** 구글 로그인(OAuth는 헤드리스로 끝까지 검증할 수 없다)과 비밀번호 재설정 화면은 아직 없다.

## 4. 게임 메타데이터와 외부 API

### 4.1 후보 비교

| 항목 | IGDB | RAWG | Steam |
|---|---|---|---|
| 인증 | Twitch 계정(2FA) 앱 등록 → Client ID/Secret → OAuth2 앱 토큰 | API 키 | 상점 `appdetails`는 키 없음(비공식), Web API는 키 |
| 요청 제한 | **초당 4건**, 동시 8건, 요청당 최대 500건 (2차 자료) | 무료 월 약 2만 건 (2차 자료) | `appdetails` 약 5분 200건(커뮤니티 보고, 공식 문서 없음), Web API 일 10만 건 |
| 상업적 이용 | 자료가 엇갈림. **비상업 무료, 상업은 파트너 계약이 필요하다는 해석이 가장 일관적** | 약관(2021)과 문서 페이지가 엇갈림. 무료 플랜은 **출처 표기 필수** | 약관이 2010년판. 비공식 엔드포인트는 안정성 보장 없음 |
| 개발사·퍼블리셔 | `involved_companies`에 개발/퍼블리셔 구분 | 상세 호출에서 제공 | `appdetails`에서 제공 |
| 장르·태그 | 장르, 테마, 키워드, 플레이어 시점, 게임 모드 | 장르, 태그 | 장르, 카테고리 |
| 플랫폼·출시일 | 제공 | 제공 | PC 위주 |
| 이미지 | 커버·스크린샷 제공 | 제공 | 제공 |
| 한국어 | `game_localizations`로 일부 지원(범위 불명확) | 거의 없음 | 한국어 상점 정보 있음 |

> 위 값은 2026-11-10 웹 검색 결과이며 **공식 약관 원문을 직접 확인하지 못했다**. 공개 서비스로 전환하기 전에 IGDB 문서(api-docs.igdb.com)와 Twitch 개발자 약관, 필요하면 파트너 계약을 확인한다. 출처: [IGDB 상업 이용 논의](https://discuss.dev.twitch.com/t/commercial-use-of-igdb-api/23567), [RAWG 약관](https://rawg.io/tos_api), [RAWG API 문서](https://rawg.io/apidocs), [Steam Web API 약관](https://steamcommunity.com/dev/apiterms).

### 4.2 결정

- **IGDB를 1차 소스로 쓰고 수동 등록을 병행한다.** 개발사/퍼블리셔 구분과 키워드·테마가 데이터 모델과 가장 잘 맞는다.
- 외부 API를 쓸 수 없어도 서비스가 동작해야 하므로 `source = manual`을 1급 경로로 지원한다(기능 B3·B4).
- 이용 조건이 미확정이므로 **어댑터 인터페이스**(`GameSource.search/get`)로 감싸 RAWG 등으로 교체할 수 있게 한다.

### 4.3 연동 방식

- `server/igdb/client.ts`: 앱 토큰을 메모리에 캐시하고 만료 전에 갱신, 큐로 초당 4건 이하를 유지하며 429는 지수 백오프한다. `server-only`로 클라이언트 번들 유입을 막는다.
- **검색**: 내부 DB를 먼저 조회(trigram)하고 결과가 20건 미만이면 IGDB를 조회해 후보를 보여준다. 이 단계는 **읽기 전용**이라 비로그인 사용자도 쓸 수 있다.
- **후보 열기(미리보기)**: 아직 가져오지 않은 후보는 `/games/igdb-{igdbId}`로 연결한다. 서버가 IGDB에서 조회한 결과를 캐시해 렌더링하며 **DB에 쓰지 않는다**. 비로그인 사용자는 미리보기까지 볼 수 있고, `내 기록` 영역은 `로그인하고 기록하기`로 보인다.
- **가져오기(import)**: 로그인한 사용자가 처음으로 쓰기 동작(라이브러리 추가·평가·리뷰)을 하면 같은 Server Action 안에서 `import.ts`가 게임·회사·장르·태그·플랫폼을 한 트랜잭션으로 upsert한 뒤 요청한 동작을 수행한다(`UNIQUE (source, external_id)`로 멱등). 이후에는 `/games/{slug}`로 영구 연결된다. 쓰기에는 세션이 필요하다는 원칙은 그대로 유지된다.
- **권한 분리**: `import.ts`는 `app_user`가 아니라 **`catalog_writer` 역할**(별도 커넥션 풀, 환경 변수 `DATABASE_URL_CATALOG`)로 실행한다. 이 역할은 `games`·`game_companies`·`platforms`와 연결 테이블에만 **INSERT·UPDATE(연결은 DELETE도)** 권한이 있고, `genres`·`tags`는 **읽기만** 한다(분류는 마이그레이션이 시드한 목록에서 슬러그로 찾는다). 쓰기는 컬럼 권한으로 더 좁혀 슬러그·카운터·출처는 바꿀 수 없다. `INSERT … ON CONFLICT`의 충돌 검사와 `RETURNING`에는 SELECT가 필요하므로, 해당 카탈로그 테이블의 읽기 권한과 이를 허용하는 RLS 정책을 함께 부여한다. 사용자 기록 테이블에는 접근할 수 없다. `app_user`는 이 테이블들을 계속 읽기만 한다(수동 등록 예외는 [데이터 모델 §5](data-model.md#5-rls-정책)).
- **가져오기 전 인가 검사**: ① 유효한 세션 ② 클라이언트가 보낸 메타데이터를 신뢰하지 않고 **IGDB ID만 받아 서버가 IGDB에서 직접 조회** ③ 사용자별 가져오기 횟수 제한(초기값 분당 10건) ④ ID 형식·범위 검증.
- 매핑: IGDB 장르·테마·키워드·플레이어 시점을 내부 장르 15개와 태그로 변환한다(예: 시점 `First person` + 슈터 → FPS, 키워드 `roguelike` → 로그라이크). 실제 값은 구현 시 IGDB 응답으로 검증하고 `mapper.ts` 표로 관리한다.
- 이미지: 커버 URL의 크기 접미사를 바꿔 쓰고, `next/image`의 `remotePatterns`에 `images.igdb.com`을 등록한다.
- 키는 서버 환경 변수 `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`로만 둔다.

**게임 카탈로그 구현 메모** (3단계에서 실제 IGDB 응답과 DB로 확인한 것)
- **인증 방식**: IGDB는 사용자 로그인 없이 `client_credentials`로 서버에서 앱 토큰을 받는다. Twitch 콘솔의 "OAuth 리디렉션 URL"은 이 방식에서 쓰이지 않지만 등록에는 HTTPS 주소가 필요하다(`https://localhost`면 된다). 토큰은 약 56일 유효하고 응답에 속도 제한 헤더가 없어, 초당 4건은 클라이언트가 직접 지킨다(`src/server/igdb/client.ts`).
- **매핑은 선별 표다**: 한 게임에 키워드가 60개 넘게 달려 전부 태그로 만들면 의미가 없다. 테마·플레이 모드·플레이어 시점은 닫힌 목록이라 전부 변환하고, 키워드는 `jrpg`·`roguelike`·`soulslike`·`turn-based`·`party-based`·`story rich`만 쓴다. 변환표의 ID는 IGDB 응답으로 확인했고, 매퍼가 만들 수 있는 모든 슬러그가 마이그레이션 시드에 있는지 단위 테스트가 검사한다.
- **한국어 제목**: IGDB의 `game_localizations`에서 `ko-KR` 지역화를 `title_ko`로 쓴다(없으면 비운다). 회사 국가는 ISO 숫자 코드(392)로 와서 알파벳 2자(JP)로 바꾼다.
- **검색 대상**: 본편·독립 확장·리메이크·리마스터·확장판(`game_type` 0·4·8·9·10)만 보여 주고 DLC·번들·모드는 뺀다. 사용자 입력은 IGDB 질의 문자열에 넣기 전에 따옴표·역슬래시를 이스케이프한다(질의 변조 방지).
- **내부 검색**: `pg_trgm`은 한글에서도 동작한다(PostgreSQL 18.7에서 확인). 점수 = 일치 단계(정확 > 앞부분 > 포함 > 유사도) + 유사도, 동점은 평가 수·id이며 `(점수, 평가 수, id)` 키셋으로 이어 간다.
- **중복 없는 가져오기**: `UNIQUE (source, external_id)` 위의 upsert라 같은 게임을 동시에 3번 가져와도 한 행이다(실제 dev DB에서 확인). 다시 가져오면 메타데이터와 연결을 바꾸되 슬러그(영구 주소)는 유지한다. 슬러그가 수동 게임과 겹치면 `-igdb-<ID>`를 붙인다.
- **슬러그 예약어**: `/games/new`(수동 등록)와 `/games/igdb-{id}`(미리보기)는 경로가 따로 있어 DB가 슬러그로 쓰는 것을 막는다.
- **수동 등록**: 시간당 10건 제한을 **사용자별 advisory lock**으로 직렬화한다. 잠금 없이 세면 동시 요청이 서로의 INSERT를 보지 못해 한도를 넘는다(16건 동시 요청 중 13건이 통과하는 것을 시험으로 확인했고, 잠금 뒤 10건이다). 커버 이미지는 업로드 저장소가 생기기 전에는 받지 않는다. 등록자의 수정 화면은 아직 없다(RLS는 이미 허용한다).
- **IGDB 이용 조건**: 상업적 이용 가능 여부는 여전히 미확인이다. 공개 서비스 전환 전에 확인한다.

**게임 상세·목록 구현 메모** (4단계)
- **공개 경로는 `proxy.ts`에 따로 적는다**: `/genres`·`/tags`·`/companies`를 `publicRoutes`에 넣지 않으면 비로그인이 로그인 화면으로 보내진다. 처음에는 빠져 있었고 E2E가 잡았다. 공개 화면을 새로 만들 때는 이 목록을 함께 고친다.
- **`generateMetadata`**: `params`와 DB를 읽어도 본문이 이미 `Suspense` 안에서 요청 시점에 스트리밍되므로 Cache Components 오류가 아니다(빌드로 확인, DB·Twitch 값 없는 CI 조건에서도 통과). 메타데이터와 본문이 같은 행을 두 번 읽지 않게 React `cache()`로 한 요청 안에서 묶는다. 미리보기(`/games/igdb-{id}`)는 이름을 알려면 IGDB를 불러야 해서 탭 제목에는 외부 호출을 쓰지 않고 고정 문구를 쓴다.
- **평균 평점**: `games.rating_sum / rating_count / 2`를 **정수 연산만으로** 0.1 단위로 반올림한다(소수 둘째 자리가 5면 올림). 부동소수점으로 나누면 `x.x5` 경계가 흔들린다. `4.2 (1,234)`로 보이고 스크린리더에는 "평균 4.2점, 1,234명이 평가"로 따로 읽어 준다. 평가가 없으면 안내 문구다. 카운터가 DB의 `games_rating_counters` CHECK(개수 ≤ 합 ≤ 개수 × 10)를 벗어나는 값은 있을 수 없으므로, 함수도 그 조합을 조용히 보여 주지 않고 거부한다.
- **분류·회사 목록**: 인기 목록과 같은 키셋 `(평가 수, id)` 내림차순이고 20건씩 `더 보기`(커서는 주소에 담는다)다. 개발사와 퍼블리셔는 다른 연결 테이블이라 회사 화면에서 `개발한 게임`·`퍼블리싱한 게임`으로 나누며, 개발작이 없고 퍼블리싱작만 있으면 그쪽이 먼저 열린다. 한 게임이 양쪽에 있으면 둘 다에 나온다.
- **미리보기의 링크**: 아직 가져오지 않은 게임은 장르·태그만 링크하고, 회사는 다른 게임으로 이미 가져온 것(IGDB ID가 같은 행)만 링크한다. 내부에 없는 회사로 링크하면 404가 되기 때문이다.
- **아직 없는 것**: 내 기록 패널(평가·상태·날짜·리뷰), 리뷰 목록, 관련 게임, 공유는 해당 기능이 생기는 5–7단계에서 붙인다. 동작하지 않는 자리만 먼저 그리지 않는다.
- **E2E 시험 데이터**: 시험이 만드는 게임·태그·회사는 `e2e-fx-` 접두어를 쓰고 한 트랜잭션으로 만들며 끝나면 지운다. 장르는 식별 컬럼이 smallint(32,767)라 시험마다 만들면 소진되므로 새로 만들지 않고 시드된 `rpg`에 연결한다(플랫폼에서 겪은 문제와 같다).

## 5. 디자인 시스템 구현

StudioBlank 규칙을 코드로 강제한다.

| 항목 | 구현 |
|---|---|
| 토큰 | `src/styles/tokens.css`에 색상·타이포·간격·breakpoint를 CSS 변수로 정의. Tailwind `@theme`이 이를 참조 |
| 전역 규칙 | `* { border-radius: 0 !important; box-shadow: none !important }` |
| 폰트 | `next/font`로 Inter, IBM Plex Mono. 한글은 Pretendard를 fallback으로 |
| 컴포넌트 | 명세의 디렉터리 구조 그대로. 버튼 4종·크기 3종, 입력, 카드, 칩, 체크박스·라디오, 툴팁 |
| 이벤트 색 | `--event-*` 토큰은 **채도를 낮춘 색**(라이트·다크 각각 정의). 구분은 글리프·레이블이 담당하고 색은 보조. 카드 배경 위 3:1 대비를 단위 테스트가 지킨다 |
| 모션 | transition ≤ 200ms, 이미지 fade-in만 허용 |

**요구사항 간 충돌 정리**: 초기 요구사항은 달력 이벤트를 초록·파랑·보라·금색으로 구분하라고 했고, StudioBlank는 모노크롬을 기본으로 한다. 최신 요구사항(StudioBlank)의 모노크롬을 따르되, 달력 이벤트 색만 예외로 둔다(아래 결정 참고). REA에서 왓챠의 분홍 강조 색, 이미지 위 텍스트, 라운드 UI는 StudioBlank와 충돌해 계승하지 않는다([UI 패턴 §13](../rea/ui-patterns.md#13-studioblank와의-충돌-정리)). 달력 이벤트 색은 사용자 확인(2026-11-10)에 따라 "모노크롬 기조와 어울리고 구분이 잘 되면 가능"으로 정했고, 구현 단계에서 모노크롬 안과 색 안을 나란히 비교한 뒤 **색 안으로 확정**했다(2026-11-11). 인터페이스 전반은 모노크롬을 유지하고 이벤트만 색을 쓰는 예외다.

## 6. 성능

- 읽기는 서버 컴포넌트에서 처리하고 클라이언트 JS를 줄인다.
- 검색·목록·피드는 서버 페이지네이션(키셋). 달력은 한 달 범위 쿼리만 실행한다.
- 평균 평점은 `games` 카운터로 읽는다.
- 커버 이미지는 크기 지정 + lazy loading, 뷰포트 밖은 지연 로딩.
- 낙관적 업데이트(평가·좋아요·팔로우)로 체감 지연을 줄이되 실패 시 원복한다.

### Cache Components 규칙 (Next 16.4 기본값)

스캐폴드한 Next.js는 `cacheComponents`와 `partialPrefetching`이 켜져 있다. 번들 문서(`node_modules/next/dist/docs/01-app/01-getting-started/08-caching.md`)를 기준으로 다음 원칙을 따른다.

- **요청 시점 데이터**(세션 쿠키, 사용자별 DB 조회)는 캐시하지 않고 `<Suspense>` 경계 안에서 읽어 스트리밍한다. 하단 내비의 `내 프로필` 링크처럼 공통 레이아웃이 세션을 읽는 경우에도 같은 경계를 둔다.
- **사용자와 무관한 공개 데이터**(인기 게임, 게임 메타데이터, 평균 평점)는 `'use cache'`와 `cacheLife`로 캐시한다.
- 변경 뒤의 무효화 방법과 규칙 위반 시의 오류 동작은 구현 단계에서 같은 문서(`09-revalidating.md` 등)로 확인한다. 이 문서는 추측으로 쓰지 않는다.

## 7. 접근성

평가 `role="slider"`, 달력 `role="grid"` + 방향키, 이벤트 레이블 텍스트, 포커스 outline 2px, 터치 영역 44px, 모든 버튼에 이름. 평가 별이 이름 없는 SVG였던 REA의 결함을 반복하지 않는다.

## 8. 테스트 전략

| 층 | 도구 | 대상 |
|---|---|---|
| 단위 | Vitest | 별점 변환(0.5↔1–10), 날짜 검증, 이벤트 매핑, IGDB 매퍼, 레이트 리밋 |
| DB 통합 | Vitest + Neon `test` 브랜치 | 제약(중복·CHECK), 트리거(이벤트 동기화·카운터), **RLS**(A가 B의 행을 변경 불가) |
| E2E | Playwright (headless, iPhone 14 + 데스크톱) | 가입 → 검색 → 상세 → 평가 → 라이브러리 → 엔딩일 → 달력 → 리뷰 → 프로필 |
| 시각 점검 | Playwright 스크린샷 | radius·그림자·컬러 위반 확인 |

우선순위: ① 평가 등록·수정 ② 라이브러리 등록·상태 변경 ③ 엔딩일 기록 ④ 리뷰 작성·수정 ⑤ 달력 이벤트 생성·조회 ⑥ 팔로우·언팔로우 ⑦ 프로필 조회 ⑧ 권한·RLS.

CI(GitHub Actions): lint → typecheck → 단위 → (비밀 값이 필요한 DB 테스트는 브랜치 시크릿이 준비된 뒤 추가).

## 9. 구현 계획

기능마다 `feat/*` 브랜치와 PR을 만들고 작은 커밋을 쌓는다. 각 기능은 **마이그레이션 → 서버 로직 → UI → 테스트** 순서이며, 실제 DB와 연결된 동작이 완료 기준이다.

| 순서 | 브랜치 | 범위 | 완료 기준 |
|---|---|---|---|
| 0 | `chore/scaffold` | Next.js·Tailwind·Vitest·Playwright·CI 스캐폴드, Neon 프로젝트·브랜치(dev/test) 연결, `app_user`·`catalog_writer`·`trigger_owner` 역할 | `npm run lint && typecheck && test` 통과, 로컬 기동 |
| 1 | `feat/design-system` | 토큰·타이포·공통 컴포넌트·내비·`/dev/ui` 확인 페이지 | 위반 항목 0(radius·그림자) |
| 2 | `feat/auth` | Neon Auth, 가입·로그인·로그아웃, 보호 경로, profile upsert | 새로고침 후 세션 유지, 보호 경로 리다이렉트 |
| 3 | `feat/games-search` | 스키마, IGDB 어댑터(**Twitch 키 필요**), 수동 등록, 검색·페이지네이션, 시드 | 검색 → 가져오기 → 중복 없음 |
| 4 | `feat/game-detail` | 상세 화면, 회사·장르·태그 링크, 평균 평점 | 링크 이동, 비율 유지 커버 |
| 5 | `feat/ratings` | 평가 등록·수정·취소, 카운터 트리거 | 우선순위 ① 통과 |
| 6 | `feat/library` | 라이브러리, 상태 7종, 진행도, 날짜, 필터·정렬 | 우선순위 ②③ 통과 |
| 7 | `feat/reviews` | 리뷰 CRUD, 공개 범위, 좋아요, 정렬 | 우선순위 ④ 통과 |
| 8 | `feat/calendar` | 이벤트 트리거, 월간·일별·월 선택·연도·통계 | 우선순위 ⑤ 통과, 키보드 탐색 |
| 9 | `feat/profile` | 본인/타인 프로필, 통계 | 우선순위 ⑦ 통과 |
| 10 | `feat/follows` | 팔로우·목록·사용자 검색 | 우선순위 ⑥ 통과 |
| 11 | `feat/companies` | 회사 검색·상세·좋아하는 회사 | 개발사/퍼블리셔 구분 표시 |
| 12 | `feat/feed` | 소셜 피드(키셋, 묶음 표시) | 비공개 활동 제외 |
| 13 | `chore/design-review` | StudioBlank 최종 점검(`docs/design/design-review.md`)과 수정 | 체크리스트 전 항목 통과 |

## 10. 위험과 열린 이슈

| 항목 | 내용 | 대응 |
|---|---|---|
| IGDB 상업 이용 조건 | 자료가 엇갈림 | 공개 전 약관·파트너 계약 확인, 어댑터로 교체 가능하게 설계 |
| Neon Auth 사용자 ID 타입·테이블명 | 문서에서 확정하지 못함 | `profiles.auth_user_id`를 text로 두고 구현 시 실제 스키마 확인 |
| 로그인 수단 | Managed Auth는 카카오 미지원(이메일·Google 등) | 후속으로 자체 호스팅 Better Auth 검토 |
| 이메일 인증 | 공유 SMTP는 개발용, 운영은 커스텀 SMTP 필요 | 배포 전 설정 |
| RLS와 풀링 | 트랜잭션 모드 풀러에서 세션 변수 누수 위험 | 항상 `set_config(..., true)`를 트랜잭션 안에서만 사용, 테스트로 검증 |
| Neon CLI 버전 | 설치된 4.14.3은 `neon.ts`·`neon deploy`를 지원하지 않는다 | 스캐폴드 단계에서 최신 버전으로 업그레이드 |
| 한국어 게임명 | IGDB의 한국어 로컬라이제이션 범위가 불명확 | `title_ko`는 선택 필드, 수동 보정 허용 |

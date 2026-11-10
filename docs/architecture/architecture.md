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

1. `app/api/auth/[...path]/route.ts`가 Neon Auth 핸들러를 노출하고, `proxy.ts`가 보호 경로를 막는다(공개 경로는 `/`, `/search`, `/games/*`, `/u/*` 등을 명시).
2. 첫 세션에서 `profiles`를 upsert한다(handle 설정 화면으로 유도).
3. **모든 쓰기는 Server Action**이며 순서는 `세션 확인 → 입력 검증(zod) → withUser(profileId, tx => …)`다.
4. `withUser`는 트랜잭션을 열고 `set_config('app.user_id', …, true)`를 설정한 뒤 `app_user` 권한으로 질의한다. 풀링된 연결(트랜잭션 모드)에서도 안전하도록 항상 `is_local = true`를 쓴다.
5. RLS가 두 번째 방어선이다(정책은 [데이터 모델 §5](data-model.md#5-rls-정책)).
6. 비밀 값(`DATABASE_URL`, `NEON_AUTH_COOKIE_SECRET`, IGDB 키)은 서버 환경 변수로만 쓰고 클라이언트 번들에 넣지 않는다. `.env*`는 커밋하지 않는다.
7. **카탈로그 쓰기(IGDB 가져오기)만 예외**로 `catalog_writer` 역할을 쓴다([§4.3](#43-연동-방식)). `app_user`는 게임 메타데이터 테이블을 읽기만 한다(수동 등록 제외).

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
- **권한 분리**: `import.ts`는 `app_user`가 아니라 **`catalog_writer` 역할**(별도 커넥션 풀, 환경 변수 `DATABASE_URL_CATALOG`)로 실행한다. 이 역할은 `games`·`game_companies`·`genres`·`tags`·`platforms`와 연결 테이블에만 INSERT·UPDATE 권한이 있고 사용자 기록 테이블에는 접근할 수 없다. `app_user`는 이 테이블들을 계속 읽기만 한다(수동 등록 예외는 [데이터 모델 §5](data-model.md#5-rls-정책)).
- **가져오기 전 인가 검사**: ① 유효한 세션 ② 클라이언트가 보낸 메타데이터를 신뢰하지 않고 **IGDB ID만 받아 서버가 IGDB에서 직접 조회** ③ 사용자별 가져오기 횟수 제한(초기값 분당 10건) ④ ID 형식·범위 검증.
- 매핑: IGDB 장르·테마·키워드·플레이어 시점을 내부 장르 15개와 태그로 변환한다(예: 시점 `First person` + 슈터 → FPS, 키워드 `roguelike` → 로그라이크). 실제 값은 구현 시 IGDB 응답으로 검증하고 `mapper.ts` 표로 관리한다.
- 이미지: 커버 URL의 크기 접미사를 바꿔 쓰고, `next/image`의 `remotePatterns`에 `images.igdb.com`을 등록한다.
- 키는 서버 환경 변수 `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`로만 둔다.

## 5. 디자인 시스템 구현

StudioBlank 규칙을 코드로 강제한다.

| 항목 | 구현 |
|---|---|
| 토큰 | `src/styles/tokens.css`에 색상·타이포·간격·breakpoint를 CSS 변수로 정의. Tailwind `@theme`이 이를 참조 |
| 전역 규칙 | `* { border-radius: 0 !important; box-shadow: none !important }` |
| 폰트 | `next/font`로 Inter, IBM Plex Mono. 한글은 Pretendard를 fallback으로 |
| 컴포넌트 | 명세의 디렉터리 구조 그대로. 버튼 4종·크기 3종, 입력, 카드, 칩, 체크박스·라디오, 툴팁 |
| 이벤트 색 | `--event-*` 토큰의 기본값은 **모노크롬**. 색 대체 세트는 정의만 하고 활성화하지 않는다. 구분은 글리프·레이블·패턴이 담당 |
| 모션 | transition ≤ 200ms, 이미지 fade-in만 허용 |

**요구사항 간 충돌 정리**: 초기 요구사항은 달력 이벤트를 초록·파랑·보라·금색으로 구분하라고 했고, StudioBlank는 모노크롬을 기본으로 한다. 최신 요구사항(StudioBlank)을 따르고 색은 후속 토큰 교체로 남긴다. REA에서 왓챠의 분홍 강조 색, 이미지 위 텍스트, 라운드 UI는 StudioBlank와 충돌해 계승하지 않는다([UI 패턴 §13](../rea/ui-patterns.md#13-studioblank와의-충돌-정리)). 사용자 확인(2026-11-10)에 따라 색은 모노크롬 기조와 어울리고 구분이 잘 될 때 쓸 수 있으므로, 구현 단계에서 달력에 모노크롬 안과 색 안을 나란히 만들어 비교한다.

## 6. 성능

- 읽기는 서버 컴포넌트에서 처리하고 클라이언트 JS를 줄인다.
- 검색·목록·피드는 서버 페이지네이션(키셋). 달력은 한 달 범위 쿼리만 실행한다.
- 평균 평점은 `games` 카운터로 읽는다.
- 커버 이미지는 크기 지정 + lazy loading, 뷰포트 밖은 지연 로딩.
- 낙관적 업데이트(평가·좋아요·팔로우)로 체감 지연을 줄이되 실패 시 원복한다.

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
| 0 | `chore/scaffold` | Next.js·Tailwind·Vitest·Playwright·CI 스캐폴드, Neon 프로젝트·브랜치(dev/test) 연결, `app_user`·`catalog_writer` 역할 | `npm run lint && typecheck && test` 통과, 로컬 기동 |
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

# SavePoint

게임을 평가하고, 플레이 이력을 기록하고, 취향을 공유하는 **게임 아카이빙 서비스**.

왓챠피디아의 평가·리뷰·프로필·소셜 경험을 게임에 맞게 재해석하고, 플레이 진행도·엔딩 기록·기록 달력을 더한다. 모바일 웹을 최우선으로 설계한다.

## 진행 단계

| Phase | 내용 | 산출물 | 상태 |
|---|---|---|---|
| 1–2 | 왓챠피디아 모바일 웹 REA 및 문서화 | [`docs/rea/`](docs/rea/overview.md) | 완료 |
| 3 | 게임 버전 서비스 설계 | [`docs/product/`](docs/product/feature-specification.md) | 완료 |
| 4 | 데이터 모델·기술 아키텍처 | [`docs/architecture/`](docs/architecture/architecture.md) | 완료 |
| 5–6 | UI/UX 구현, 핵심 기능 구현·검증 | `src/` | 진행 중 ([구현 계획](docs/architecture/architecture.md#9-구현-계획)) |

## 기술 스택

Next.js (App Router) · TypeScript · Tailwind CSS · Neon (Postgres + Auth) · Drizzle ORM · IGDB

## 개발

Node 22 이상이 필요하다.

```bash
npm install
cp .env.example .env.local && chmod 600 .env.local   # 값을 채운다 (Neon 연결 문자열 등). 비밀 값이 들어가므로 소유자만 읽게 한다
npm run dev                  # http://localhost:3000
```

| 명령 | 설명 |
|---|---|
| `npm run lint` | ESLint |
| `npm run typecheck` | `next typegen` 후 `tsc --noEmit` (라우트 타입은 생성 단계가 필요하다) |
| `npm test` | Vitest 단위 테스트 |
| `npm run test:e2e` | Playwright E2E (모바일 iPhone 14 + 데스크톱, 항상 headless) |
| `E2E_SERVER=prod npm run test:e2e` | 운영 빌드(`next start`)로 E2E. 개발 서버는 디렉터리당 하나뿐이라 `npm run dev`를 열어 둔 채로는 위 명령이 서버를 띄우지 못하는데, 이 모드는 그때도 돈다. 운영 모드에서는 `/dev/ui`가 404이므로 그 화면을 쓰는 `design-system.spec.ts`에는 쓰지 않는다 |
| `E2E_BASE_URL=http://localhost:3000 npx playwright test tests/e2e/design-system.spec.ts tests/e2e/smoke.spec.ts` | 이미 떠 있는 서버를 그대로 쓴다. **읽기만 하는 시험(design-system·smoke)에만** 쓴다. 파일을 지정하지 않으면 `auth.spec.ts`까지 돌아 그 서버가 쓰는 DB에 가입하는데, 정리는 `.env.local`의 dev 브랜치만 대상으로 해서 다른 DB에 만든 계정은 지워지지 않는다 |
| `npm run build` | 프로덕션 빌드 |

Neon CLI는 전역 설치 대신 프로젝트에 고정된 버전을 쓴다: `npx neon <명령>`.

### Neon 설정 (최초 1회)

```bash
npx neon login --profile DEFAULT
# 프로젝트가 없을 때만: 만들고 연결한다 (이미 있으면 `npx neon link --project-id <ID>`)
npx neon link --org-id <조직 ID> --project-name savepoint --region-id aws-ap-southeast-1 --no-env-pull -y
npx neon checkout dev --create --no-env-pull    # 개발 브랜치
npx neon checkout test --create --no-env-pull   # DB 통합 테스트 전용 브랜치
```

브랜치마다 앱 역할(`app_user`, `catalog_writer`, `trigger_owner`)과 연결 문자열을 만든다.

```bash
DATABASE_URL_ADMIN="$(npx neon connection-string dev)"  npm run db:setup-roles -- .env.local
DATABASE_URL_ADMIN="$(npx neon connection-string test)" npm run db:setup-roles -- .env.test.local
```

역할만 만든 상태에서는 `profiles` 테이블이 없다. 아래 "스키마와 Neon Auth"의 마이그레이션까지 적용한 **뒤에** `npm run test:db`를 돌린다.

- 역할은 SQL로 만든다. 콘솔·CLI로 만든 역할은 `BYPASSRLS` 그룹에 들어가 RLS가 무력화된다.
- 스크립트는 여러 번 실행해도 안전하며 실행할 때마다 비밀번호를 새로 만든다. 비밀번호는 출력하지 않고 env 파일에만 쓰며, 파일이 이미 있어도 권한을 600으로 좁힌 뒤 쓴다.
- `.env.local`, `.env.test.local`, `.neon`은 커밋하지 않는다.

### 스키마와 Neon Auth (브랜치마다)

```bash
npm run db:migrate -- .env.local             # drizzle/ 마이그레이션을 소유자 연결로 적용한다 (역할이 먼저 있어야 한다)
npm run db:migrate -- .env.test.local
npm run test:db                              # test 브랜치로 RLS 설정값 격리·제약·프로필 생성을 검증한다 (마이그레이션 뒤에)
npx neon deploy --branch dev --no-env-pull   # neon.ts의 `auth: true`로 Neon Auth를 켠다 (브랜치를 지정해 dev에만)
npx neon neon-auth status --branch dev       # Base URL → .env.local의 NEON_AUTH_BASE_URL
openssl rand -base64 32                      # → .env.local의 NEON_AUTH_COOKIE_SECRET (32자 이상)
```

- 마이그레이션은 **손으로 쓴 SQL**이다(RLS 정책·트리거·GRANT는 스키마 비교로 만들 수 없다). 새 마이그레이션은 `npx drizzle-kit generate --custom --name=<이름>`으로 빈 파일을 만들어 채운다. `src/server/db/schema/`의 타입 정의가 실제 테이블과 같은지는 DB 테스트가 검사한다.
- 인증 서버는 Neon이 호스팅한다. 이메일 인증은 요구하지 않으므로 가입하면 바로 로그인된다.
- E2E(`tests/e2e/auth.spec.ts`)는 실제 Neon Auth(dev 브랜치)에 가입한다. 만든 계정과 프로필은 테스트가 끝나면 지운다.

### IGDB와 샘플 게임

게임 검색·미리보기·가져오기는 [IGDB](https://api-docs.igdb.com/)를 쓴다. Twitch 앱을 만들어 키를 받는다.

1. [Twitch 개발자 콘솔](https://dev.twitch.tv/console)에서 앱을 만든다. **클라이언트 유형은 `기밀`**이어야 Client Secret을 만들 수 있다.
2. IGDB는 사용자 로그인 없이 서버에서 토큰을 받으므로 "OAuth 리디렉션 URL"은 쓰이지 않는다. 콘솔이 HTTPS만 받으니 `https://localhost`를 넣는다.
3. Client ID와 Secret을 `.env.local`의 `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`에 넣는다(서버에서만 읽고 클라이언트 번들에는 들어가지 않는다).

```bash
npm run db:seed -- .env.local   # dev 브랜치에 샘플 게임 22개를 IGDB에서 가져온다 (제목이 정확히 같은 결과만, 여러 번 실행해도 안전하다)
```

- 키가 없거나 IGDB가 막혀도 내부 검색과 수동 등록(`/games/new`)은 동작한다. 검색 화면은 "외부 게임 정보를 불러오지 못했어요"라고 알린다.
- 검색 E2E 중 IGDB 후보 시험(`tests/e2e/games.spec.ts`)과 시드는 실제 IGDB를 부른다. 상업적 이용 조건은 아직 확인하지 못했다([아키텍처 §4](docs/architecture/architecture.md#4-게임-메타데이터와-외부-api)).

이 저장소의 Next.js는 `cacheComponents`와 `partialPrefetching`이 켜져 있어 기존 버전과 규칙이 다르다. 코드를 쓰기 전에 `node_modules/next/dist/docs/`의 해당 문서를 읽는다([`AGENTS.md`](AGENTS.md)).

## 디자인

모든 UI는 StudioBlank Design System(모노크롬, 직각, 여백 중심)을 따른다.

## 작업 규칙

- 작은 작업 하나당 커밋 하나
- Phase·기능별 브랜치에서 작업하고 PR로 병합
- 시크릿(`.env*`, 로그인 세션 파일)은 커밋하지 않는다

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
cp .env.example .env.local   # 값을 채운다 (Neon 연결 문자열 등)
npm run dev                  # http://localhost:3000
```

| 명령 | 설명 |
|---|---|
| `npm run lint` | ESLint |
| `npm run typecheck` | `next typegen` 후 `tsc --noEmit` (라우트 타입은 생성 단계가 필요하다) |
| `npm test` | Vitest 단위 테스트 |
| `npm run test:e2e` | Playwright E2E (모바일 iPhone 14 + 데스크톱, 항상 headless) |
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
npm run test:db   # 풀링 연결에서 RLS 설정값이 새지 않는지 등을 test 브랜치로 검증
```

- 역할은 SQL로 만든다. 콘솔·CLI로 만든 역할은 `BYPASSRLS` 그룹에 들어가 RLS가 무력화된다.
- 스크립트는 여러 번 실행해도 안전하며 실행할 때마다 비밀번호를 새로 만든다. 비밀번호는 출력하지 않고 env 파일(권한 600)에만 쓴다.
- `.env.local`, `.env.test.local`, `.neon`은 커밋하지 않는다.

이 저장소의 Next.js는 `cacheComponents`와 `partialPrefetching`이 켜져 있어 기존 버전과 규칙이 다르다. 코드를 쓰기 전에 `node_modules/next/dist/docs/`의 해당 문서를 읽는다([`AGENTS.md`](AGENTS.md)).

## 디자인

모든 UI는 StudioBlank Design System(모노크롬, 직각, 여백 중심)을 따른다.

## 작업 규칙

- 작은 작업 하나당 커밋 하나
- Phase·기능별 브랜치에서 작업하고 PR로 병합
- 시크릿(`.env*`, 로그인 세션 파일)은 커밋하지 않는다

# SavePoint

게임을 평가하고, 플레이 이력을 기록하고, 취향을 공유하는 **게임 아카이빙 서비스**.

왓챠피디아의 평가·리뷰·프로필·소셜 경험을 게임에 맞게 재해석하고, 플레이 진행도·엔딩 기록·기록 달력을 더한다. 모바일 웹을 최우선으로 설계한다.

## 진행 단계

| Phase | 내용 | 산출물 |
|---|---|---|
| 1–2 | 왓챠피디아 모바일 웹 REA 및 문서화 | `docs/rea/` |
| 3 | 게임 버전 서비스 설계 | `docs/product/` |
| 4 | 데이터 모델·기술 아키텍처 | `docs/architecture/` |
| 5–6 | UI/UX 구현, 핵심 기능 구현·검증 | `src/` |

## 기술 스택

Next.js (App Router) · TypeScript · Tailwind CSS · Neon (Postgres + Auth) · Drizzle ORM · IGDB

## 디자인

모든 UI는 StudioBlank Design System(모노크롬, 직각, 여백 중심)을 따른다.

## 작업 규칙

- 작은 작업 하나당 커밋 하나
- Phase·기능별 브랜치에서 작업하고 PR로 병합
- 시크릿(`.env*`, 로그인 세션 파일)은 커밋하지 않는다

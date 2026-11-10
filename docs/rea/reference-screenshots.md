# 참고 스크린샷

> **제3자 서비스(왓챠피디아) 화면이며 UX 분석 참고용이다.** 모든 이미지의 저작권은 해당 서비스와 콘텐츠 권리자에게 있고 재배포·상업 이용 대상이 아니다. 디자인을 복제하지 않는다.

- 캡처 조건: iPhone 14 프로필 390×664 CSS px(DPR 3), `ko-KR`, headless, CSS 스케일로 저장
- 수집일: 2026-11-10
- 파일 위치: `docs/rea/screenshots/`

## 포함한 화면

| 파일 | 화면 | 로그인 | 관찰 포인트 |
|---|---|---|---|
| `01-home-logged-out.png` | 홈 첫 화면 | 비로그인 | 카테고리 탭, 히어로 카드, 바로가기 5개, 하단 내비 3탭 |
| `01-home-logged-out-full.png` | 홈 전체 | 비로그인 | 랭킹·인물·공개 예정 레일의 세로 구성 |
| `01-overlay-app-install-modal.png` | 앱 설치 모달 | 비로그인 | 주 버튼/보조 버튼 구성, 하단 광고 시트가 겹침 |
| `01-overlay-welcome-ad.png` | 환영 광고 시트 | 비로그인 | `3일 동안 보지 않기` / `닫기` |
| `02-search-empty-popular.png` | 검색 빈 상태 | 비로그인 | 인기 검색어 10개와 기준 시각 |
| `02-search-results.png` | 검색 결과 | 비로그인 | 결과 탭 5개, 도메인별 섹션 |
| `02-search-no-result.png` | 검색 결과 없음 | 비로그인 | 안내 문구, 탭 유지 |
| `03-detail-top-logged-out.png` | 상세 상단 | 비로그인 | 히어로 메타, 회색 별 5개 |
| `03-detail-full-logged-out.png` | 상세 전체 | 비로그인 | 액션 행, 출연/제작, 블러 처리된 코멘트 + 로그인 유도, 갤러리·동영상·컬렉션 |
| `04-detail-action-row.png` | 액션 행 | 로그인 | `보고싶어요 / 코멘트 / 보는 중 / 더보기` 4등분 |
| `04-rating-rated-state.png` | 평가 완료 상태 | 로그인 | 노란 별과 반별(3.5) |
| `09-sign-in.png` | 로그인 | 비로그인 | 소셜·이메일 버튼 6개 |
| `09-sign-up.png` | 회원가입 | 비로그인 | 카카오·Apple + 다른 방법 |

## 포함하지 않은 화면과 이유

| 화면 | 이유 |
|---|---|
| 본인 프로필, 캘린더(월/일별), 평가·코멘트 목록, 피드, 알림, 취향분석, `/review`, 추천 | 계정 이메일·닉네임·시청 이력이 보여 개인정보다. 구조는 [page-analysis](page-analysis.md)에 텍스트로 기록했다 |
| 코멘트 상세, 타인 프로필, 컬렉션 상세 | 제3자의 닉네임·아바타·글이 보인다. 구조는 텍스트로만 기록했다 (초기 커밋 이력에는 이미지가 남아 있다) |
| 본 날짜 변경 시트 | 캡처 시점에 광고 시트가 위에 겹쳐 있어 참고 가치가 낮다. 구성은 [ui-patterns §8](ui-patterns.md#8-바텀시트모달)에 기록했다 |

## 화면 ↔ 문서 연결

- 홈·내비·오버레이 → [page-analysis §0–1](page-analysis.md), [ui-patterns §2, 8](ui-patterns.md)
- 검색 → [page-analysis §2](page-analysis.md), [feature-analysis F7](feature-analysis.md#f7-검색)
- 상세·평가·액션 행 → [page-analysis §3](page-analysis.md), [feature-analysis F1–F4](feature-analysis.md#f1-별점-평가-등록수정취소), [ui-patterns §5–6](ui-patterns.md)
- 로그인 → [feature-analysis F17](feature-analysis.md#f17-로그인회원가입)

/**
 * 플레이 상태 7가지. 순서는 화면에 보여 주는 순서이며 전환 순서를 강제하지 않는다
 * (플레이 예정 → 엔딩 완료로 바로 바꿀 수 있다). 값은 DB의 `play_status` 열거형과 같다.
 */
export const PLAY_STATUSES = [
  { value: "interested", label: "관심 있음" },
  { value: "planned", label: "플레이 예정" },
  { value: "playing", label: "플레이 중" },
  { value: "paused", label: "일시 중단" },
  { value: "cleared", label: "엔딩 완료" },
  { value: "perfected", label: "100% 달성" },
  { value: "dropped", label: "플레이 포기" },
] as const;

export type PlayStatus = (typeof PLAY_STATUSES)[number]["value"];

/** 상태를 지정하지 않고 라이브러리에 등록한 경우(`user_games.status`가 NULL). */
export const UNSET_STATUS_LABEL = "상태 미지정";

export function isPlayStatus(value: unknown): value is PlayStatus {
  return PLAY_STATUSES.some((status) => status.value === value);
}

export function playStatusLabel(status: PlayStatus | null): string {
  if (status === null) return UNSET_STATUS_LABEL;
  return PLAY_STATUSES.find((s) => s.value === status)?.label ?? UNSET_STATUS_LABEL;
}

import { describe, expect, it } from "vitest";
import { isPlayStatus, PLAY_STATUSES, playStatusLabel, UNSET_STATUS_LABEL } from "@/lib/play-status";

describe("플레이 상태", () => {
  it("요구된 7가지가 순서대로 있다", () => {
    expect(PLAY_STATUSES.map((s) => s.label)).toEqual([
      "관심 있음",
      "플레이 예정",
      "플레이 중",
      "일시 중단",
      "엔딩 완료",
      "100% 달성",
      "플레이 포기",
    ]);
  });

  it("값은 중복이 없고 DB 열거형 이름과 같다", () => {
    const values = PLAY_STATUSES.map((s) => s.value);
    expect(new Set(values).size).toBe(7);
    expect(values).toEqual(["interested", "planned", "playing", "paused", "cleared", "perfected", "dropped"]);
  });

  it("isPlayStatus는 알려진 값만 통과시킨다", () => {
    expect(isPlayStatus("cleared")).toBe(true);
    expect(isPlayStatus("finished")).toBe(false);
    expect(isPlayStatus(null)).toBe(false);
  });

  it("상태가 없으면 '상태 미지정'이다", () => {
    expect(playStatusLabel(null)).toBe(UNSET_STATUS_LABEL);
    expect(playStatusLabel("playing")).toBe("플레이 중");
  });
});

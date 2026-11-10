import { describe, expect, it } from "vitest";

// 테스트 파이프라인(vitest 설정, 경로 별칭, CI)이 동작하는지 확인하는 최소 테스트.
// 실제 도메인 테스트가 생기면 이 파일은 지워도 된다.
describe("test pipeline", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });
});

/** 조건부 클래스 이름을 이어 붙인다. 충돌하는 Tailwind 클래스는 호출하는 쪽에서 피한다. */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

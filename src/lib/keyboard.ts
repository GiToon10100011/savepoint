/**
 * 브라우저·운영체제 단축키(Alt+←: 뒤로 가기, Ctrl/Cmd+←: 줄 이동 등)와 겹치는 조합인지 확인한다.
 * 컴포넌트의 키보드 핸들러는 이런 조합을 처리하지 않고 `preventDefault`도 하지 않아야 한다.
 * (Shift는 포함하지 않는다. 범위 선택 등에서 컴포넌트가 직접 쓸 수 있다.)
 */
export function hasModifier(event: { altKey: boolean; ctrlKey: boolean; metaKey: boolean }): boolean {
  return event.altKey || event.ctrlKey || event.metaKey;
}

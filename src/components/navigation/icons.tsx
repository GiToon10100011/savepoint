import type { NavKey } from "./nav-items";

/**
 * 내비 아이콘. 직각 도형만 쓴다(원 없음). 활성 상태는 색이 아니라 채움으로 구분한다.
 * 채운 아이콘의 안쪽 선은 배경색 토큰으로 그려 "파낸" 것처럼 보이게 한다.
 */
export function NavIcon({ name, filled }: { name: NavKey; filled: boolean }) {
  const body = filled ? "currentColor" : "none";
  const cut = filled ? "var(--surface-base)" : "currentColor";
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-6 w-6" stroke="currentColor" strokeWidth="2" strokeLinejoin="miter">
      {name === "home" ? <path d="M4 10.5L12 4l8 6.5V20H4z" fill={body} /> : null}
      {name === "search" ? (
        <>
          <path d="M4 4h11v11H4z" fill={body} />
          <path d="M15 15l5 5" fill="none" />
        </>
      ) : null}
      {name === "library" ? <path d="M4 4h4v16H4zM10 4h4v16h-4zM16 4h4v16h-4z" fill={body} /> : null}
      {name === "calendar" ? (
        <>
          <path d="M4 5h16v15H4z" fill={body} />
          <path d="M4 10h16M8 3v4M16 3v4" fill="none" stroke={cut} />
        </>
      ) : null}
      {name === "profile" ? (
        <>
          <path d="M9 4h6v6H9z" fill={body} />
          <path d="M5 20v-4h14v4z" fill={body} />
        </>
      ) : null}
    </svg>
  );
}

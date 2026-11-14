import Link from "next/link";
import { GameCard } from "@/components/game/game-card";
import { buttonClasses } from "@/components/ui/button";
import type { GameHit } from "../search";

const year = (date: string | null) => (date ? Number(date.slice(0, 4)) : null);

/** 검색·분류·회사 목록이 같이 쓰는 게임 카드 그리드. 내 기록과 무관한 목록이라 평가 줄은 그리지 않는다. */
export function GameGrid({ items, label = "게임 목록" }: { items: GameHit[]; label?: string }) {
  return (
    <ul className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4" aria-label={label}>
      {items.map((hit) => {
        const cover = hit.coverUrl && hit.coverWidth && hit.coverHeight ? { src: hit.coverUrl, width: hit.coverWidth, height: hit.coverHeight } : null;
        return (
          <li key={hit.id}>
            <GameCard href={`/games/${hit.slug}`} title={hit.titleKo ?? hit.title} year={year(hit.releaseDate)} genre={hit.genre} cover={cover} hideRating />
          </li>
        );
      })}
    </ul>
  );
}

/** 다음 페이지가 있을 때만 보이는 `더 보기` 링크. 커서는 주소에 담아 새로고침·공유에 안전하다. */
export function MoreLink({ href }: { href: string | null }) {
  if (!href) return null;
  return (
    <p className="mt-8">
      <Link href={href} className={buttonClasses({ variant: "secondary" })}>
        더 보기
      </Link>
    </p>
  );
}

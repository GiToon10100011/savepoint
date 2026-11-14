import Image from "next/image";
import Link from "next/link";
import { GameStatusBadge } from "@/components/game/game-status";
import { formatStars } from "@/lib/rating";
import type { LibraryItem } from "../library";

/**
 * 라이브러리 목록의 한 행(정보 밀도가 필요한 화면이라 카드 그리드 대신 썸네일 행). 행 전체가 그 게임의 상세로 가는 링크다.
 * 썸네일은 장식이라 대체 텍스트를 비우고(제목이 링크 이름이다), 컬러 배지 없이 테두리 있는 텍스트만 쓴다.
 */
export function LibraryRow({ item }: { item: LibraryItem }) {
  const title = item.titleKo ?? item.title;
  const progress = [item.progressPercent !== null ? `${item.progressPercent}%` : null, item.progressText].filter(Boolean).join(" · ");
  const meta = [item.platformName, item.lastPlayedOn ? `최근 플레이 ${item.lastPlayedOn}` : null, item.clearedOn ? `엔딩 ${item.clearedOn}` : null]
    .filter(Boolean)
    .join(" · ");
  const hasCover = item.coverUrl && item.coverWidth && item.coverHeight;

  return (
    <li className="border-b border-line">
      <Link href={`/games/${item.slug}`} className="flex min-h-16 items-center gap-3 py-2">
        {hasCover ? (
          <Image src={item.coverUrl as string} alt="" width={item.coverWidth as number} height={item.coverHeight as number} sizes="48px" className="h-auto w-12 shrink-0 border border-line" />
        ) : (
          <div aria-hidden="true" className="aspect-[3/4] w-12 shrink-0 border border-line bg-line-subtle" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-snug [overflow-wrap:anywhere]">{title}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            <GameStatusBadge status={item.status} />
            {progress ? <span className="type-body-sm text-muted">{progress}</span> : null}
          </div>
          {meta ? <p className="type-body-sm mt-1 text-muted">{meta}</p> : null}
        </div>
        {/* 별이 없을 때의 대시(—)는 무엇인지 알 수 없어서, 읽는 문구를 따로 둔다. */}
        <span className="type-mono shrink-0">
          <span className="sr-only">{item.myRating !== null ? `내 평가 ${formatStars(item.myRating)}점` : "평가하지 않음"}</span>
          <span aria-hidden="true">{item.myRating !== null ? `★ ${formatStars(item.myRating)}` : "—"}</span>
        </span>
      </Link>
    </li>
  );
}

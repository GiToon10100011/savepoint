import Image from "next/image";
import Link from "next/link";
import { Card, CardBody, CardMedia } from "@/components/ui/card";
import { formatStars } from "@/lib/rating";

export type GameCardProps = {
  href: string;
  title: string;
  year?: number | null;
  genre?: string | null;
  /** 커버. 원본 크기를 주면 이미지 비율을 그대로 유지한다. */
  cover?: { src: string; width: number; height: number } | null;
  /** 내 평가(0.5 단위). 평가하지 않았으면 null/undefined. */
  rating?: number | null;
};

/**
 * 게임 카드. 이미지가 가장 중요한 요소다: 이미지에는 padding이 없고, 이미지 위에 텍스트를 올리지 않으며,
 * 제목·연도·장르·내 평가는 모두 이미지 아래에 둔다. 컬러 배지는 쓰지 않는다.
 */
export function GameCard({ href, title, year, genre, cover, rating }: GameCardProps) {
  const meta = [year, genre].filter(Boolean).join(" · ");
  return (
    <Card>
      <Link href={href} className="block">
        <CardMedia>
          {cover ? (
            <Image
              src={cover.src}
              alt=""
              width={cover.width}
              height={cover.height}
              sizes="(min-width: 1024px) 20vw, 50vw"
              className="h-auto w-full"
            />
          ) : (
            <div aria-hidden="true" className="aspect-[3/4] w-full bg-line-subtle" />
          )}
        </CardMedia>
        <CardBody>
          <h3 className="text-sm font-semibold leading-snug">{title}</h3>
          {meta ? <p className="mt-1 text-xs text-muted">{meta}</p> : null}
          <p className="type-mono mt-2">{rating != null ? `내 평가 ${formatStars(rating)}` : "평가 전"}</p>
        </CardBody>
      </Link>
    </Card>
  );
}

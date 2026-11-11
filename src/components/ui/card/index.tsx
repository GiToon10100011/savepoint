import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

/** 흰 배경 + 1px 테두리. 카드 자체에는 padding이 없고, hover하면 테두리가 검정이 된다. */
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("border border-line bg-card hover:border-ink", className)} {...props} />;
}

/** 이미지 영역. 이미지에는 padding을 주지 않는다. */
export function CardMedia({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("overflow-hidden", className)} {...props} />;
}

/** 이미지 아래 메타데이터 영역. 위 패딩 16px이 이미지와의 간격이다. */
export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-4", className)} {...props} />;
}

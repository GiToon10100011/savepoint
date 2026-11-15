"use client";

import Link from "next/link";
import { useOptimistic, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { toggleReviewLikeAction, type LikeResult } from "../actions";

type ErrorCode = Extract<LikeResult, { ok: false }>["code"];

const MESSAGES: Record<ErrorCode, string> = {
  unauthenticated: "로그인이 필요해요.",
  not_found: "볼 수 없는 리뷰예요. 화면을 새로 고쳐 주세요.",
  own_review: "내 리뷰에는 좋아요를 누를 수 없어요.",
  unavailable: "처리하지 못했어요. 잠시 후 다시 시도해 주세요.",
  invalid: "처리하지 못했어요. 잠시 후 다시 시도해 주세요.",
  failed: "처리하지 못했어요. 잠시 후 다시 시도해 주세요.",
};

type View = { liked: boolean; count: number };

/**
 * 리뷰 좋아요. 누르는 즉시 화면에 반영하고(낙관적 업데이트) 서버에 저장한다. 저장에 실패하면 서버가 확정한 값으로 되돌아가고 이유를
 * 알린다. 서버 액션은 한 번에 하나씩 순서대로 처리되므로 연달아 눌러도 마지막 상태가 남는다.
 * 서버가 아는 값(`liked`·`count`)이 바뀌면 호출하는 쪽이 `key`로 다시 그리게 한다(처음 받은 값만 쓰는 상태라서다).
 */
export function LikeButton({ reviewId, liked, count, signInHref }: { reviewId: string; liked: boolean; count: number; signInHref: string }) {
  const [confirmed, setConfirmed] = useState<View>({ liked, count });
  const [view, setOptimistic] = useOptimistic<View, View>(confirmed, (_current, next) => next);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [pending, startTransition] = useTransition();
  const latest = useRef(0); // 가장 나중에 한 조작의 번호

  function toggle() {
    const next: View = { liked: !view.liked, count: view.count + (view.liked ? -1 : 1) };
    const interaction = ++latest.current;
    setError(null);
    startTransition(async () => {
      setOptimistic(next);
      let code: ErrorCode | null = null;
      try {
        const result = await toggleReviewLikeAction({ reviewId, liked: next.liked });
        if (result.ok) setConfirmed({ liked: result.liked, count: result.likeCount });
        else code = result.code;
      } catch {
        // 네트워크가 끊기는 등 호출 자체가 거부돼도 오류 경계(페이지 전체 오류 화면)로 보내지 않고 이 자리에서 알린다.
        code = "failed";
      }
      // 연달아 눌렀다면 가장 나중 조작의 결과만 반영한다. 앞선 조작의 실패가 나중 성공 뒤에 남지 않게 한다.
      if (interaction === latest.current) setError(code);
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3">
      <Button variant={view.liked ? "primary" : "secondary"} size="sm" aria-pressed={view.liked} aria-busy={pending} onClick={toggle}>
        좋아요 <span className="type-mono">{view.count}</span>
      </Button>
      {error ? (
        <p role="alert" className="type-body-sm">
          {MESSAGES[error]}{" "}
          {error === "unauthenticated" ? (
            <Link href={signInHref} className="font-semibold underline underline-offset-4">
              로그인하기
            </Link>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}

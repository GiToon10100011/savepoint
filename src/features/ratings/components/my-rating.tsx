"use client";

import Link from "next/link";
import { useOptimistic, useRef, useState, useTransition } from "react";
import { GameRating } from "@/components/game/game-rating";
import type { Stars } from "@/lib/rating";
import { rateGameAction, rateIgdbGameAction, type RatingErrorCode } from "../actions";

/** 이미 서비스에 있는 게임은 id로, 아직 가져오지 않은 IGDB 게임(미리보기)은 IGDB ID로 평가한다. */
export type RatingTarget = { kind: "game"; gameId: string } | { kind: "igdb"; igdbId: number };

const MESSAGES: Record<RatingErrorCode, string> = {
  unauthenticated: "로그인이 필요해요.",
  not_found: "게임을 찾을 수 없어요.",
  unavailable: "게임 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.",
  invalid: "저장하지 못했어요. 잠시 후 다시 시도해 주세요.",
  failed: "저장하지 못했어요. 잠시 후 다시 시도해 주세요.",
};

/**
 * 내 별점. 누르는 즉시 화면에 반영하고(낙관적 업데이트) 서버에 저장한다. 저장에 실패하면 서버가 확정한 값으로 되돌아가고
 * 이유를 알린다. 서버 액션은 한 번에 하나씩 순서대로 처리되므로 연달아 바꿔도 마지막 값이 남는다.
 * 저장이 끝나면 서버가 현재 화면을 다시 그려 평균 평점도 함께 바뀐다.
 */
export function MyRating({ target, initial, signInHref }: { target: RatingTarget; initial: Stars | null; signInHref: string }) {
  const [value, setOptimistic] = useOptimistic<Stars | null, Stars | null>(initial, (_current, next) => next);
  const [error, setError] = useState<RatingErrorCode | null>(null);
  const [pending, startTransition] = useTransition();
  const latest = useRef(0); // 가장 나중에 한 조작의 번호

  function change(next: Stars | null) {
    // 아직 등록되지 않은 게임에는 취소할 평가가 없다(처음 평가하면 등록되고 그 화면으로 이동한다).
    if (target.kind === "igdb" && next === null) return;
    const interaction = ++latest.current;
    setError(null);
    startTransition(async () => {
      setOptimistic(next);
      let code: RatingErrorCode | null;
      try {
        const result =
          target.kind === "game"
            ? await rateGameAction({ gameId: target.gameId, stars: next })
            : await rateIgdbGameAction({ igdbId: target.igdbId, stars: next });
        code = result.ok ? null : result.code;
      } catch {
        // 네트워크가 끊기는 등 호출 자체가 거부돼도 오류 경계(페이지 전체 오류 화면)로 보내지 않고 이 자리에서 알린다.
        // 입력은 막지 않으므로 바로 다시 시도할 수 있다.
        code = "failed";
      }
      // 연달아 바꿨다면 가장 나중 조작의 결과만 반영한다. 앞선 조작의 실패가 나중 성공 뒤에 남지 않게 한다.
      if (interaction === latest.current) setError(code);
    });
  }

  return (
    <div aria-busy={pending}>
      <GameRating value={value} onChange={change} label="내 별점" />
      {error ? (
        <p role="alert" className="type-body-sm mt-2">
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

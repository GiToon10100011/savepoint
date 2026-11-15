"use client";

import { useActionState, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Radio } from "@/components/ui/radio";
import { MAX_REVIEW_LENGTH, REVIEW_VISIBILITIES, REVIEW_VISIBILITY_LABELS } from "@/lib/review";
import { deleteReviewAction, saveReviewAction, type ReviewErrorCode, type SaveReviewState } from "../actions";
import type { ReviewFormValues } from "../review-form";
import type { MyReview } from "../reviews";

/** 이미 서비스에 있는 게임은 id로, 아직 가져오지 않은 IGDB 게임(미리보기)은 IGDB ID로 쓴다(처음 쓰는 순간 등록된다). */
export type ReviewTarget = { kind: "game"; gameId: string } | { kind: "igdb"; igdbId: number };

const MESSAGES: Record<ReviewErrorCode, string> = {
  unauthenticated: "로그인이 필요해요.",
  not_found: "게임을 찾을 수 없어요.",
  unavailable: "게임 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.",
  invalid: "처리하지 못했어요. 잠시 후 다시 시도해 주세요.",
  failed: "처리하지 못했어요. 잠시 후 다시 시도해 주세요.",
};

const BADGE = "inline-flex h-6 items-center border border-line-input px-2 text-xs font-normal text-fg";
const TEXTAREA =
  "w-full border border-line-input bg-card px-3 py-2 text-sm font-normal text-fg focus:border-ink aria-[invalid=true]:border-error disabled:cursor-not-allowed disabled:bg-disabled disabled:text-muted";

const toValues = (review: MyReview | null): ReviewFormValues =>
  review ? { body: review.body, hasSpoiler: review.hasSpoiler, visibility: review.visibility } : { body: "", hasSpoiler: false, visibility: "public" };

/**
 * 게임 상세의 `내 기록` 영역의 리뷰. 쓰지 않았으면 `리뷰 쓰기`, 썼으면 공개 범위·좋아요 수와 함께 고치는 폼이다.
 * 리뷰는 평가·라이브러리와 독립이라 평가가 없어도 쓸 수 있다. 지운 뒤에는 입력이 비어 있는 새 폼으로 다시 시작한다.
 */
export function ReviewPanel({ target, review }: { target: ReviewTarget; review: MyReview | null }) {
  // 지워서 리뷰가 없어지면 폼의 상태(방금 저장한 값, 안내 문구)를 버리고 빈 폼으로 다시 시작해야 한다. 서버가 보낸 `review`가
  // 없어지는 순간을 렌더 중에 알아채 번호를 올린다(React가 권하는 "이전 렌더의 값 기억하기"). 삭제 액션이 끝난 뒤에 번호를 올리면
  // 그 시점의 `review`가 아직 이전 값일 수 있어, 새로 그린 `textarea`가 이전 글로 채워진 채 굳는다(한 번 값이 정해지면 `defaultValue`를
  // 따라가지 않는다). 처음 쓰는 경우(없음 → 있음)는 다시 그리지 않아 펼친 폼과 `저장했어요` 안내가 유지된다.
  const [hadReview, setHadReview] = useState(review !== null);
  const [generation, setGeneration] = useState(0);
  if ((review !== null) !== hadReview) {
    setHadReview(review !== null);
    if (review === null) setGeneration((n) => n + 1);
  }
  return <ReviewEditor key={generation} target={target} review={review} />;
}

function ReviewEditor({ target, review }: { target: ReviewTarget; review: MyReview | null }) {
  const [state, formAction, pending] = useActionState<SaveReviewState, FormData>(saveReviewAction, null);
  // 입력은 모두 비제어(defaultValue·defaultChecked)다: 저장이 끝나 React가 폼을 초기화할 때 기본값(=저장한 값)으로 돌아가게 하려는 것이다.
  const values = state?.values ?? toValues(review);
  const errors = state?.errors;

  const [open, setOpen] = useState(false);
  // 저장한 뒤에 다시 고치기 시작하면 `저장했어요` 안내를 거둔다(어느 저장 결과 이후에 고쳤는지만 기억한다).
  const [editedAfter, setEditedAfter] = useState<SaveReviewState>(null);

  const [removing, startRemoving] = useTransition();
  const [removeError, setRemoveError] = useState<ReviewErrorCode | null>(null);
  function remove() {
    if (target.kind !== "game") return;
    if (!window.confirm("이 리뷰를 지울까요?\n좋아요도 함께 사라져요. 평가와 라이브러리는 그대로 남아요.")) return;
    setRemoveError(null);
    startRemoving(async () => {
      try {
        // 성공하면 화면이 다시 그려져 `review`가 없어지고, 위 `ReviewPanel`이 빈 폼으로 다시 시작한다.
        const result = await deleteReviewAction({ gameId: target.gameId });
        if (!result.ok) setRemoveError(result.code);
      } catch {
        setRemoveError("failed");
      }
    });
  }

  return (
    <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)} className="border border-line">
      <summary className="flex min-h-11 cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
        <span className="text-sm font-semibold">{review ? "내 리뷰" : "리뷰 쓰기"}</span>
        {review ? (
          <>
            <span className={BADGE}>{REVIEW_VISIBILITY_LABELS[review.visibility]}</span>
            {review.hasSpoiler ? <span className={BADGE}>스포일러</span> : null}
            <span className="type-body-sm text-muted">좋아요 {review.likeCount}</span>
          </>
        ) : (
          <span className="type-body-sm text-muted">평가 없이도 쓸 수 있어요</span>
        )}
      </summary>

      {/* noValidate: 브라우저 기본 검증 말풍선 대신 서버가 돌려주는 한국어 안내를 쓴다. */}
      <form action={formAction} noValidate onChange={() => setEditedAfter(state)} className="grid gap-5 border-t border-line p-3">
        {target.kind === "game" ? <input type="hidden" name="gameId" value={target.gameId} /> : <input type="hidden" name="igdbId" value={target.igdbId} />}

        <div>
          <label htmlFor="review-body" className="mb-2 block text-sm font-semibold">
            리뷰
          </label>
          <textarea
            id="review-body"
            name="body"
            rows={6}
            defaultValue={values.body}
            // 저장하는 동안 새로 입력한 글은 저장이 끝나고 폼이 초기화될 때 사라지므로 잠근다. 보낼 값은 제출 때 이미 담겼다.
            disabled={pending}
            aria-invalid={errors?.body ? true : undefined}
            aria-describedby={["review-body-hint", errors?.body ? "review-body-error" : null].filter(Boolean).join(" ")}
            className={TEXTAREA}
          />
          <p id="review-body-hint" className="mt-2 text-xs text-muted">
            {MAX_REVIEW_LENGTH.toLocaleString("en-US")}자까지 쓸 수 있어요.
          </p>
          {errors?.body ? (
            <p id="review-body-error" aria-live="polite" className="mt-2 text-xs text-error">
              {errors.body}
            </p>
          ) : null}
        </div>

        <Checkbox name="hasSpoiler" label="스포일러가 포함돼 있어요" defaultChecked={values.hasSpoiler} disabled={pending} />

        <fieldset className="m-0 grid gap-1 border-0 p-0" disabled={pending}>
          <legend className="mb-2 p-0 text-sm font-semibold">공개 범위</legend>
          {REVIEW_VISIBILITIES.map((visibility) => (
            <Radio key={visibility} name="visibility" value={visibility} label={REVIEW_VISIBILITY_LABELS[visibility]} defaultChecked={values.visibility === visibility} />
          ))}
          <p className="mt-1 text-xs text-muted">공개는 모두에게, 비공개는 나에게만 보여요.</p>
          {errors?.visibility ? (
            <p aria-live="polite" className="mt-1 text-xs text-error">
              {errors.visibility}
            </p>
          ) : null}
        </fieldset>

        {state?.error ? (
          <p role="alert" className="type-body-sm">
            {state.error}
          </p>
        ) : null}
        {state?.saved && editedAfter !== state ? (
          <p role="status" className="type-body-sm">
            저장했어요.
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={pending} aria-busy={pending}>
            저장
          </Button>
          {review && target.kind === "game" ? (
            <Button type="button" variant="destructive" onClick={remove} disabled={removing} aria-busy={removing}>
              리뷰 삭제
            </Button>
          ) : null}
        </div>
        {removeError ? (
          <p role="alert" className="type-body-sm">
            {MESSAGES[removeError]}
          </p>
        ) : null}
      </form>
    </details>
  );
}

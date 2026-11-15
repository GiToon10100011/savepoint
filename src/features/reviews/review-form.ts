import { charLength } from "@/features/profiles/handle";
import { MAX_REVIEW_LENGTH, isReviewVisibility, type ReviewVisibility } from "@/lib/review";

/** 서버가 저장하는 값. */
export type ReviewInput = { body: string; hasSpoiler: boolean; visibility: ReviewVisibility };

export type ReviewField = "body" | "visibility";
export type ReviewFormErrors = Partial<Record<ReviewField, string>>;

/** 오류가 났을 때 폼을 다시 채우는 값. */
export type ReviewFormValues = { body: string; hasSpoiler: boolean; visibility: string };

export type ReviewFormResult =
  | { ok: true; data: ReviewInput; values: ReviewFormValues }
  | { ok: false; errors: ReviewFormErrors; values: ReviewFormValues };

const field = (form: FormData, key: string) => {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
};

/**
 * 리뷰 폼 값을 검증한다. 클라이언트가 보낸 값은 믿지 않으므로 서버가 다시 본다(DB 제약과 같은 한도이고 DB가 마지막 방어선이다).
 * 본문은 줄바꿈을 `\n`으로 통일하고 앞뒤 공백을 자른다: 브라우저·운영체제마다 `\r\n`이 섞여 들어와도 글자 수가 DB(`char_length`)와 같게 센다.
 */
export function parseReviewForm(form: FormData): ReviewFormResult {
  const body = field(form, "body").replace(/\r\n?/g, "\n").trim();
  const visibility = field(form, "visibility");
  // 체크 상자는 체크했을 때만 `on`이 넘어온다.
  const hasSpoiler = form.get("hasSpoiler") === "on";
  const values: ReviewFormValues = { body, hasSpoiler, visibility };

  const errors: ReviewFormErrors = {};
  const length = charLength(body);
  if (length === 0) errors.body = "리뷰 내용을 입력해 주세요.";
  else if (length > MAX_REVIEW_LENGTH) errors.body = `리뷰는 ${MAX_REVIEW_LENGTH.toLocaleString("en-US")}자까지 쓸 수 있어요. (지금 ${length.toLocaleString("en-US")}자)`;
  // 값이 없거나 목록에 없으면 공개로 가정하지 않고 거절한다(고르지 않은 채 공개되는 일이 없도록).
  if (!isReviewVisibility(visibility)) errors.visibility = "공개 범위를 골라 주세요.";

  if (errors.body || errors.visibility || !isReviewVisibility(visibility)) return { ok: false, errors, values };
  return { ok: true, data: { body, hasSpoiler, visibility }, values };
}

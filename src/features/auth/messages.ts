export type AuthErrorLike = { code?: string; status?: number } | null | undefined;

const FALLBACK = "문제가 생겨 처리하지 못했어요. 잠시 후 다시 시도해 주세요.";

// Neon Auth(Better Auth)가 돌려주는 코드 중 사용자가 마주치는 것들. 영어 원문 메시지는 화면에 내보내지 않는다.
const MESSAGES: Record<string, string> = {
  // 이메일이 없는 경우와 비밀번호가 틀린 경우를 같은 코드로 돌려준다(가입 여부를 알려 주지 않는다).
  INVALID_EMAIL_OR_PASSWORD: "이메일 또는 비밀번호가 올바르지 않아요.",
  USER_ALREADY_EXISTS: "이미 가입된 이메일이에요. 로그인하거나 다른 이메일을 써 주세요.",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "이미 가입된 이메일이에요. 로그인하거나 다른 이메일을 써 주세요.",
  PASSWORD_TOO_SHORT: "비밀번호는 8자 이상이어야 해요.",
  PASSWORD_TOO_LONG: "비밀번호는 128자 이하여야 해요.",
  VALIDATION_ERROR: "입력한 내용을 다시 확인해 주세요.",
};

export function authErrorMessage(error: AuthErrorLike): string {
  if (error?.code && Object.hasOwn(MESSAGES, error.code)) return MESSAGES[error.code];
  if (error?.status === 429) return "요청이 너무 많아요. 잠시 후 다시 시도해 주세요.";
  return FALLBACK;
}

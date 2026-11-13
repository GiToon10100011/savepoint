export type AuthErrorLike = { code?: string; status?: number; message?: string } | null | undefined;

const FALLBACK = "문제가 생겨 처리하지 못했어요. 잠시 후 다시 시도해 주세요.";
const DUPLICATE_EMAIL = "이미 가입된 이메일이에요. 로그인하거나 다른 이메일을 써 주세요.";

// 서버에서 부르는 `auth.signIn/signUp`은 Better Auth의 오류를 SDK가 Supabase 방식의 소문자 코드로 바꿔 돌려준다
// (HTTP로 직접 보면 보이는 INVALID_EMAIL_OR_PASSWORD 같은 원래 코드는 이 경로에서 보이지 않는다).
// 영어 원문 메시지는 화면에 내보내지 않는다.
const MESSAGES: Record<string, string> = {
  // 이메일이 없는 경우와 비밀번호가 틀린 경우가 같은 코드다(가입 여부를 알려 주지 않는다).
  invalid_credentials: "이메일 또는 비밀번호가 올바르지 않아요.",
  user_already_exists: DUPLICATE_EMAIL,
  email_exists: DUPLICATE_EMAIL,
  // 너무 짧을 때와 너무 길 때가 같은 코드라 범위를 함께 알려 준다.
  weak_password: "비밀번호는 8자 이상 128자 이하로 입력해 주세요.",
  email_address_invalid: "이메일 형식을 확인해 주세요.",
  validation_failed: "입력한 내용을 다시 확인해 주세요.",
  over_request_rate_limit: "요청이 너무 많아요. 잠시 후 다시 시도해 주세요.",
};

export function authErrorMessage(error: AuthErrorLike): string {
  if (!error) return FALLBACK;
  // 이미 가입된 이메일은 Better Auth가 USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL(422)로 거절하는데, SDK의 변환표에
  // 없는 코드라 `validation_failed`로 뭉개져 코드로는 다른 검증 오류와 구분되지 않는다. 원문 메시지로 가린다.
  if (error.message && /already exists/i.test(error.message)) return DUPLICATE_EMAIL;
  if (error.code && Object.hasOwn(MESSAGES, error.code)) return MESSAGES[error.code];
  if (error.status === 429) return MESSAGES.over_request_rate_limit;
  return FALLBACK;
}

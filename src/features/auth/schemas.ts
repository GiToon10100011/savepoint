import { z } from "zod";
import { NICKNAME_MAX, charLength } from "@/features/profiles/handle";

// Neon Auth가 거르는 길이와 맞춘다(PASSWORD_TOO_SHORT/LONG). 서버가 거절하기 전에 같은 말을 먼저 해 준다.
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

const email = z.email("이메일 형식을 확인해 주세요.");
const password = z
  .string()
  .min(PASSWORD_MIN, `비밀번호는 ${PASSWORD_MIN}자 이상이어야 해요.`)
  .max(PASSWORD_MAX, `비밀번호는 ${PASSWORD_MAX}자 이하여야 해요.`);

export const signInSchema = z.object({
  email,
  // 로그인에서는 길이 규칙을 알려 주지 않는다(비어 있는지만 본다).
  password: z.string().min(1, "비밀번호를 입력해 주세요."),
});

export const signUpSchema = z.object({
  name: z
    .string()
    .min(1, "닉네임을 입력해 주세요.")
    .refine((value) => charLength(value) <= NICKNAME_MAX, `닉네임은 ${NICKNAME_MAX}자 이하여야 해요.`),
  email,
  password,
});

export type FieldErrors = Partial<Record<"name" | "email" | "password", string>>;

/** FormData에서 문자열 필드를 꺼낸다. 파일이거나 없으면 빈 문자열이다. 이메일·닉네임은 앞뒤 공백을 지운다. */
export function readForm(formData: FormData, keys: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of keys) {
    const value = formData.get(key);
    const text = typeof value === "string" ? value : "";
    out[key] = key === "password" ? text : text.trim();
  }
  return out;
}

/** zod 오류에서 필드별 첫 메시지만 모은다. */
export function fieldErrors(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path[0];
    if ((key === "name" || key === "email" || key === "password") && !out[key]) out[key] = issue.message;
  }
  return out;
}

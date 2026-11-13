import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { parse } from "dotenv";
import { Client } from "pg";
import { withVerifyFull } from "../../../src/server/db/connection";
import type { Page } from "@playwright/test";

/** E2E가 만드는 계정의 이메일 도메인. 이 패턴의 계정만 정리한다. */
export const E2E_EMAIL_DOMAIN = "savepoint-e2e.example";
export const E2E_PASSWORD = "correct-horse-9";

export type TestUser = { email: string; password: string; nickname: string };

// 워커(프로세스)마다 자기가 만든 계정만 기억한다. 모바일·데스크톱 워커가 서로의 진행 중인 계정을 지우지 않게 한다.
const created: string[] = [];

export function newTestUser(): TestUser {
  const id = randomUUID().slice(0, 8);
  const email = `e2e-${id}@${E2E_EMAIL_DOMAIN}`;
  created.push(email);
  return { email, password: E2E_PASSWORD, nickname: `E2E ${id}` };
}

/**
 * 폼이 **하이드레이션될 때까지** 기다린다. `goto`는 `load`에서 돌아오지만 그때는 이벤트 핸들러가
 * 아직 붙지 않아 바로 누른 입력이 사라질 수 있다(design-system.spec.ts의 openDevUi와 같은 이유).
 */
export async function waitForForm(page: Page) {
  await page.waitForFunction(() => {
    const form = document.querySelector("main form");
    return form !== null && Object.keys(form).some((key) => key.startsWith("__reactProps"));
  });
}

export async function signUp(page: Page, user: TestUser) {
  await page.goto("/auth/sign-up");
  await waitForForm(page);
  await page.getByLabel("닉네임").fill(user.nickname);
  await page.getByLabel("이메일").fill(user.email);
  await page.getByLabel("비밀번호").fill(user.password);
  await page.getByRole("button", { name: "가입하기" }).click();
}

export async function signIn(page: Page, email: string, password: string, query = "") {
  await page.goto(`/auth/sign-in${query}`);
  await waitForForm(page);
  await page.getByLabel("이메일").fill(email);
  await page.getByLabel("비밀번호").fill(password);
  await page.getByRole("button", { name: "로그인" }).click();
}

/**
 * 이 워커가 만든 계정(과 1시간 넘게 남은 이전 실행의 찌꺼기)을 지운다. 프로필은 소유자 연결로 지우고,
 * 인증 사용자는 공식 CLI로 지운다(Neon Auth가 관리하는 테이블을 직접 건드리지 않는다).
 * 정리에 실패해도 테스트 결과를 바꾸지 않고 경고만 남긴다.
 */
export async function cleanupTestUsers() {
  try {
    const adminUrl = parse(readFileSync(".env.local"))["DATABASE_URL_ADMIN"];
    if (!adminUrl) throw new Error(".env.local에 DATABASE_URL_ADMIN이 없다");
    const client = new Client({ connectionString: withVerifyFull(adminUrl) });
    await client.connect();
    try {
      const { rows } = await client.query<{ id: string }>(
        `select id from neon_auth."user"
         where email like $1 and (email = any($2) or "createdAt" < now() - interval '1 hour')`,
        [`e2e-%@${E2E_EMAIL_DOMAIN}`, created],
      );
      const ids = rows.map((row) => row.id);
      if (ids.length === 0) return;
      await client.query("delete from profiles where auth_user_id = any($1)", [ids]);
      for (const id of ids) {
        execFileSync("npx", ["neon", "neon-auth", "user", "delete", id, "--branch", "dev"], { stdio: "ignore" });
      }
    } finally {
      await client.end();
    }
  } catch (error) {
    console.warn(`[e2e] 테스트 계정 정리에 실패했다. 수동으로 지워야 한다: ${error instanceof Error ? error.message : error}`);
  }
}

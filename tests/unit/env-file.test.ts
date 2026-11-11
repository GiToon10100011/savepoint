import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeSecretEnvFile } from "@/server/db/env-file";

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "savepoint-env-"));
  file = path.join(dir, ".env.local");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const mode = () => statSync(file).mode & 0o777;

describe("writeSecretEnvFile", () => {
  it("새 파일은 소유자 전용(600)으로 만든다", () => {
    writeSecretEnvFile(file, { A: "1" });
    expect(mode()).toBe(0o600);
    expect(readFileSync(file, "utf8")).toBe("A=1\n");
  });

  it("이미 644로 만들어 둔 파일도 600으로 좁힌다", () => {
    writeFileSync(file, "# 주석\nB=2\n");
    chmodSync(file, 0o644);
    writeSecretEnvFile(file, { A: "1" });
    expect(mode()).toBe(0o600);
    expect(readFileSync(file, "utf8")).toBe("# 주석\nB=2\nA=1\n");
  });

  it("다시 실행해도 내용과 권한이 그대로다", () => {
    writeSecretEnvFile(file, { A: "1" });
    writeSecretEnvFile(file, { A: "1" });
    expect(mode()).toBe(0o600);
    expect(readFileSync(file, "utf8")).toBe("A=1\n");
  });
});

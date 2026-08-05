import { test, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ORIGINAL_PI_AGENT_DIR = process.env.PI_AGENT_DIR;
let tmpDir: string | undefined;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "omniroute-test-"));
  process.env.PI_AGENT_DIR = tmpDir;
});

afterEach(() => {
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  tmpDir = undefined;
  if (ORIGINAL_PI_AGENT_DIR === undefined) delete process.env.PI_AGENT_DIR;
  else process.env.PI_AGENT_DIR = ORIGINAL_PI_AGENT_DIR;
});

test("readCredential: returns undefined when auth.json does not exist", async () => {
  const { readCredential } = await import("../src/auth-credentials.ts");
  assert.equal(readCredential(), undefined);
});

test("readCredential: returns undefined for malformed JSON, warns once", async () => {
  writeFileSync(join(tmpDir!, "auth.json"), "not json {");
  const { readCredential } = await import("../src/auth-credentials.ts");
  assert.equal(readCredential(), undefined);
});

test("readCredential: returns undefined when no omniroute key", async () => {
  writeFileSync(join(tmpDir!, "auth.json"), JSON.stringify({ anthropic: { key: "x" } }));
  const { readCredential } = await import("../src/auth-credentials.ts");
  assert.equal(readCredential(), undefined);
});

test("readCredential: returns omniroute entry with env", async () => {
  const cred = { type: "api_key", key: "abc", env: { OMNIROUTE_BASE_URL: "https://x/api/v1" } };
  writeFileSync(join(tmpDir!, "auth.json"), JSON.stringify({ omniroute: cred }));
  const { readCredential } = await import("../src/auth-credentials.ts");
  assert.deepEqual(readCredential(), cred);
});

test("resolveStoredBaseUrl: returns baseUrl from credential env", async () => {
  const cred = { type: "api_key", key: "abc", env: { OMNIROUTE_BASE_URL: "https://x/api/v1" } };
  writeFileSync(join(tmpDir!, "auth.json"), JSON.stringify({ omniroute: cred }));
  const { resolveStoredBaseUrl } = await import("../src/auth-credentials.ts");
  assert.equal(resolveStoredBaseUrl(), "https://x/api/v1");
});

test("resolveStoredBaseUrl: returns undefined when env missing", async () => {
  writeFileSync(
    join(tmpDir!, "auth.json"),
    JSON.stringify({ omniroute: { type: "api_key", key: "abc" } }),
  );
  const { resolveStoredBaseUrl } = await import("../src/auth-credentials.ts");
  assert.equal(resolveStoredBaseUrl(), undefined);
});

test("resolveAuthJsonPath: uses PI_AGENT_DIR when set", async () => {
  const { resolveAuthJsonPath } = await import("../src/auth-credentials.ts");
  assert.equal(resolveAuthJsonPath(), join(tmpDir!, "auth.json"));
});

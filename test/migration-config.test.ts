// Verifies the one-time migration of legacy baseUrl sources (old omniroute.json
// + auth.json credential env) into the settings.json `pi-provider-omniroute`
// block, per Task 3 of the standardize-login spec.
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateLegacyConfig, readOmnirouteConfig, writeOmnirouteBaseUrl } from "../src/tools/search-config.ts";

const origPiAgentDir = process.env.PI_AGENT_DIR;
const origEnv = process.env.OMNIROUTE_BASE_URL;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "omniroute-migration-test-"));
  process.env.PI_AGENT_DIR = dir;
  delete process.env.OMNIROUTE_BASE_URL;
});
after(() => {
  if (origPiAgentDir === undefined) delete process.env.PI_AGENT_DIR;
  else process.env.PI_AGENT_DIR = origPiAgentDir;
  if (origEnv === undefined) delete process.env.OMNIROUTE_BASE_URL;
  else process.env.OMNIROUTE_BASE_URL = origEnv;
});

function seedLegacy(url: string) {
  writeFileSync(join(dir, "auth.json"), JSON.stringify({ omniroute: { type: "api_key", key: "k", env: { OMNIROUTE_BASE_URL: url } } }));
}

// 旧版配置文件：baseUrl + search + fetch 并存
function seedOldConfig() {
  writeFileSync(join(dir, "omniroute.json"), JSON.stringify({ baseUrl: "https://legacy-cfg.example/v1", search: { provider: "tavily-search" }, fetch: { provider: "firecrawl" } }));
}

test("migrateLegacyConfig: migrates legacy auth.json baseUrl into block when nothing else set", () => {
  seedLegacy("https://legacy.example/v1");
  const result = migrateLegacyConfig();
  assert.equal(result, "https://legacy.example/v1");
  assert.equal(readOmnirouteConfig().baseUrl, "https://legacy.example/v1");
});

test("migrateLegacyConfig: merges old omniroute.json (baseUrl+search+fetch) into block and deletes the file", () => {
  seedOldConfig();
  const result = migrateLegacyConfig();
  assert.equal(result, "https://legacy-cfg.example/v1");
  const cfg = readOmnirouteConfig();
  assert.equal(cfg.baseUrl, "https://legacy-cfg.example/v1");
  assert.deepEqual(cfg.search, { provider: "tavily-search" });
  assert.deepEqual(cfg.fetch, { provider: "firecrawl" });
  assert.throws(() => readFileSync(join(dir, "omniroute.json"), "utf8"), /ENOENT/, "old file deleted after successful migration");
});

test("migrateLegacyConfig: does not overwrite block fields already present; old file still deleted", () => {
  writeFileSync(join(dir, "settings.json"), JSON.stringify({ "pi-provider-omniroute": { search: { provider: "brave-search" } } }));
  seedOldConfig();
  const result = migrateLegacyConfig();
  assert.equal(result, "https://legacy-cfg.example/v1");
  const cfg = readOmnirouteConfig();
  assert.equal(cfg.baseUrl, "https://legacy-cfg.example/v1");
  assert.deepEqual(cfg.search, { provider: "brave-search" }, "existing block field wins");
  assert.throws(() => readFileSync(join(dir, "omniroute.json"), "utf8"), /ENOENT/);
});

test("migrateLegacyConfig: falls back to auth.json legacy when old file has no baseUrl; old file still deleted", () => {
  writeFileSync(join(dir, "omniroute.json"), JSON.stringify({ search: { provider: "serper-search" } }));
  seedLegacy("https://legacy.example/v1");
  const result = migrateLegacyConfig();
  assert.equal(result, "https://legacy.example/v1");
  assert.equal(readOmnirouteConfig().baseUrl, "https://legacy.example/v1");
  assert.deepEqual(readOmnirouteConfig().search, { provider: "serper-search" });
  assert.throws(() => readFileSync(join(dir, "omniroute.json"), "utf8"), /ENOENT/);
});

test("migrateLegacyConfig: no-op when block already has baseUrl", () => {
  writeFileSync(join(dir, "settings.json"), JSON.stringify({ "pi-provider-omniroute": { baseUrl: "https://cfg.example/v1" } }));
  seedOldConfig();
  seedLegacy("https://legacy.example/v1");
  assert.equal(migrateLegacyConfig(), undefined);
  assert.equal(readOmnirouteConfig().baseUrl, "https://cfg.example/v1");
  assert.ok(readFileSync(join(dir, "omniroute.json"), "utf8"), "no migration → old file untouched");
});

test("migrateLegacyConfig: no-op when OMNIROUTE_BASE_URL env is set", () => {
  process.env.OMNIROUTE_BASE_URL = "https://env.example/v1";
  seedLegacy("https://legacy.example/v1");
  assert.equal(migrateLegacyConfig(), undefined);
  assert.equal(readOmnirouteConfig().baseUrl, undefined);
});

test("migrateLegacyConfig: returns undefined when no legacy source", () => {
  assert.equal(migrateLegacyConfig(), undefined);
  assert.deepEqual(readOmnirouteConfig(), {});
});

test("migrateLegacyConfig: idempotent — second call does nothing", () => {
  seedLegacy("https://legacy.example/v1");
  migrateLegacyConfig();
  assert.equal(migrateLegacyConfig(), undefined);
});

test("migrateLegacyConfig: old file kept on write failure (retry next startup)", () => {
  seedOldConfig();
  chmodSync(dir, 0o500); // settings.json 写入将失败
  const origWarn = console.warn;
  console.warn = () => {};
  try {
    const result = migrateLegacyConfig();
    assert.equal(result, "https://legacy-cfg.example/v1", "returns migrated value; in-memory state carries the session");
  } finally {
    console.warn = origWarn;
    chmodSync(dir, 0o700);
  }
  const oldCfg = JSON.parse(readFileSync(join(dir, "omniroute.json"), "utf8"));
  assert.equal(oldCfg.baseUrl, "https://legacy-cfg.example/v1", "old file NOT deleted when migration write failed");
});

test("migrateLegacyConfig: strips OMNIROUTE_BASE_URL from auth.json after source-② migration, preserving other keys", () => {
  writeFileSync(join(dir, "auth.json"), JSON.stringify({
    omniroute: { type: "api_key", key: "k", env: { OMNIROUTE_BASE_URL: "https://legacy.example/v1", OTHER: "x" } },
    anotherProvider: { type: "api_key", key: "other" },
  }));
  assert.equal(migrateLegacyConfig(), "https://legacy.example/v1");
  const auth = JSON.parse(readFileSync(join(dir, "auth.json"), "utf8"));
  assert.equal(auth.omniroute.key, "k", "credential preserved");
  assert.deepEqual(auth.omniroute.env, { OTHER: "x" }, "baseUrl env removed; other env keys kept");
  assert.equal(auth.anotherProvider.key, "other", "other providers preserved");
});

test("migrateLegacyConfig: removes the credential env entirely when it becomes empty", () => {
  seedLegacy("https://legacy.example/v1");
  migrateLegacyConfig();
  const auth = JSON.parse(readFileSync(join(dir, "auth.json"), "utf8"));
  assert.equal(auth.omniroute.key, "k");
  assert.equal("env" in auth.omniroute, false, "empty env dropped from credential");
});

test("migrateLegacyConfig: a user reset is not resurrected by the next session_start (legacy env stripped)", () => {
  seedLegacy("https://legacy.example/v1");
  assert.equal(migrateLegacyConfig(), "https://legacy.example/v1");
  // User resets Base URL in the menu (spec B4: empty input deletes the field).
  writeOmnirouteBaseUrl(undefined);
  assert.equal(readOmnirouteConfig().baseUrl, undefined);
  // Next session start must not re-migrate the (now stripped) legacy value.
  assert.equal(migrateLegacyConfig(), undefined, "no re-migration");
  assert.equal(readOmnirouteConfig().baseUrl, undefined);
});

test("migrateLegacyConfig: source-② strip is skipped when the block write failed (env kept for retry)", () => {
  seedLegacy("https://legacy.example/v1");
  chmodSync(dir, 0o500); // settings.json 写入将失败
  const origWarn = console.warn;
  console.warn = () => {};
  try {
    migrateLegacyConfig();
  } finally {
    console.warn = origWarn;
    chmodSync(dir, 0o700);
  }
  const auth = JSON.parse(readFileSync(join(dir, "auth.json"), "utf8"));
  assert.equal(auth.omniroute.env.OMNIROUTE_BASE_URL, "https://legacy.example/v1", "env kept so next startup can retry");
});

test("migrateLegacyConfig: non-string auth.json legacy value is ignored (no perpetual re-migration)", () => {
  writeFileSync(join(dir, "auth.json"), JSON.stringify({ omniroute: { type: "api_key", key: "k", env: { OMNIROUTE_BASE_URL: 42 } } }));
  assert.equal(migrateLegacyConfig(), undefined);
  assert.equal(readOmnirouteConfig().baseUrl, undefined, "non-string legacy value must not be written to the block");
});

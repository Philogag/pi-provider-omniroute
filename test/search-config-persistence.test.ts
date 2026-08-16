import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  resolveAgentSettingsPath,
  readOmnirouteConfig,
  writeOmnirouteConfig,
  resolveOmnirouteBaseUrl,
  writeOmnirouteBaseUrl,
  parseBaseUrlInput,
} from "../src/tools/search-config.ts";

const origPiAgentDir = process.env.PI_AGENT_DIR;
let dir: string;

// settings.json helper: the omniroute config lives in the
// `pi-provider-omniroute` block, alongside pi's own root keys.
const SETTINGS = (block: Record<string, unknown>) =>
  JSON.stringify(
    {
      packages: ["npm:@philogag/pi-provider-omniroute"],
      theme: "dark",
      "pi-provider-omniroute": block,
    },
    null,
    2,
  ) + "\n";

function settingsPath() {
  return join(dir, "settings.json");
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "omniroute-config-test-"));
  process.env.PI_AGENT_DIR = dir;
});
after(() => {
  if (origPiAgentDir === undefined) delete process.env.PI_AGENT_DIR;
  else process.env.PI_AGENT_DIR = origPiAgentDir;
});

test("resolveAgentSettingsPath honors PI_AGENT_DIR", () => {
  assert.equal(resolveAgentSettingsPath(), join(dir, "settings.json"));
});

test("readOmnirouteConfig: missing file returns {}", () => {
  assert.deepEqual(readOmnirouteConfig(), {});
});

test("writeOmnirouteConfig: creates file when absent", () => {
  writeOmnirouteConfig("tavily-search");
  const out = JSON.parse(readFileSync(settingsPath(), "utf8"));
  assert.deepEqual(out, { "pi-provider-omniroute": { search: { provider: "tavily-search" } } });
});

test("writeOmnirouteConfig: round-trips through read", () => {
  writeOmnirouteConfig("brave-search");
  assert.deepEqual(readOmnirouteConfig(), { search: { provider: "brave-search" } });
});

test("writeOmnirouteConfig(undefined) removes search key", () => {
  writeOmnirouteConfig("tavily-search");
  writeOmnirouteConfig(undefined);
  const out = JSON.parse(readFileSync(settingsPath(), "utf8"));
  assert.equal(out["pi-provider-omniroute"].search, undefined);
  assert.deepEqual(out["pi-provider-omniroute"], {});
});

test("writeOmnirouteConfig preserves unrelated root keys", () => {
  const seedPath = settingsPath();
  writeFileSync(seedPath, JSON.stringify({ "pi-provider-omniroute": { search: { provider: "tavily-search" } }, model: { theme: "dark" } }));
  writeOmnirouteConfig("brave-search");
  const out = JSON.parse(readFileSync(seedPath, "utf8"));
  assert.equal(out["pi-provider-omniroute"].search.provider, "brave-search");
  assert.deepEqual(out.model, { theme: "dark" });
});

test("readOmnirouteConfig: malformed JSON returns {}", () => {
  writeFileSync(settingsPath(), "this is not json {");
  assert.deepEqual(readOmnirouteConfig(), {});
});

test("readOmnirouteConfig: non-object root returns {} (spec G6)", () => {
  for (const v of [null, [1, 2, 3], "string", 42]) {
    writeFileSync(settingsPath(), JSON.stringify(v));
    assert.deepEqual(readOmnirouteConfig(), {}, `root ${JSON.stringify(v)} must return {}`);
  }
});

test("readOmnirouteConfig: search is non-object returns {} (spec G7)", () => {
  for (const v of ["tavily-search", 42, [1], null]) {
    writeFileSync(settingsPath(), JSON.stringify({ "pi-provider-omniroute": { search: v } }));
    assert.deepEqual(readOmnirouteConfig(), {}, `search ${JSON.stringify(v)} must return {}`);
  }
});

test("readOmnirouteConfig: provider present but not a string returns {}", () => {
  writeFileSync(settingsPath(), JSON.stringify({ "pi-provider-omniroute": { search: { provider: 42 } } }));
  assert.deepEqual(readOmnirouteConfig(), {});
});

test("readOmnirouteConfig: non-object root warns exactly once (spec G6)", () => {
  writeFileSync(settingsPath(), JSON.stringify(42));
  const origWarn = console.warn;
  let warns = 0;
  console.warn = () => { warns += 1; };
  try {
    readOmnirouteConfig();
  } finally {
    console.warn = origWarn;
  }
  assert.equal(warns, 1, "expected exactly one console.warn for non-object root");
});

test("readOmnirouteConfig: non-object search warns exactly once (spec G7)", () => {
  writeFileSync(settingsPath(), JSON.stringify({ "pi-provider-omniroute": { search: 42 } }));
  const origWarn = console.warn;
  let warns = 0;
  console.warn = () => { warns += 1; };
  try {
    readOmnirouteConfig();
  } finally {
    console.warn = origWarn;
  }
  assert.equal(warns, 1, "expected exactly one console.warn for non-object search");
});

test("readOmnirouteConfig: non-string provider warns exactly once", () => {
  writeFileSync(settingsPath(), JSON.stringify({ "pi-provider-omniroute": { search: { provider: 42 } } }));
  const origWarn = console.warn;
  let warns = 0;
  console.warn = () => { warns += 1; };
  try {
    readOmnirouteConfig();
  } finally {
    console.warn = origWarn;
  }
  assert.equal(warns, 1, "expected exactly one console.warn for non-string provider");
});

test("writeOmnirouteConfig(key='fetch') writes fetch branch and preserves search", () => {
  writeOmnirouteConfig("tavily-search");
  writeOmnirouteConfig("firecrawl", "fetch");
  const out = JSON.parse(readFileSync(settingsPath(), "utf8"));
  assert.deepEqual(out, { "pi-provider-omniroute": { search: { provider: "tavily-search" }, fetch: { provider: "firecrawl" } } });
});

test("writeOmnirouteConfig(undefined, 'fetch') removes fetch key only", () => {
  writeOmnirouteConfig("tavily-search");
  writeOmnirouteConfig("firecrawl", "fetch");
  writeOmnirouteConfig(undefined, "fetch");
  const out = JSON.parse(readFileSync(settingsPath(), "utf8"));
  assert.deepEqual(out["pi-provider-omniroute"], { search: { provider: "tavily-search" } });
});

test("readOmnirouteConfig: reads both branches independently", () => {
  writeFileSync(settingsPath(), JSON.stringify({ "pi-provider-omniroute": { search: { provider: "tavily-search" }, fetch: { provider: "firecrawl" } } }));
  assert.deepEqual(readOmnirouteConfig(), { search: { provider: "tavily-search" }, fetch: { provider: "firecrawl" } });
});

test("readOmnirouteConfig: non-object fetch warns once but search is still read", () => {
  writeFileSync(settingsPath(), JSON.stringify({ "pi-provider-omniroute": { search: { provider: "tavily-search" }, fetch: 42 } }));
  const origWarn = console.warn;
  let warns = 0;
  console.warn = () => { warns += 1; };
  let cfg: unknown;
  try {
    cfg = readOmnirouteConfig();
  } finally {
    console.warn = origWarn;
  }
  assert.equal(warns, 1, "exactly one warn for non-object fetch");
  assert.deepEqual(cfg, { search: { provider: "tavily-search" } });
});

test("readOmnirouteConfig: reads baseUrl string", () => {
  writeFileSync(settingsPath(), JSON.stringify({ "pi-provider-omniroute": { baseUrl: "https://route.ai.philogag.com/v1" } }));
  assert.deepEqual(readOmnirouteConfig(), { baseUrl: "https://route.ai.philogag.com/v1" });
});

test("readOmnirouteConfig: non-string baseUrl warns once and stays unset", () => {
  writeFileSync(settingsPath(), JSON.stringify({ "pi-provider-omniroute": { baseUrl: 42 } }));
  const origWarn = console.warn;
  let warns = 0;
  console.warn = () => { warns += 1; };
  let cfg: unknown;
  try {
    cfg = readOmnirouteConfig();
  } finally {
    console.warn = origWarn;
  }
  assert.equal(warns, 1, "exactly one warn for non-string baseUrl");
  assert.deepEqual(cfg, {});
});

test("resolveOmnirouteBaseUrl: settings.json block baseUrl wins over env", () => {
  writeFileSync(join(dir, "settings.json"), JSON.stringify({ "pi-provider-omniroute": { baseUrl: "https://route.ai.philogag.com/v1" } }));
  process.env.OMNIROUTE_BASE_URL = "https://env.example/v1";
  try {
    assert.equal(resolveOmnirouteBaseUrl(), "https://route.ai.philogag.com/v1");
  } finally {
    delete process.env.OMNIROUTE_BASE_URL;
  }
});

test("resolveOmnirouteBaseUrl: falls back to env when no baseUrl in file", () => {
  process.env.OMNIROUTE_BASE_URL = "https://env.example/v1";
  try {
    assert.equal(resolveOmnirouteBaseUrl(), "https://env.example/v1");
  } finally {
    delete process.env.OMNIROUTE_BASE_URL;
  }
});

test("resolveOmnirouteBaseUrl: legacy auth.json env is NOT consulted (migration-only)", () => {
  writeFileSync(join(dir, "auth.json"), JSON.stringify({ omniroute: { type: "api_key", key: "k", env: { OMNIROUTE_BASE_URL: "https://legacy.example/v1" } } }));
  assert.equal(resolveOmnirouteBaseUrl(), "http://localhost:20128/v1");
});

test("resolveOmnirouteBaseUrl: default when nothing configured", () => {
  assert.equal(resolveOmnirouteBaseUrl(), "http://localhost:20128/v1");
});

test("writeOmnirouteConfig: write failure (read-only dir) warns but does not throw", () => {
  writeOmnirouteConfig("tavily-search");
  chmodSync(dir, 0o500);  // read+execute only
  // Should not throw; should warn to console.
  const origWarn = console.warn;
  let warned = false;
  console.warn = (...args: unknown[]) => { if (String(args[0]).includes("omniroute")) warned = true; };
  try {
    writeOmnirouteConfig("brave-search");
  } finally {
    console.warn = origWarn;
    chmodSync(dir, 0o700);  // restore for cleanup
  }
  assert.equal(warned, true, "expected a console.warn");
});

test("writeOmnirouteConfig: non-object pi-provider-omniroute block (42) does not throw and is replaced (Finding 1)", () => {
  writeFileSync(settingsPath(), JSON.stringify({ "pi-provider-omniroute": 42 }, null, 2));
  writeOmnirouteConfig("tavily-search");
  const out = JSON.parse(readFileSync(settingsPath(), "utf8"));
  assert.deepEqual(out["pi-provider-omniroute"], { search: { provider: "tavily-search" } });
});

// --- writeOmnirouteBaseUrl ---

test("writeOmnirouteBaseUrl: writes baseUrl into the pi-provider-omniroute block of settings.json", () => {
  writeFileSync(settingsPath(), SETTINGS({}));
  writeOmnirouteBaseUrl("https://route.example/v1");
  const out = JSON.parse(readFileSync(settingsPath(), "utf8"));
  assert.deepEqual(out["pi-provider-omniroute"], { baseUrl: "https://route.example/v1" });
  assert.ok(Array.isArray(out.packages), "settings.json root keys preserved");
});

test("writeOmnirouteBaseUrl: undefined removes block.baseUrl and preserves other root keys", () => {
  writeFileSync(settingsPath(), SETTINGS({ baseUrl: "https://x/v1", search: { provider: "tavily-search" } }));
  writeOmnirouteBaseUrl(undefined);
  const out = JSON.parse(readFileSync(settingsPath(), "utf8"));
  assert.equal(out["pi-provider-omniroute"].baseUrl, undefined);
  assert.deepEqual(out["pi-provider-omniroute"].search, { provider: "tavily-search" });
  assert.deepEqual(out.packages, ["npm:@philogag/pi-provider-omniroute"], "packages key preserved");
});

test("writeOmnirouteBaseUrl: creates the block when settings.json exists without it", () => {
  writeFileSync(settingsPath(), JSON.stringify({ theme: "dark" }, null, 2));
  writeOmnirouteBaseUrl("https://route.example/v1");
  const out = JSON.parse(readFileSync(settingsPath(), "utf8"));
  assert.deepEqual(out["pi-provider-omniroute"], { baseUrl: "https://route.example/v1" });
  assert.equal(out.theme, "dark");
});

test("writeOmnirouteBaseUrl: round-trips through readOmnirouteConfig", () => {
  writeOmnirouteBaseUrl("https://route.example/v1");
  assert.equal(readOmnirouteConfig().baseUrl, "https://route.example/v1");
  writeOmnirouteBaseUrl(undefined);
  assert.equal(readOmnirouteConfig().baseUrl, undefined);
});

test("writeOmnirouteBaseUrl: write failure (read-only dir) warns but does not throw", () => {
  writeOmnirouteBaseUrl("https://x/v1");
  chmodSync(dir, 0o500);
  const origWarn = console.warn;
  let warned = false;
  console.warn = (...args: unknown[]) => { if (String(args[0]).includes("omniroute")) warned = true; };
  try {
    writeOmnirouteBaseUrl("https://y/v1");
  } finally {
    console.warn = origWarn;
    chmodSync(dir, 0o700);
  }
  assert.equal(warned, true);
});

test("writeOmnirouteBaseUrl: non-object pi-provider-omniroute block (42) does not throw and is replaced (Finding 1)", () => {
  writeFileSync(settingsPath(), JSON.stringify({ "pi-provider-omniroute": 42 }, null, 2));
  writeOmnirouteBaseUrl("http://example.com/v1");
  // Must not throw; the block must become a plain object with baseUrl set, and the file must be valid JSON.
  const out = JSON.parse(readFileSync(settingsPath(), "utf8"));
  assert.deepEqual(out["pi-provider-omniroute"], { baseUrl: "http://example.com/v1" });
});

test("writeOmnirouteBaseUrl(undefined): does not materialize an empty block when the file has none (Finding 2)", () => {
  writeFileSync(settingsPath(), JSON.stringify({ theme: "dark" }, null, 2));
  writeOmnirouteBaseUrl(undefined);
  const out = JSON.parse(readFileSync(settingsPath(), "utf8"));
  assert.equal(out["pi-provider-omniroute"], undefined, "no pi-provider-omniroute key should be created on delete");
  assert.deepEqual(out.theme, "dark");
});

// --- parseBaseUrlInput ---

test("parseBaseUrlInput: valid URL returns normalized value", () => {
  assert.deepEqual(parseBaseUrlInput("  https://route.example/v1  "), { ok: true, value: "https://route.example/v1" });
});

test("parseBaseUrlInput: empty or whitespace means reset (undefined)", () => {
  assert.deepEqual(parseBaseUrlInput(""), { ok: true, value: undefined });
  assert.deepEqual(parseBaseUrlInput("   "), { ok: true, value: undefined });
});

test("parseBaseUrlInput: invalid URL returns error", () => {
  const r = parseBaseUrlInput("not-a-url");
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /Invalid base URL/);
});

test("parseBaseUrlInput: non-http protocol returns error", () => {
  const r = parseBaseUrlInput("ftp://x/v1");
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /http\(s\)/);
});

test("parseBaseUrlInput: missing /v1 suffix is still valid (warns)", () => {
  const origWarn = console.warn;
  console.warn = () => {};
  try {
    assert.deepEqual(parseBaseUrlInput("https://route.example"), { ok: true, value: "https://route.example" });
  } finally {
    console.warn = origWarn;
  }
});

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, chmodSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  resolveOmnirouteConfigPath,
  readOmnirouteConfig,
  writeOmnirouteConfig,
} from "../src/tools/search-config.ts";

const origPiAgentDir = process.env.PI_AGENT_DIR;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "omniroute-config-test-"));
  process.env.PI_AGENT_DIR = dir;
});
after(() => {
  if (origPiAgentDir === undefined) delete process.env.PI_AGENT_DIR;
  else process.env.PI_AGENT_DIR = origPiAgentDir;
});

test("resolveOmnirouteConfigPath honors PI_AGENT_DIR", () => {
  assert.equal(resolveOmnirouteConfigPath(), join(dir, "omniroute.json"));
});

test("readOmnirouteConfig: missing file returns {}", () => {
  assert.deepEqual(readOmnirouteConfig(), {});
});

test("writeOmnirouteConfig: creates file when absent", () => {
  writeOmnirouteConfig("tavily-search");
  const out = JSON.parse(readFileSync(join(dir, "omniroute.json"), "utf8"));
  assert.deepEqual(out, { search: { provider: "tavily-search" } });
});

test("writeOmnirouteConfig: round-trips through read", () => {
  writeOmnirouteConfig("brave-search");
  assert.deepEqual(readOmnirouteConfig(), { provider: "brave-search" });
});

test("writeOmnirouteConfig(undefined) removes search key", () => {
  writeOmnirouteConfig("tavily-search");
  writeOmnirouteConfig(undefined);
  const out = JSON.parse(readFileSync(join(dir, "omniroute.json"), "utf8"));
  assert.equal(out.search, undefined);
  assert.deepEqual(out, {});
});

test("writeOmnirouteConfig preserves unrelated root keys", () => {
  const seedPath = join(dir, "omniroute.json");
  writeFileSync(seedPath, JSON.stringify({ search: { provider: "tavily-search" }, model: { theme: "dark" } }));
  writeOmnirouteConfig("brave-search");
  const out = JSON.parse(readFileSync(seedPath, "utf8"));
  assert.equal(out.search.provider, "brave-search");
  assert.deepEqual(out.model, { theme: "dark" });
});

test("readOmnirouteConfig: malformed JSON returns {}", () => {
  const seedPath = join(dir, "omniroute.json");
  writeFileSync(seedPath, "this is not json {");
  assert.deepEqual(readOmnirouteConfig(), {});
});

test("readOmnirouteConfig: non-object root returns {} (spec G6)", () => {
  const seedPath = join(dir, "omniroute.json");
  for (const v of [null, [1, 2, 3], "string", 42]) {
    writeFileSync(seedPath, JSON.stringify(v));
    assert.deepEqual(readOmnirouteConfig(), {}, `root ${JSON.stringify(v)} must return {}`);
  }
});

test("readOmnirouteConfig: search is non-object returns {} (spec G7)", () => {
  const seedPath = join(dir, "omniroute.json");
  for (const v of ["tavily-search", 42, [1], null]) {
    writeFileSync(seedPath, JSON.stringify({ search: v }));
    assert.deepEqual(readOmnirouteConfig(), {}, `search ${JSON.stringify(v)} must return {}`);
  }
});

test("readOmnirouteConfig: provider present but not a string returns {}", () => {
  const seedPath = join(dir, "omniroute.json");
  writeFileSync(seedPath, JSON.stringify({ search: { provider: 42 } }));
  assert.deepEqual(readOmnirouteConfig(), {});
});

test("writeOmnirouteConfig: write failure (read-only dir) warns but does not throw", () => {
  writeOmnirouteConfig("tavily-search");
  chmodSync(dir, 0o500);  // read+execute only
  // Re-acquire path; PI_AGENT_DIR is unchanged.
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

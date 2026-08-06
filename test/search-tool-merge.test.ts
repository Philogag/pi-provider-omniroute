import { test, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionContext, AgentToolResult } from "@earendil-works/pi-coding-agent";
import { searchTool, setSearchConfigReader, SEARCH_PROVIDERS } from "../src/tools/search.ts";

const execTool = searchTool as unknown as {
  execute: (...args: unknown[]) => Promise<AgentToolResult<unknown>>;
};

async function runSearchWithParams(params: Record<string, unknown>): Promise<unknown> {
  // Capture the POST body sent to /search.
  let lastBody: unknown;
  const origFetch = globalThis.fetch;
  globalThis.fetch = mock.method(globalThis, "fetch", async (_url: string, init?: RequestInit) => {
    lastBody = init?.body ? JSON.parse(init.body as string) : undefined;
    return { ok: true, status: 200, json: async () => ({ results: [] }) } as Response;
  }) as never;
  try {
    // Invoke searchTool.execute directly with the params.
    await execTool.execute("call-id", params, undefined, () => {}, {
      ui: { notify: () => {} },
      sessionManager: { getBranch: () => [] },
      modelRegistry: { getApiKeyForProvider: () => "test-key" } as never,
    } as unknown as ExtensionContext);
  } finally {
    globalThis.fetch = origFetch;
  }
  return lastBody;
}

const origPiAgentDir = process.env.PI_AGENT_DIR;
const origBaseUrl = process.env.OMNIROUTE_BASE_URL;
before(() => {
  // First, load the extension so searchTool is exported; mock api key path.
  process.env.PI_AGENT_DIR = mkdtempSync(join(tmpdir(), "omniroute-search-merge-test-"));
  delete process.env.OMNIROUTE_BASE_URL;
  // Pre-populate an auth.json with a fake API key so resolveApiKey succeeds.
  // (The auth module reads auth.json; for tests, we keep the env clean and the tool will fall back to env OMNIROUTE_API_KEY.)
  process.env.OMNIROUTE_API_KEY = "test-key";
});
after(() => {
  if (origPiAgentDir === undefined) delete process.env.PI_AGENT_DIR;
  else process.env.PI_AGENT_DIR = origPiAgentDir;
  if (origBaseUrl === undefined) delete process.env.OMNIROUTE_BASE_URL;
  else process.env.OMNIROUTE_BASE_URL = origBaseUrl;
  delete process.env.OMNIROUTE_API_KEY;
});

test("explicit params.provider overrides config", async () => {
  setSearchConfigReader(() => "tavily-search");
  const body = await runSearchWithParams({ query: "hi", provider: "exa-search" });
  assert.equal((body as { provider?: string }).provider, "exa-search");
});

test("config provider is injected when params.provider is undefined", async () => {
  setSearchConfigReader(() => "tavily-search");
  const body = await runSearchWithParams({ query: "hi" });
  assert.equal((body as { provider?: string }).provider, "tavily-search");
});

test("config undefined or 'auto' omits provider from body", async () => {
  for (const v of [undefined, "auto"]) {
    setSearchConfigReader(() => v);
    const body = await runSearchWithParams({ query: "hi" });
    assert.equal((body as { provider?: string }).provider, undefined, `config=${v}`);
  }
});

test("config is invalid string (not in static list) is omitted (defensive)", async () => {
  setSearchConfigReader(() => "unknown-provider");
  const body = await runSearchWithParams({ query: "hi" });
  assert.equal((body as { provider?: string }).provider, undefined);
});

test("SEARCH_PROVIDERS still has 14 static entries (re-export)", () => {
  assert.equal(SEARCH_PROVIDERS.length, 14);
});

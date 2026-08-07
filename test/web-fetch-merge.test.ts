import { test, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionContext, AgentToolResult } from "@earendil-works/pi-coding-agent";
import { normalizeFetchProvider, FETCH_PROVIDERS, webFetchTool, setFetchConfigReader } from "../src/tools/web-fetch.ts";

test("FETCH_PROVIDERS is the canonical static 4", () => {
  assert.deepEqual([...FETCH_PROVIDERS], ["firecrawl", "jina-reader", "tavily-search", "tinyfish"]);
});

test("normalizeFetchProvider: member id passes through", () => {
  for (const id of FETCH_PROVIDERS) {
    assert.equal(normalizeFetchProvider(id), id);
  }
});

test("normalizeFetchProvider: undefined / auto / invalid id -> undefined", () => {
  for (const v of [undefined, "auto", "unknown-provider", ""]) {
    assert.equal(normalizeFetchProvider(v), undefined, `raw=${String(v)}`);
  }
});

const execTool = webFetchTool as unknown as {
  execute: (...args: unknown[]) => Promise<AgentToolResult<unknown>>;
};

async function runFetchWithParams(params: Record<string, unknown>): Promise<unknown> {
  let lastBody: unknown;
  const origFetch = globalThis.fetch;
  globalThis.fetch = mock.method(globalThis, "fetch", async (_url: string, init?: RequestInit) => {
    lastBody = init?.body ? JSON.parse(init.body as string) : undefined;
    return { ok: true, status: 200, json: async () => ({ markdown: "# ok" }) } as Response;
  }) as never;
  try {
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
before(() => {
  process.env.PI_AGENT_DIR = mkdtempSync(join(tmpdir(), "omniroute-fetch-merge-test-"));
  process.env.OMNIROUTE_API_KEY = "test-key";
});
after(() => {
  if (origPiAgentDir === undefined) delete process.env.PI_AGENT_DIR;
  else process.env.PI_AGENT_DIR = origPiAgentDir;
  delete process.env.OMNIROUTE_API_KEY;
  setFetchConfigReader(() => undefined);
});

test("fetch: explicit params.provider overrides config", async () => {
  setFetchConfigReader(() => "firecrawl");
  const body = await runFetchWithParams({ url: "https://x", provider: "tinyfish" });
  assert.equal((body as { provider?: string }).provider, "tinyfish");
});

test("fetch: config provider is injected when params.provider is undefined", async () => {
  setFetchConfigReader(() => "jina-reader");
  const body = await runFetchWithParams({ url: "https://x" });
  assert.equal((body as { provider?: string }).provider, "jina-reader");
});

test("fetch: config undefined or 'auto' omits provider from body", async () => {
  for (const v of [undefined, "auto"]) {
    setFetchConfigReader(() => v);
    const body = await runFetchWithParams({ url: "https://x" });
    assert.equal((body as { provider?: string }).provider, undefined, `config=${v}`);
  }
});

test("fetch: config invalid string (not in static list) is omitted (defensive)", async () => {
  setFetchConfigReader(() => "unknown-provider");
  const body = await runFetchWithParams({ url: "https://x" });
  assert.equal((body as { provider?: string }).provider, undefined);
});

test("fetch: explicit params.provider is not schema-gated here (schema test covers literals)", async () => {
  setFetchConfigReader(() => undefined);
  const body = await runFetchWithParams({ url: "https://x", provider: "firecrawl" });
  assert.equal((body as { provider?: string }).provider, "firecrawl");
});

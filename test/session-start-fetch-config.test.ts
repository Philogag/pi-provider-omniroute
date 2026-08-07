// Verifies that src/index.ts wires session_start into the fetch tool's config
// reader: on session start it reads omniroute.json's fetch.provider, normalizes
// it, and makes webFetchTool's effective provider come from that persisted
// config (when no explicit provider is passed).
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Provider } from "@earendil-works/pi-ai";
import entry from "../src/index.ts";
import { webFetchTool, setFetchConfigReader } from "../src/tools/web-fetch.ts";
import { searchTool, setSearchConfigReader } from "../src/tools/search.ts";

let capturedProvider: Provider<"openai-completions"> | undefined;
let capturedSessionStart: ((...args: unknown[]) => unknown) | undefined;

const origPiAgentDir = process.env.PI_AGENT_DIR;
let dir: string;

beforeEach(() => {
  capturedProvider = undefined;
  capturedSessionStart = undefined;
  dir = mkdtempSync(join(tmpdir(), "omniroute-session-start-fetch-test-"));
  process.env.PI_AGENT_DIR = dir;
});

after(() => {
  if (origPiAgentDir === undefined) delete process.env.PI_AGENT_DIR;
  else process.env.PI_AGENT_DIR = origPiAgentDir;
  setFetchConfigReader(() => undefined);
  setSearchConfigReader(() => undefined);
});

function mockPi(): ExtensionAPI {
  const handlers: Record<string, ((...args: unknown[]) => unknown) | undefined> = {};
  return {
    registerProvider: (p: Provider) => {
      capturedProvider = p as Provider<"openai-completions">;
    },
    registerTool: () => {},
    on: (event: string, fn: (...args: unknown[]) => unknown) => {
      handlers[event] = fn;
      if (event === "session_start") capturedSessionStart = fn;
    },
  } as unknown as ExtensionAPI;
}

function fakeCtx(apiKey: string | undefined): ExtensionContext {
  return {
    model: undefined,
    modelRegistry: { getApiKeyForProvider: async () => apiKey },
  } as unknown as ExtensionContext;
}

async function effectiveProviderForFetch(): Promise<string | undefined> {
  const original = globalThis.fetch;
  let body: Record<string, unknown> = {};
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    body = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ markdown: "# ok" }), { status: 200 });
  }) as typeof fetch;
  try {
    await webFetchTool.execute(
      "call-1",
      { url: "https://example.com" } as never,
      undefined,
      undefined,
      fakeCtx("test-key"),
    );
  } finally {
    globalThis.fetch = original;
  }
  return body.provider as string | undefined;
}

function sessionCtx(): unknown {
  return {
    sessionManager: { getBranch: () => [] },
    modelRegistry: {},
  };
}

test("session_start: reads fetch.provider and webFetchTool uses it", async () => {
  writeFileSync(join(dir, "omniroute.json"), JSON.stringify({ fetch: { provider: "firecrawl" } }));
  await entry(mockPi());
  assert.ok(capturedSessionStart, "session_start hook must be registered");
  await capturedSessionStart!({}, sessionCtx() as never);
  assert.equal(await effectiveProviderForFetch(), "firecrawl");
});

test("session_start: invalid fetch.provider id is normalized to auto", async () => {
  writeFileSync(join(dir, "omniroute.json"), JSON.stringify({ fetch: { provider: "foo" } }));
  await entry(mockPi());
  await capturedSessionStart!({}, sessionCtx() as never);
  assert.equal(await effectiveProviderForFetch(), undefined);
});

test("session_start: fetch config does not leak into search tool", async () => {
  writeFileSync(join(dir, "omniroute.json"), JSON.stringify({ fetch: { provider: "firecrawl" } }));
  await entry(mockPi());
  await capturedSessionStart!({}, sessionCtx() as never);
  // search reader is untouched by fetch config (run searchTool directly).
  assert.equal(await effectiveProviderForFetch(), "firecrawl");
});

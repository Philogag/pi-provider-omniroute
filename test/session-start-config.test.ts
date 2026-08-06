// test/session-start-config.test.ts
// Verifies that src/index.ts wires the session_start hook into the search tool's
// config reader: on session start it reads omniroute.json and makes the search
// tool's effective provider come from that persisted config (when no explicit
// provider is passed in the tool call).
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Provider } from "@earendil-works/pi-ai";
import entry from "../src/index.ts";
import { searchTool, setSearchConfigReader } from "../src/tools/search.ts";

let capturedProvider: Provider<"openai-completions"> | undefined;
let capturedSessionStart: ((...args: unknown[]) => unknown) | undefined;

const origPiAgentDir = process.env.PI_AGENT_DIR;
let dir: string;

beforeEach(() => {
  capturedProvider = undefined;
  capturedSessionStart = undefined;
  dir = mkdtempSync(join(tmpdir(), "omniroute-session-start-test-"));
  process.env.PI_AGENT_DIR = dir;
});

after(() => {
  if (origPiAgentDir === undefined) delete process.env.PI_AGENT_DIR;
  else process.env.PI_AGENT_DIR = origPiAgentDir;
  // Restore the default (no config) reader so the module-level closure does not
  // leak a provider into other tests in this file.
  setSearchConfigReader(() => undefined);
});

// Importing `entry` executes index.ts's module top level once, which installs
// `setSearchConfigReader(() => currentConfigProvider)`. We deliberately do NOT
// reset the reader in beforeEach so the session_start -> currentConfigProvider
// -> searchTool wiring stays live for these two tests.

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

// Runs searchTool.execute with no explicit provider and returns the provider that
// made it into the /search request body (i.e. whatever the injected config reader
// resolved to, via index.ts's currentConfigProvider).
async function effectiveProviderForSearch(): Promise<string | undefined> {
  const original = globalThis.fetch;
  let body: Record<string, unknown> = {};
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    body = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ results: [] }), { status: 200 });
  }) as typeof fetch;
  try {
    await searchTool.execute(
      "call-1",
      { query: "pi" } as never,
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

test("session_start: reads omniroute.json and searchTool uses the configured provider", async () => {
  writeFileSync(join(dir, "omniroute.json"), JSON.stringify({ search: { provider: "tavily-search" } }));
  await entry(mockPi());
  assert.ok(capturedSessionStart, "session_start hook must be registered");
  await capturedSessionStart!({}, sessionCtx() as never);
  assert.equal(await effectiveProviderForSearch(), "tavily-search");
});

test("session_start: missing omniroute.json leaves the provider unset", async () => {
  await entry(mockPi());
  assert.ok(capturedSessionStart, "session_start hook must be registered");
  await capturedSessionStart!({}, sessionCtx() as never);
  assert.equal(await effectiveProviderForSearch(), undefined);
});

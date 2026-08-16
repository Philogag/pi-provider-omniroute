// test/tools-http.test.ts
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { OMNIROUTE_DEFAULT_BASE_URL } from "../src/auth.ts";
import { resolveApiKey, resolveBaseUrl } from "../src/tools/http.ts";

function ctxWith(model: ExtensionContext["model"], apiKey?: string): ExtensionContext {
  return {
    model,
    modelRegistry: { getApiKeyForProvider: async () => apiKey },
  } as unknown as ExtensionContext;
}

// 环境隔离：PI_AGENT_DIR 指向临时目录，避免开发者本机 ~/.pi/agent/settings.json
// 的 omniroute 块干扰回退断言（配置回退用例显式 seed 各自的 settings.json）。
const origPiAgentDir = process.env.PI_AGENT_DIR;
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "omniroute-http-test-"));
  process.env.PI_AGENT_DIR = dir;
});
after(() => {
  if (origPiAgentDir === undefined) delete process.env.PI_AGENT_DIR;
  else process.env.PI_AGENT_DIR = origPiAgentDir;
});

test("resolveBaseUrl: prefers current omniroute model baseUrl", () => {
  const ctx = ctxWith({ provider: "omniroute", baseUrl: "http://remote:9000/v1" } as ExtensionContext["model"]);
  assert.equal(resolveBaseUrl(ctx), "http://remote:9000/v1");
});

test("resolveBaseUrl: non-omniroute model falls back to config block baseUrl", () => {
  writeFileSync(join(dir, "settings.json"), JSON.stringify({ "pi-provider-omniroute": { baseUrl: "https://cfg.example/v1" } }));
  const ctx = ctxWith({ provider: "anthropic", baseUrl: "http://other/v1" } as ExtensionContext["model"]);
  assert.equal(resolveBaseUrl(ctx), "https://cfg.example/v1");
});

test("resolveBaseUrl: config block baseUrl wins over env", () => {
  writeFileSync(join(dir, "settings.json"), JSON.stringify({ "pi-provider-omniroute": { baseUrl: "https://cfg.example/v1" } }));
  const before = process.env.OMNIROUTE_BASE_URL;
  process.env.OMNIROUTE_BASE_URL = "http://env-host/v1";
  try {
    assert.equal(resolveBaseUrl(ctxWith(undefined)), "https://cfg.example/v1");
  } finally {
    if (before === undefined) delete process.env.OMNIROUTE_BASE_URL;
    else process.env.OMNIROUTE_BASE_URL = before;
  }
});

test("resolveBaseUrl: no model, no config -> env fallback", () => {
  const before = process.env.OMNIROUTE_BASE_URL;
  process.env.OMNIROUTE_BASE_URL = "http://env-host/v1";
  try {
    assert.equal(resolveBaseUrl(ctxWith(undefined)), "http://env-host/v1");
  } finally {
    if (before === undefined) delete process.env.OMNIROUTE_BASE_URL;
    else process.env.OMNIROUTE_BASE_URL = before;
  }
});

test("resolveBaseUrl: no model, no config, no env -> default constant", () => {
  const before = process.env.OMNIROUTE_BASE_URL;
  delete process.env.OMNIROUTE_BASE_URL;
  try {
    assert.equal(resolveBaseUrl(ctxWith(undefined)), OMNIROUTE_DEFAULT_BASE_URL);
  } finally {
    if (before !== undefined) process.env.OMNIROUTE_BASE_URL = before;
  }
});

test("resolveApiKey: returns key from modelRegistry", async () => {
  assert.equal(await resolveApiKey(ctxWith(undefined, "k1")), "k1");
});

test("resolveApiKey: undefined when registry has none", async () => {
  assert.equal(await resolveApiKey(ctxWith(undefined, undefined)), undefined);
});

import { omnirouteRequest } from "../src/tools/http.ts";
import type { OmnirouteResult } from "../src/tools/http.ts";

function jsonResponse(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function installFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  const original = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  // Real fetch rejects with AbortError when the provided signal aborts; the mock
  // must emulate that for the timeout/abort tests to be meaningful.
  globalThis.fetch = ((url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Promise<Response>((resolve, reject) => {
      const signal = init?.signal;
      const onAbort = () => reject(new DOMException("The operation was aborted.", "AbortError"));
      if (signal) {
        if (signal.aborted) {
          reject(new DOMException("The operation was aborted.", "AbortError"));
          return;
        }
        signal.addEventListener("abort", onAbort, { once: true });
      }
      impl(String(url), init).then(
        (res) => {
          signal?.removeEventListener("abort", onAbort);
          resolve(res);
        },
        (err) => {
          signal?.removeEventListener("abort", onAbort);
          reject(err);
        },
      );
    });
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

const OPTS = { apiKey: "test-key", baseUrl: "http://localhost:20128/v1", timeoutMs: 30_000 };

test("omnirouteRequest: sends POST with Bearer + JSON headers, joins baseUrl/path", async (t) => {
  const { calls, restore } = installFetch(async () => jsonResponse(200, { ok: true }));
  t.after(restore);
  const res = await omnirouteRequest("/search", { query: "pi" }, OPTS);
  assert.ok(res.ok);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://localhost:20128/v1/search");
  assert.equal(calls[0].init?.method, "POST");
  const headers = calls[0].init?.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Bearer test-key");
  assert.equal(headers["Content-Type"], "application/json");
  assert.equal(calls[0].init?.body, JSON.stringify({ query: "pi" }));
});

test("omnirouteRequest: strips trailing slash from baseUrl", async (t) => {
  const { calls, restore } = installFetch(async () => jsonResponse(200, {}));
  t.after(restore);
  await omnirouteRequest("/search", {}, { ...OPTS, baseUrl: "http://x/v1/" });
  assert.equal(calls[0].url, "http://x/v1/search");
});

test("omnirouteRequest: parses 2xx JSON into json field", async (t) => {
  const { restore } = installFetch(async () => jsonResponse(200, { results: [1] }));
  t.after(restore);
  const res = await omnirouteRequest("/search", {}, OPTS);
  assert.ok(res.ok);
  assert.deepEqual(res.json, { results: [1] });
});

test("omnirouteRequest: non-2xx returns structured error with server message", async (t) => {
  const { restore } = installFetch(async () => jsonResponse(429, { error: "rate limited" }));
  t.after(restore);
  const res = (await omnirouteRequest("/search", {}, OPTS)) as Extract<OmnirouteResult, { ok: false }>;
  assert.equal(res.ok, false);
  assert.equal(res.status, 429);
  assert.match(res.message, /429/);
  assert.match(res.message, /rate limited/);
});

test("omnirouteRequest: network failure -> cannot reach message", async (t) => {
  const { restore } = installFetch(async () => {
    throw new TypeError("fetch failed");
  });
  t.after(restore);
  const res = (await omnirouteRequest("/search", {}, OPTS)) as Extract<OmnirouteResult, { ok: false }>;
  assert.equal(res.ok, false);
  assert.equal(res.status, 0);
  assert.match(res.message, /Cannot reach OmniRoute at http:\/\/localhost:20128\/v1/);
});

test("omnirouteRequest: timeout produces timed-out message (not cancelled)", async (t) => {
  const { restore } = installFetch(async () => {
    await new Promise((r) => setTimeout(r, 500));
    return jsonResponse(200, {});
  });
  t.after(restore);
  const res = (await omnirouteRequest("/search", {}, { ...OPTS, timeoutMs: 20 })) as Extract<OmnirouteResult, { ok: false }>;
  assert.equal(res.ok, false);
  assert.match(res.message, /timed out after 20ms/);
  assert.notEqual(res.cancelled, true);
});

test("omnirouteRequest: user abort -> cancelled result", async (t) => {
  const { restore } = installFetch(async () => {
    await new Promise((r) => setTimeout(r, 500));
    return jsonResponse(200, {});
  });
  t.after(restore);
  const ac = new AbortController();
  ac.abort();
  const res = (await omnirouteRequest("/search", {}, { ...OPTS, signal: ac.signal })) as Extract<OmnirouteResult, { ok: false }>;
  assert.equal(res.cancelled, true);
});

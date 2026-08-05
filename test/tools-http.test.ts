// test/tools-http.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { OMNIROUTE_DEFAULT_BASE_URL } from "../src/auth.ts";
import { resolveApiKey, resolveBaseUrl } from "../src/tools/http.ts";

function ctxWith(model: ExtensionContext["model"], apiKey?: string): ExtensionContext {
  return {
    model,
    modelRegistry: { getApiKeyForProvider: async () => apiKey },
  } as unknown as ExtensionContext;
}

test("resolveBaseUrl: prefers current omniroute model baseUrl", () => {
  const ctx = ctxWith({ provider: "omniroute", baseUrl: "http://remote:9000/api/v1" } as ExtensionContext["model"]);
  assert.equal(resolveBaseUrl(ctx), "http://remote:9000/api/v1");
});

test("resolveBaseUrl: ignores non-omniroute model, falls back to env", () => {
  const before = process.env.OMNIROUTE_BASE_URL;
  process.env.OMNIROUTE_BASE_URL = "http://env-host/api/v1";
  try {
    const ctx = ctxWith({ provider: "anthropic", baseUrl: "http://other/api/v1" } as ExtensionContext["model"]);
    assert.equal(resolveBaseUrl(ctx), "http://env-host/api/v1");
  } finally {
    if (before === undefined) delete process.env.OMNIROUTE_BASE_URL;
    else process.env.OMNIROUTE_BASE_URL = before;
  }
});

test("resolveBaseUrl: no model, no env -> default constant", () => {
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

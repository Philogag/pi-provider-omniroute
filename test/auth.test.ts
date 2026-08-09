import { test } from "node:test";
import assert from "node:assert/strict";

// The custom auth object (omnirouteApiKeyAuth / promptBaseUrlWithRetry) was
// removed in the dual-arg provider registration migration; auth.ts now retains
// only the URL helpers, whose behavior is covered by url.test.ts. These smoke
// tests pin the retained module surface.

test("auth.ts still exports OMNIROUTE_DEFAULT_BASE_URL", async () => {
  const mod = await import("../src/auth.ts");
  assert.equal(mod.OMNIROUTE_DEFAULT_BASE_URL, "http://localhost:20128/v1");
});

test("auth.ts still exports validateAndNormalizeBaseUrl as a function", async () => {
  const mod = await import("../src/auth.ts");
  assert.equal(typeof mod.validateAndNormalizeBaseUrl, "function");
});

test("omnirouteApiKeyAuth is removed from auth.ts", async () => {
  const mod = await import("../src/auth.ts");
  assert.equal((mod as Record<string, unknown>)["omnirouteApiKeyAuth"], undefined);
});

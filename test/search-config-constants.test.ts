// test/search-config-constants.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { STATIC_FALLBACK_PROVIDERS, SEARCH_PROVIDERS } from "../src/tools/search-config.ts";

test("STATIC_FALLBACK_PROVIDERS has 14 kebab-case providers", () => {
  assert.equal(STATIC_FALLBACK_PROVIDERS.length, 14);
  for (const id of STATIC_FALLBACK_PROVIDERS) {
    assert.match(id, /^[a-z0-9-]+$/, `id ${id} must be lowercase kebab-case`);
  }
  assert.equal(new Set(STATIC_FALLBACK_PROVIDERS).size, 14, "no duplicates");
});

test("SEARCH_PROVIDERS re-export matches STATIC_FALLBACK_PROVIDERS", async () => {
  const search = await import("../src/tools/search.ts");
  assert.deepEqual([...search.SEARCH_PROVIDERS], [...STATIC_FALLBACK_PROVIDERS]);
});

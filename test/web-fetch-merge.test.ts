import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeFetchProvider, FETCH_PROVIDERS } from "../src/tools/web-fetch.ts";

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

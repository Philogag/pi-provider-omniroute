// test/tools-search.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSearchBody, searchParamsSchema } from "../src/tools/search.ts";
import type { SearchToolParams } from "../src/tools/search.ts";

test("buildSearchBody: minimal params get explicit defaults, no timeoutMs", () => {
  const body = buildSearchBody({ query: "pi agent" });
  assert.deepEqual(body, {
    query: "pi agent",
    max_results: 5,
    search_type: "web",
    offset: 0,
    strict_filters: false,
  });
  assert.ok(!("timeoutMs" in body));
});

test("buildSearchBody: passes through optional fields when present", () => {
  const body = buildSearchBody({
    query: "pi",
    provider: "tavily-search",
    max_results: 10,
    search_type: "news",
    offset: 5,
    country: "CN",
    language: "zh",
    time_range: "day",
    filters: { include_domains: ["example.com"], safe_search: "strict" },
    strict_filters: true,
    timeoutMs: 60_000,
  });
  assert.equal(body.provider, "tavily-search");
  assert.equal(body.max_results, 10);
  assert.equal(body.search_type, "news");
  assert.deepEqual(body.filters, { include_domains: ["example.com"], safe_search: "strict" });
  assert.ok(!("timeoutMs" in body));
});

test("searchParamsSchema: provider enum rejects unknown value", async () => {
  const { Value } = await import("@sinclair/typebox/value");
  const ok = Value.Check(searchParamsSchema, { query: "pi", provider: "nope-search" });
  assert.equal(ok, false);
});

test("searchParamsSchema: additionalProperties rejected at top level", async () => {
  const { Value } = await import("@sinclair/typebox/value");
  const ok = Value.Check(searchParamsSchema, { query: "pi", bogus: 1 });
  assert.equal(ok, false);
});

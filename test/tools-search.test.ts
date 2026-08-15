// test/tools-search.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { searchTool } from "../src/tools/search.ts";
import { buildSearchBody, searchParamsSchema } from "../src/tools/search.ts";
import type { SearchToolParams } from "../src/tools/search.ts";
import { formatSearchResults } from "../src/tools/search.ts";

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
  const { Value } = await import("typebox/value");
  const ok = Value.Check(searchParamsSchema, { query: "pi", provider: "nope-search" });
  assert.equal(ok, false);
});

test("searchParamsSchema: additionalProperties rejected at top level", async () => {
  const { Value } = await import("typebox/value");
  const ok = Value.Check(searchParamsSchema, { query: "pi", bogus: 1 });
  assert.equal(ok, false);
});

test("formatSearchResults: formats title/url/snippet per result", () => {
  const json = {
    results: [
      { title: "Pi Agent", url: "https://pi.dev", snippet: "Coding agent" },
      { title: "GitHub", url: "https://github.com", snippet: "Hosting" },
    ],
  };
  const text = formatSearchResults(json, "pi agent");
  assert.match(text, /1\. Pi Agent/);
  assert.match(text, /URL: https:\/\/pi\.dev/);
  assert.match(text, /Coding agent/);
  assert.match(text, /2\. GitHub/);
  assert.match(text, /URL: https:\/\/github\.com/);
});

test("formatSearchResults: skips missing optional fields without throwing", () => {
  const json = { results: [{ title: "Only Title" }] };
  const text = formatSearchResults(json, "q");
  assert.match(text, /1\. Only Title/);
  assert.ok(!/undefined/.test(text));
});

test("formatSearchResults: truncates at result boundary over 20000 chars", () => {
  const longSnippet = "x".repeat(20_000);
  const json = {
    results: [
      { title: "A", url: "https://a", snippet: longSnippet },
      { title: "B", url: "https://b", snippet: "short" },
      { title: "C", url: "https://c", snippet: "short" },
    ],
  };
  const text = formatSearchResults(json, "q");
  assert.ok(text.length <= 20_000 + 200); // 硬上限 + 截断提示余量
  assert.match(text, /truncated: 2 of 3 results omitted/);
  assert.ok(!text.includes("1. B")); // 第 2 条在条目边界被截掉
});

test("formatSearchResults: raw JSON fallback when results missing", () => {
  const json = { weird: "shape" };
  const text = formatSearchResults(json, "q");
  assert.match(text, /weird/);
});

function fakeCtx(apiKey: string | undefined, baseUrl?: string): ExtensionContext {
  return {
    model: baseUrl ? ({ provider: "omniroute", baseUrl } as ExtensionContext["model"]) : undefined,
    modelRegistry: { getApiKeyForProvider: async () => apiKey },
  } as unknown as ExtensionContext;
}

async function runSearch(
  params: unknown,
  ctx: ExtensionContext,
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>,
) {
  const original = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  if (fetchImpl) {
    globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return fetchImpl(String(url), init);
    }) as typeof fetch;
  } else {
    globalThis.fetch = (async () => {
      throw new Error("fetch should not be called");
    }) as typeof fetch;
  }
  try {
    const result = await searchTool.execute("call-1", params as never, undefined, undefined, ctx);
    return { result, calls };
  } finally {
    globalThis.fetch = original;
  }
}

test("searchTool: whitespace-only query -> error, no fetch", async () => {
  const { result, calls } = await runSearch({ query: "   " }, fakeCtx("key"));
  assert.equal(calls.length, 0);
  const text = (result.content as Array<{ type: string; text?: string }>)[0]?.text ?? "";
  assert.match(text, /query must be a non-empty/);
});

test("searchTool: missing api key -> guidance, no fetch", async () => {
  const { result, calls } = await runSearch({ query: "pi" }, fakeCtx(undefined));
  assert.equal(calls.length, 0);
  const text = (result.content as Array<{ type: string; text?: string }>)[0]?.text ?? "";
  assert.match(text, /\/login omniroute/);
});

test("searchTool: success formats results", async () => {
  const { result, calls } = await runSearch(
    { query: "pi" },
    fakeCtx("key", "http://localhost:20128/v1"),
    async () =>
      new Response(JSON.stringify({ results: [{ title: "Pi", url: "https://pi.dev", snippet: "s" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://localhost:20128/v1/search");
  const sentBody = JSON.parse(String(calls[0].init?.body));
  assert.equal(sentBody.query, "pi");
  assert.equal(sentBody.max_results, 5); // 默认值补齐
  const text = (result.content as Array<{ type: string; text?: string }>)[0]?.text ?? "";
  assert.match(text, /1\. Pi/);
});

test("searchTool: 429 propagates status", async () => {
  const { result } = await runSearch(
    { query: "pi" },
    fakeCtx("key"),
    async () => new Response(JSON.stringify({ error: "rate limited" }), { status: 429 }),
  );
  const text = (result.content as Array<{ type: string; text?: string }>)[0]?.text ?? "";
  assert.match(text, /429/);
});

test("searchTool: timeoutMs not sent in body", async () => {
  const { calls } = await runSearch(
    { query: "pi", timeoutMs: 60_000 },
    fakeCtx("key"),
    async () => new Response(JSON.stringify({ results: [] }), { status: 200 }),
  );
  const sentBody = JSON.parse(String(calls[0]?.init?.body));
  assert.ok(!("timeoutMs" in sentBody));
});

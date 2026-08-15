// test/tools-web-fetch.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  buildFetchBody,
  extractFetchContent,
  fetchParamsSchema,
  webFetchTool,
} from "../src/tools/web-fetch.ts";
import type { FetchToolParams } from "../src/tools/web-fetch.ts";

test("buildFetchBody: minimal params get explicit defaults, no timeoutMs", () => {
  const body = buildFetchBody({ url: "https://example.com" });
  assert.deepEqual(body, {
    url: "https://example.com",
    format: "markdown",
    depth: 0,
    include_metadata: false,
  });
  assert.ok(!("timeoutMs" in body));
});

test("buildFetchBody: passes through optional fields", () => {
  const body = buildFetchBody({
    url: "https://example.com",
    provider: "firecrawl",
    format: "html",
    depth: 2,
    wait_for_selector: ".main",
    include_metadata: true,
    timeoutMs: 45_000,
  });
  assert.equal(body.provider, "firecrawl");
  assert.equal(body.format, "html");
  assert.equal(body.depth, 2);
  assert.equal(body.wait_for_selector, ".main");
  assert.ok(!("timeoutMs" in body));
});

test("fetchParamsSchema: invalid provider rejected", async () => {
  const { Value } = await import("typebox/value");
  assert.equal(Value.Check(fetchParamsSchema, { url: "https://x", provider: "nope" }), false);
});

test("fetchParamsSchema: invalid depth rejected", async () => {
  const { Value } = await import("typebox/value");
  assert.equal(Value.Check(fetchParamsSchema, { url: "https://x", depth: 7 }), false);
});

test("extractFetchContent: prefers content string, then markdown/html/text", () => {
  assert.equal(extractFetchContent({ content: "body" }), "body");
  assert.equal(extractFetchContent({ markdown: "# md" }), "# md");
  assert.equal(extractFetchContent({ html: "<p>h</p>" }), "<p>h</p>");
  assert.equal(extractFetchContent({ text: "plain" }), "plain");
});

test("extractFetchContent: object content field uses markdown/text", () => {
  assert.equal(extractFetchContent({ content: { markdown: "# obj" } }), "# obj");
  assert.equal(extractFetchContent({ content: { text: "obj text" } }), "obj text");
});

test("extractFetchContent: truncates over 40000 chars with notice", () => {
  const long = "y".repeat(50_000);
  const text = extractFetchContent({ markdown: long });
  assert.ok(text.length <= 40_000 + 100);
  assert.match(text, /truncated at 40000 chars/);
});

test("extractFetchContent: raw JSON fallback when nothing extractable", () => {
  const text = extractFetchContent({ weird: "shape" });
  assert.match(text, /weird/);
});

function fakeCtx(apiKey: string | undefined, baseUrl?: string): ExtensionContext {
  return {
    model: baseUrl ? ({ provider: "omniroute", baseUrl } as ExtensionContext["model"]) : undefined,
    modelRegistry: { getApiKeyForProvider: async () => apiKey },
  } as unknown as ExtensionContext;
}

async function runFetch(
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
    const result = await webFetchTool.execute("call-1", params as never, undefined, undefined, ctx);
    return { result, calls };
  } finally {
    globalThis.fetch = original;
  }
}

test("webFetchTool: invalid URL -> error, no fetch", async () => {
  const { result, calls } = await runFetch({ url: "not-a-url" }, fakeCtx("key"));
  assert.equal(calls.length, 0);
  const text = (result.content as Array<{ type: string; text?: string }>)[0]?.text ?? "";
  assert.match(text, /url must be a valid http\(s\) URL/);
});

test("webFetchTool: non-http protocol -> error, no fetch", async () => {
  const { result, calls } = await runFetch({ url: "ftp://example.com/file" }, fakeCtx("key"));
  assert.equal(calls.length, 0);
  const text = (result.content as Array<{ type: string; text?: string }>)[0]?.text ?? "";
  assert.match(text, /url must be an http\(s\) URL/);
});

test("webFetchTool: missing api key -> guidance, no fetch", async () => {
  const { result, calls } = await runFetch({ url: "https://example.com" }, fakeCtx(undefined));
  assert.equal(calls.length, 0);
  const text = (result.content as Array<{ type: string; text?: string }>)[0]?.text ?? "";
  assert.match(text, /\/login omniroute/);
});

test("webFetchTool: success returns extracted content", async () => {
  const { result, calls } = await runFetch(
    { url: "https://example.com" },
    fakeCtx("key", "http://localhost:20128/v1"),
    async () =>
      new Response(JSON.stringify({ markdown: "# Hello" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://localhost:20128/v1/web/fetch");
  const sentBody = JSON.parse(String(calls[0].init?.body));
  assert.equal(sentBody.format, "markdown"); // 默认值补齐
  assert.equal(sentBody.depth, 0);
  const text = (result.content as Array<{ type: string; text?: string }>)[0]?.text ?? "";
  assert.match(text, /# Hello/);
});

test("webFetchTool: 401 propagates status", async () => {
  const { result } = await runFetch(
    { url: "https://example.com" },
    fakeCtx("key"),
    async () => new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }),
  );
  const text = (result.content as Array<{ type: string; text?: string }>)[0]?.text ?? "";
  assert.match(text, /401/);
});

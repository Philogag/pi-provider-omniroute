// test/tools-web-fetch.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFetchBody, extractFetchContent, fetchParamsSchema } from "../src/tools/web-fetch.ts";
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
  const { Value } = await import("@sinclair/typebox/value");
  assert.equal(Value.Check(fetchParamsSchema, { url: "https://x", provider: "nope" }), false);
});

test("fetchParamsSchema: invalid depth rejected", async () => {
  const { Value } = await import("@sinclair/typebox/value");
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

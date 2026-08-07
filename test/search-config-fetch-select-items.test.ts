import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFetchSelectItems } from "../src/tools/search-config.ts";

test("buildFetchSelectItems: auto first + 4 static providers in order", () => {
  const items = buildFetchSelectItems("firecrawl");
  assert.equal(items.length, 5);
  assert.equal(items[0].value, "auto");
  assert.equal(items[0].label, "Auto (follow server default)");
  assert.deepEqual(items.slice(1).map((i) => i.value), ["firecrawl", "jina-reader", "tavily-search", "tinyfish"]);
});

test("buildFetchSelectItems: ✓ on member row when configured", () => {
  const items = buildFetchSelectItems("firecrawl");
  assert.match(items.find((i) => i.value === "firecrawl")!.label, /^✓ /);
  assert.doesNotMatch(items[0].label, /^✓ /, "auto row must not be checked when a member is configured");
  assert.doesNotMatch(items.find((i) => i.value === "jina-reader")!.label, /^✓ /);
});

test("buildFetchSelectItems: ✓ on auto row when unconfigured / auto / invalid id (normalized)", () => {
  for (const v of [undefined, "auto", "foo"]) {
    const items = buildFetchSelectItems(v);
    assert.match(items[0].label, /^✓ /, `currentFetchProvider=${v} must check auto`);
    assert.ok(items.slice(1).every((i) => !i.label.startsWith("✓ ")), `currentFetchProvider=${v} must not check any provider row`);
  }
});

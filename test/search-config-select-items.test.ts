// test/search-config-select-items.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSelectItems, type ProviderSubmenuParams } from "../src/tools/search-config.ts";
import type { SearchCatalog, SearchProviderEntry } from "../src/tools/search-config.ts";

function makeCatalog(entries: Array<[string, string]>, isFallback = false): SearchCatalog {
  const providers: SearchProviderEntry[] = entries.map(([id, name]) => ({ id, name, search_types: ["web"] }));
  return { providers, isFallback };
}

const fakeTheme = new Proxy({}, { get: () => () => "" }) as never;

function makeParams(overrides: Partial<ProviderSubmenuParams> = {}): ProviderSubmenuParams {
  return {
    currentProvider: undefined,
    catalog: makeCatalog([]),
    theme: fakeTheme,
    onCommit: () => {},
    onCancel: () => {},
    ...overrides,
  };
}

test("buildSelectItems: auto first, providers after, no value/currentValue fields", () => {
  const items = buildSelectItems(makeParams({
    currentProvider: "tavily-search",
    catalog: makeCatalog([["tavily-search", "Tavily"], ["brave-search", "Brave"]]),
  }));
  assert.equal(items.length, 3);
  assert.deepEqual(items[0], { value: "auto", label: "Auto (follow server default)" });
  assert.deepEqual(items[1], { value: "tavily-search", label: "✓ Tavily" });   // active → ✓ prefix
  assert.deepEqual(items[2], { value: "brave-search", label: "Brave" });       // inactive → no prefix
  for (const item of items) {
    assert.ok(!("currentValue" in item), "SelectItem must not carry currentValue");
    assert.ok(!("values" in item), "SelectItem must not carry values");
  }
});

test("buildSelectItems: auto item gets ✓ when unconfigured or auto", () => {
  const unconfigured = buildSelectItems(makeParams({ currentProvider: undefined }));
  assert.match(unconfigured[0].label, /^✓ /, "auto item must be checked when unconfigured");
  const auto = buildSelectItems(makeParams({ currentProvider: "auto" }));
  assert.match(auto[0].label, /^✓ /, "auto item must be checked when currentProvider is 'auto'");
  const concrete = buildSelectItems(makeParams({ currentProvider: "tavily-search", catalog: makeCatalog([["tavily-search", "Tavily"]]) }));
  assert.doesNotMatch(concrete[0].label, /^✓ /, "auto item must be unchecked when a concrete provider is active");
  assert.match(concrete[1].label, /^✓ /, "active provider item must be checked");
});

test("buildSelectItems: exactly one item is checked (auto vs provider)", () => {
  const items = buildSelectItems(makeParams({
    currentProvider: "exa-search",
    catalog: makeCatalog([["exa-search", "Exa"], ["brave-search", "Brave"]]),
  }));
  const checked = items.filter((i) => i.label.startsWith("✓ "));
  assert.equal(checked.length, 1);
  assert.equal(checked[0].value, "exa-search");
});

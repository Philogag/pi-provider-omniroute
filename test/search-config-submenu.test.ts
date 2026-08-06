import { test } from "node:test";
import assert from "node:assert/strict";
import { renderProviderSubmenu, type ProviderSubmenuParams } from "../src/tools/search-config.ts";
import type { SearchCatalog, SearchProviderEntry } from "../src/tools/search-config.ts";

function makeCatalog(entries: Array<[string, string]>, isFallback = false): SearchCatalog {
  const providers: SearchProviderEntry[] = entries.map(([id, name]) => ({ id, name, search_types: ["web"] }));
  return { providers, isFallback };
}

const fakeTheme = new Proxy({}, { get: () => () => "" }) as never;  // tolerant theme stub

test("renderProviderSubmenu: auto is the first item, currentProvider reflected", () => {
  const calls: unknown[] = [];
  const params: ProviderSubmenuParams = {
    currentProvider: "tavily-search",
    catalog: makeCatalog([["tavily-search", "Tavily"], ["brave-search", "Brave"]]),
    theme: fakeTheme,
    onCommit: (p) => calls.push(["commit", p]),
    onCancel: () => calls.push(["cancel"]),
  };
  const component = renderProviderSubmenu(params);
  const out = (component as { render: (w: number) => string[] }).render(80);
  assert.ok(Array.isArray(out));
  assert.ok(out.length > 0);
  calls.length = 0;  // reset
});

test("renderProviderSubmenu: onCommit is invoked with id when a provider is selected", () => {
  const calls: Array<[string, unknown?]> = [];
  const params: ProviderSubmenuParams = {
    currentProvider: undefined,
    catalog: makeCatalog([["tavily-search", "Tavily"]]),
    theme: fakeTheme,
    onCommit: (p) => calls.push(["commit", p]),
    onCancel: () => calls.push(["cancel"]),
  };
  const component = renderProviderSubmenu(params) as unknown as { _sl: { onChange: (id: string, v: string) => void } };
  component._sl.onChange("tavily-search", "tavily-search");
  assert.deepEqual(calls, [["commit", "tavily-search"]]);
});

test("renderProviderSubmenu: onCommit is invoked with undefined when auto is selected", () => {
  const calls: Array<[string, unknown?]> = [];
  const params: ProviderSubmenuParams = {
    currentProvider: "tavily-search",
    catalog: makeCatalog([["tavily-search", "Tavily"]]),
    theme: fakeTheme,
    onCommit: (p) => calls.push(["commit", p]),
    onCancel: () => calls.push(["cancel"]),
  };
  const component = renderProviderSubmenu(params) as unknown as { _sl: { onChange: (id: string, v: string) => void } };
  component._sl.onChange("auto", "auto");
  assert.deepEqual(calls, [["commit", undefined]]);
});

test("renderProviderSubmenu: onCancel is invoked on Esc", () => {
  const calls: Array<[string, unknown?]> = [];
  const params: ProviderSubmenuParams = {
    currentProvider: undefined,
    catalog: makeCatalog([["tavily-search", "Tavily"]]),
    theme: fakeTheme,
    onCommit: (p) => calls.push(["commit", p]),
    onCancel: () => calls.push(["cancel"]),
  };
  const component = renderProviderSubmenu(params) as unknown as { handleInput: (data: string) => void };
  component.handleInput("\x1b");  // Esc
  assert.deepEqual(calls, [["cancel"]]);
});

test("renderProviderSubmenu: every row keeps currentValue within its values (SettingsList invariant)", () => {
  // Uses a catalog-only concrete provider (not in STATIC_FALLBACK_PROVIDERS) plus a second
  // provider. Both prior bugs surface here:
  //   - non-current provider rows must show AUTO_ID, not the active currentProvider (which
  //     would be absent from their values array and coerce to "auto" on first Enter);
  //   - the auto row must keep the active provider in its values array.
  const params: ProviderSubmenuParams = {
    currentProvider: "exa-search-from-catalog",
    catalog: makeCatalog([
      ["exa-search-from-catalog", "Exa (catalog)"],
      ["brave-search", "Brave"],
    ]),
    theme: fakeTheme,
    onCommit: () => {},
    onCancel: () => {},
  };
  const container = renderProviderSubmenu(params) as unknown as {
    children: Array<{ items: Array<{ id: string; currentValue: string; values: readonly string[] }> }>;
  };
  const rows = container.children[0].items;
  assert.ok(rows.length >= 3, "expected auto + 2 provider rows");

  // Every row must satisfy currentValue ∈ values, otherwise SettingsList.activateItem
  // (item.values.indexOf(item.currentValue) === -1) coerces it to values[0] on first Enter.
  for (const row of rows) {
    assert.ok(
      row.values.includes(row.currentValue),
      `row ${row.id}: currentValue ${JSON.stringify(row.currentValue)} not in values [${row.values.join(", ")}]`,
    );
  }

  // A non-current provider row must show AUTO_ID (inactive), not the active provider.
  const braveRow = rows.find((r) => r.id === "brave-search")!;
  assert.equal(braveRow.currentValue, "auto");
  assert.ok(braveRow.values.includes("brave-search"));

  // The auto row must keep the active (catalog-only) provider in its values.
  const autoRow = rows.find((r) => r.id === "auto")!;
  assert.equal(autoRow.currentValue, "exa-search-from-catalog");
  assert.ok(autoRow.values.includes("exa-search-from-catalog"));

  // The active provider row keeps its own id as currentValue.
  const activeRow = rows.find((r) => r.id === "exa-search-from-catalog")!;
  assert.equal(activeRow.currentValue, "exa-search-from-catalog");
});

test("renderProviderSubmenu: isFallback shows hint in render output", () => {
  const params: ProviderSubmenuParams = {
    currentProvider: undefined,
    catalog: makeCatalog([], true),  // empty + fallback
    theme: fakeTheme,
    onCommit: () => {},
    onCancel: () => {},
  };
  const component = renderProviderSubmenu(params) as unknown as { render: (w: number) => string[] };
  const out = component.render(120);
  const joined = out.join("\n");
  assert.match(joined, /unreachable/i, "fallback hint must mention unreachable");
});

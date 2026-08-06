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

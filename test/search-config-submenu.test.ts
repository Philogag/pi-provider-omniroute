import { test } from "node:test";
import assert from "node:assert/strict";
import { initTheme, type Theme } from "@earendil-works/pi-coding-agent";
import { renderProviderSubmenu, type ProviderSubmenuParams } from "../src/tools/search-config.ts";
import type { SearchCatalog, SearchProviderEntry } from "../src/tools/search-config.ts";

// getSelectListTheme()/keyHint() 依赖全局 theme proxy（Symbol.for 共享）——单测必须先初始化。幂等。
initTheme();

function makeCatalog(entries: Array<[string, string]>, isFallback = false): SearchCatalog {
  const providers: SearchProviderEntry[] = entries.map(([id, name]) => ({ id, name, search_types: ["web"] }));
  return { providers, isFallback };
}

// identity fakeTheme：保留文本（Proxy 返回 "" 会把边框/标题吞成空串，无法断言）
const fakeTheme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as unknown as Theme;

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

function renderOutput(params: ProviderSubmenuParams): string[] {
  const component = renderProviderSubmenu(params) as unknown as { render: (w: number) => string[] };
  return component.render(80);
}

test("renderProviderSubmenu: border top/bottom lines and title row", () => {
  const out = renderOutput(makeParams({ catalog: makeCatalog([["tavily-search", "Tavily"]]) }));
  const joined = out.join("\n");
  assert.match(out[0], /^─+$/, "first line must be the top border");
  assert.match(out[out.length - 1], /^─+$/, "last line must be the bottom border");
  assert.match(joined, /Search Provider/i, "title row must exist");
});

test("renderProviderSubmenu: rows show no value column", () => {
  const out = renderOutput(makeParams({
    currentProvider: "tavily-search",
    catalog: makeCatalog([["tavily-search", "Tavily"], ["brave-search", "Brave"]]),
  }));
  // SelectItem 无 currentValue；SelectList 渲染 = prefix + label，无第二列。
  // 行尾不得出现 provider id（value 列泄漏的典型特征）。
  const lines = out.filter((l) => /tavily-search|brave-search|Auto/i.test(l));
  for (const line of lines) {
    assert.doesNotMatch(line, /\S+\s+(tavily-search|brave-search|auto)\s*$/, `value column leaked: ${line}`);
  }
});

test("renderProviderSubmenu: ✓ marker on active provider row only", () => {
  const out = renderOutput(makeParams({
    currentProvider: "tavily-search",
    catalog: makeCatalog([["tavily-search", "Tavily"], ["brave-search", "Brave"]]),
  }));
  const joined = out.join("\n");
  assert.match(joined, /✓ Tavily/, "active provider row must show ✓ prefix");
  assert.doesNotMatch(joined, /✓ Brave/, "inactive provider row must not show ✓");
});

test("renderProviderSubmenu: ✓ marker on auto row when unconfigured", () => {
  const out = renderOutput(makeParams({ catalog: makeCatalog([["tavily-search", "Tavily"]]) }));
  assert.match(out.join("\n"), /✓ Auto \(follow server default\)/, "auto row must be checked when unconfigured");
});

test("renderProviderSubmenu: fallback hint is rendered inside the border", () => {
  const out = renderOutput(makeParams({ catalog: makeCatalog([], true) }));
  const joined = out.join("\n");
  assert.match(joined, /unreachable/i, "fallback hint must mention unreachable");
  const hintLine = out.findIndex((l) => /unreachable/i.test(l));
  assert.ok(hintLine > 0 && hintLine < out.length - 1, "hint must sit between border lines");
});

test("renderProviderSubmenu: Enter on provider row commits its value", () => {
  const calls: Array<[string, unknown?]> = [];
  const params = makeParams({
    currentProvider: undefined,
    catalog: makeCatalog([["tavily-search", "Tavily"]]),
    onCommit: (p) => calls.push(["commit", p]),
  });
  const component = renderProviderSubmenu(params) as unknown as { _sl: { onSelect?: (item: { value: string; label: string }) => void } };
  component._sl.onSelect?.({ value: "tavily-search", label: "Tavily" });
  assert.deepEqual(calls, [["commit", "tavily-search"]]);
});

test("renderProviderSubmenu: Enter on auto row commits undefined", () => {
  const calls: Array<[string, unknown?]> = [];
  const params = makeParams({
    currentProvider: "tavily-search",
    catalog: makeCatalog([["tavily-search", "Tavily"]]),
    onCommit: (p) => calls.push(["commit", p]),
  });
  const component = renderProviderSubmenu(params) as unknown as { _sl: { onSelect?: (item: { value: string; label: string }) => void } };
  component._sl.onSelect?.({ value: "auto", label: "Auto (follow server default)" });
  assert.deepEqual(calls, [["commit", undefined]]);
});

test("renderProviderSubmenu: Esc invokes onCancel", () => {
  const calls: Array<[string, unknown?]> = [];
  const params = makeParams({ onCancel: () => calls.push(["cancel"]) });
  const component = renderProviderSubmenu(params) as unknown as { handleInput: (data: string) => void };
  component.handleInput("\x1b");
  assert.deepEqual(calls, [["cancel"]]);
});

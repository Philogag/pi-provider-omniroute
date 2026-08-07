import { test } from "node:test";
import assert from "node:assert/strict";
import { initTheme, type Theme } from "@earendil-works/pi-coding-agent";
import { renderFetchSubmenu, type FetchSubmenuParams } from "../src/tools/search-config.ts";

// getSelectListTheme()/keyHint() 依赖全局 theme proxy —— 单测必须先初始化。幂等。
initTheme();

const fakeTheme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as unknown as Theme;

function makeParams(overrides: Partial<FetchSubmenuParams> = {}): FetchSubmenuParams {
  return {
    currentFetchProvider: undefined,
    theme: fakeTheme,
    onCommit: () => {},
    onCancel: () => {},
    ...overrides,
  };
}

function renderOutput(params: FetchSubmenuParams): string[] {
  const component = renderFetchSubmenu(params) as unknown as { render: (w: number) => string[] };
  return component.render(80);
}

test("renderFetchSubmenu: border top/bottom lines and title row", () => {
  const out = renderOutput(makeParams());
  const joined = out.join("\n");
  assert.match(out[0], /^─+$/, "first line must be the top border");
  assert.match(out[out.length - 1], /^─+$/, "last line must be the bottom border");
  assert.match(joined, /Web Fetch Provider/i, "title row must exist");
});

test("renderFetchSubmenu: renders the 5 static rows (auto + 4 providers)", () => {
  const out = renderOutput(makeParams({ currentFetchProvider: "firecrawl" }));
  const joined = out.join("\n");
  assert.match(joined, /Auto \(follow server default\)/);
  for (const id of ["firecrawl", "jina-reader", "tavily-search", "tinyfish"]) {
    assert.match(joined, new RegExp(id), `row for ${id} must exist`);
  }
});

test("renderFetchSubmenu: SelectItem rows have no value column", () => {
  const component = renderFetchSubmenu(makeParams()) as unknown as { _sl: { items: Array<{ value: string; label: string; currentValue?: unknown; values?: unknown[] }> } };
  for (const item of component._sl.items) {
    assert.equal(item.currentValue, undefined, `item ${item.value} must not carry currentValue`);
    assert.equal(item.values, undefined, `item ${item.value} must not carry values`);
  }
});

test("renderFetchSubmenu: ✓ marker on active provider row only", () => {
  const out = renderOutput(makeParams({ currentFetchProvider: "firecrawl" }));
  const joined = out.join("\n");
  assert.match(joined, /✓ firecrawl/, "active provider row must show ✓ prefix");
  assert.doesNotMatch(joined, /✓ jina-reader/, "inactive provider row must not show ✓");
});

test("renderFetchSubmenu: ✓ marker on auto row when unconfigured", () => {
  const out = renderOutput(makeParams());
  assert.match(out.join("\n"), /✓ Auto \(follow server default\)/, "auto row must be checked when unconfigured");
});

test("renderFetchSubmenu: Enter on provider row commits its value", () => {
  const calls: Array<[string, unknown?]> = [];
  const params = makeParams({ onCommit: (p) => calls.push(["commit", p]) });
  const component = renderFetchSubmenu(params) as unknown as { _sl: { onSelect?: (item: { value: string; label: string }) => void } };
  component._sl.onSelect?.({ value: "firecrawl", label: "firecrawl" });
  assert.deepEqual(calls, [["commit", "firecrawl"]]);
});

test("renderFetchSubmenu: Enter on auto row commits undefined", () => {
  const calls: Array<[string, unknown?]> = [];
  const params = makeParams({ onCommit: (p) => calls.push(["commit", p]) });
  const component = renderFetchSubmenu(params) as unknown as { _sl: { onSelect?: (item: { value: string; label: string }) => void } };
  component._sl.onSelect?.({ value: "auto", label: "Auto (follow server default)" });
  assert.deepEqual(calls, [["commit", undefined]]);
});

test("renderFetchSubmenu: Esc invokes onCancel", () => {
  const calls: Array<[string, unknown?]> = [];
  const params = makeParams({ onCancel: () => calls.push(["cancel"]) });
  const component = renderFetchSubmenu(params) as unknown as { handleInput: (data: string) => void };
  component.handleInput("\x1b");
  assert.deepEqual(calls, [["cancel"]]);
});

// test/search-config-toplevel.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { initTheme, type Theme } from "@earendil-works/pi-coding-agent";
import { renderTopLevelMenu, type TopLevelMenuParams } from "../src/tools/search-config.ts";

initTheme();  // keyHint() 构建时调用 theme.fg，需要全局 theme

const fakeTheme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as unknown as Theme;

function makeParams(overrides: Partial<TopLevelMenuParams> = {}): TopLevelMenuParams {
  return {
    currentProvider: "tavily-search",
    fetchPreview: "Auto",
    theme: fakeTheme,
    onActivateSearchProvider: () => {},
    onActivateFetchProvider: () => {},
    ...overrides,
  };
}

test("renderTopLevelMenu: border lines, title, and provider row rendered", () => {
  const params = makeParams({ currentProvider: "tavily-search" });
  const component = renderTopLevelMenu(params) as unknown as { render: (w: number) => string[] };
  const out = component.render(80);
  const joined = out.join("\n");
  assert.match(out[0], /^─+$/, "first line must be the top border");
  assert.match(out[out.length - 1], /^─+$/, "last line must be the bottom border");
  assert.match(joined, /OmniRoute Settings/i, "title must exist");
  assert.match(joined, /Search provider:\s+tavily-search/i, "row must contain provider preview");
});

test("renderTopLevelMenu: undefined currentProvider shows 'Auto' preview", () => {
  const params = makeParams({ currentProvider: undefined });
  const component = renderTopLevelMenu(params) as unknown as { render: (w: number) => string[] };
  assert.match(component.render(80).join("\n"), /Search provider:\s+Auto/i);
});

test("renderTopLevelMenu: Enter triggers onActivateSearchProvider", () => {
  let activated = false;
  const params = makeParams({ onActivateSearchProvider: () => { activated = true; } });
  const component = renderTopLevelMenu(params) as unknown as { handleInput: (data: string) => void };
  component.handleInput("\r");
  assert.equal(activated, true);
});

test("renderTopLevelMenu: renders both rows with previews", () => {
  const params = makeParams({ currentProvider: "tavily-search", fetchPreview: "firecrawl" });
  const component = renderTopLevelMenu(params) as unknown as { render: (w: number) => string[] };
  const joined = component.render(80).join("\n");
  assert.match(joined, /Search provider:\s+tavily-search/i);
  assert.match(joined, /Web Fetch provider:\s+firecrawl/i);
});

test("renderTopLevelMenu: Enter on fetch row activates fetch provider", () => {
  let activated = "";
  const params = makeParams({
    onActivateSearchProvider: () => { activated = "search"; },
    onActivateFetchProvider: () => { activated = "fetch"; },
  });
  const component = renderTopLevelMenu(params) as unknown as { _sl: { onSelect?: (item: { value: string; label: string }) => void } };
  component._sl.onSelect?.({ value: "fetch", label: "Web Fetch provider: Auto" });
  assert.equal(activated, "fetch");
});

test("renderTopLevelMenu: Esc does not trigger activation, invokes onClose", () => {
  let activated = false;
  let closed = 0;
  const params = makeParams({
    onActivateSearchProvider: () => { activated = true; },
    onClose: () => { closed++; },
  });
  const component = renderTopLevelMenu(params) as unknown as { handleInput: (data: string) => void };
  component.handleInput("\x1b");
  assert.equal(activated, false);
  assert.equal(closed, 1, "Esc on top-level must invoke onClose");
});

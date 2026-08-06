import { test } from "node:test";
import assert from "node:assert/strict";
import { renderTopLevelMenu, type TopLevelMenuParams } from "../src/tools/search-config.ts";

const fakeTheme = new Proxy({}, { get: () => () => "" }) as never;

test("renderTopLevelMenu: header + row + hint rendered", () => {
  const params: TopLevelMenuParams = {
    currentProvider: "tavily-search",
    theme: fakeTheme,
    onActivateSearchProvider: () => {},
  };
  const component = renderTopLevelMenu(params) as unknown as { render: (w: number) => string[] };
  const out = component.render(80).join("\n");
  assert.match(out, /Settings/i, "header must contain 'Settings'");
  assert.match(out, /Search provider/i, "row must contain 'Search provider'");
  assert.match(out, /tavily-search/i, "preview must contain current provider id");
  assert.match(out, /Esc/i, "hint must mention Esc");
});

test("renderTopLevelMenu: undefined currentProvider shows 'Auto' preview", () => {
  const params: TopLevelMenuParams = {
    currentProvider: undefined,
    theme: fakeTheme,
    onActivateSearchProvider: () => {},
  };
  const component = renderTopLevelMenu(params) as unknown as { render: (w: number) => string[] };
  const out = component.render(80).join("\n");
  assert.match(out, /Auto/i, "preview must contain 'Auto' when currentProvider is undefined");
});

test("renderTopLevelMenu: Enter on the row triggers onActivateSearchProvider", () => {
  let activated = false;
  const params: TopLevelMenuParams = {
    currentProvider: undefined,
    theme: fakeTheme,
    onActivateSearchProvider: () => { activated = true; },
  };
  const component = renderTopLevelMenu(params) as unknown as { handleInput: (data: string) => void };
  component.handleInput("\r");  // Enter
  assert.equal(activated, true);
});

test("renderTopLevelMenu: Esc does not invoke onActivateSearchProvider", () => {
  let activated = false;
  const params: TopLevelMenuParams = {
    currentProvider: undefined,
    theme: fakeTheme,
    onActivateSearchProvider: () => { activated = true; },
  };
  const component = renderTopLevelMenu(params) as unknown as { handleInput: (data: string) => void };
  component.handleInput("\x1b");  // Esc
  assert.equal(activated, false);
});

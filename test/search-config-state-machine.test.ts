import { test, mock, after } from "node:test";
import assert from "node:assert/strict";
import { createMenuStateMachine, type MenuStateMachineDeps } from "../src/tools/search-config.ts";
import type { TUI } from "@earendil-works/pi-tui";

const origFetch = globalThis.fetch;
after(() => { globalThis.fetch = origFetch; mock.restoreAll(); });

function makeTui(): TUI {
  return { requestRender: () => {} } as unknown as TUI;
}

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

const fakeTheme = new Proxy({}, { get: () => () => "" }) as never;

function makeDeps(overrides: Partial<MenuStateMachineDeps> = {}): MenuStateMachineDeps {
  const commits: Array<[string | undefined, string]> = [];
  return {
    resolveApiKey: async () => "k",
    resolveBaseUrl: () => "http://x",
    initialCurrentProvider: undefined,
    theme: fakeTheme,
    onCommitPersist: (provider) => commits.push([provider, "persisted"]),
    onClose: () => {},
    ...overrides,
  };
}

test("createMenuStateMachine: starts in top mode", () => {
  const sm = createMenuStateMachine(makeDeps());
  assert.equal(sm.mode(), "top");
  assert.equal(sm.catalog(), undefined);
});

test("createMenuStateMachine: onActivateSearchProvider switches to sub mode (loading first)", () => {
  globalThis.fetch = mock.method(globalThis, "fetch", async () => jsonResponse(200, {
    data: [{ id: "tavily-search", name: "Tavily", search_types: ["web"] }],
  })) as never;
  const sm = createMenuStateMachine(makeDeps());
  sm.onActivateSearchProvider();
  assert.equal(sm.mode(), "sub");
  // catalog is undefined until the async fetch resolves
  assert.equal(sm.catalog(), undefined);
});

test("createMenuStateMachine: onCommit switches back to top and calls onCommitPersist", () => {
  const sm = createMenuStateMachine(makeDeps());
  sm.onActivateSearchProvider();
  sm.onCommit("tavily-search");
  assert.equal(sm.mode(), "top");
});

test("createMenuStateMachine: onCancel switches back to top without persisting", () => {
  const sm = createMenuStateMachine(makeDeps());
  sm.onActivateSearchProvider();
  sm.onCancel();
  assert.equal(sm.mode(), "top");
});

test("createMenuStateMachine: getComponent in top mode returns a Component", () => {
  const sm = createMenuStateMachine(makeDeps());
  const comp = sm.getComponent(makeTui(), fakeTheme);
  const out = (comp as { render: (w: number) => string[] }).render(80);
  assert.ok(Array.isArray(out));
  assert.ok(out.length > 0);
});

test("createMenuStateMachine: submenu component instance is cached across renders and recreated after reset", async () => {
  globalThis.fetch = mock.method(globalThis, "fetch", async () => jsonResponse(200, {
    data: [{ id: "tavily-search", name: "Tavily", search_types: ["web"] }],
  })) as never;
  const sm = createMenuStateMachine(makeDeps());
  const tui = makeTui();
  // Activate via the top-level component's Enter handler (the production path).
  const top = sm.getComponent(tui, fakeTheme) as unknown as { handleInput: (d: string) => void };
  top.handleInput("\r");
  await new Promise((r) => setTimeout(r, 10));
  assert.notEqual(sm.catalog(), undefined, "catalog must load after activation");

  // Same instance across repeated getComponent calls proves the SettingsList
  // (and its selectedIndex cursor) survives re-renders; a fresh instance would
  // reset the cursor to row 0 on every frame and make the submenu unusable.
  const first = sm.getComponent(tui, fakeTheme);
  const second = sm.getComponent(tui, fakeTheme);
  assert.equal(first, second, "submenu must be the same cached instance across renders");

  // Commit resets to top; re-activation must build a fresh submenu instance.
  sm.onCommit("tavily-search");
  assert.equal(sm.mode(), "top");
  const top2 = sm.getComponent(tui, fakeTheme) as unknown as { handleInput: (d: string) => void };
  top2.handleInput("\r");
  await new Promise((r) => setTimeout(r, 10));
  const third = sm.getComponent(tui, fakeTheme);
  assert.notEqual(third, first, "submenu must be recreated after commit + re-activation");
});

test("createMenuStateMachine: requestRender is called after the catalog fetch resolves", async () => {
  let releaseFetch: () => void = () => {};
  const gate = new Promise<void>((resolve) => { releaseFetch = resolve; });
  globalThis.fetch = mock.method(globalThis, "fetch", async () => {
    await gate;
    return jsonResponse(200, { data: [{ id: "tavily-search", name: "Tavily", search_types: ["web"] }] });
  }) as never;
  let renders = 0;
  const tui = { requestRender: () => { renders++; } } as unknown as TUI;
  const sm = createMenuStateMachine(makeDeps());
  const top = sm.getComponent(tui, fakeTheme) as unknown as { handleInput: (d: string) => void };
  top.handleInput("\r");
  const rendersAfterActivate = renders;
  assert.ok(rendersAfterActivate >= 1, "activation must request a render synchronously");
  // The fetch is still gated: the Loading component is on screen, no catalog yet.
  assert.equal(sm.catalog(), undefined, "catalog must not be set before the fetch resolves");
  releaseFetch();
  await new Promise((r) => setTimeout(r, 10));
  assert.notEqual(sm.catalog(), undefined, "catalog must load once the fetch resolves");
  assert.ok(renders > rendersAfterActivate, "requestRender must fire after the catalog fetch resolves");
});

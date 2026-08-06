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

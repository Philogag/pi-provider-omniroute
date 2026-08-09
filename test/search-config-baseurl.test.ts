// test/search-config-baseurl.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { initTheme, type Theme } from "@earendil-works/pi-coding-agent";
import {
  renderBaseUrlSubmenu,
  createMenuStateMachine,
  sanitizeBaseUrlForPersist,
  type MenuStateMachineDeps,
} from "../src/tools/search-config.ts";
import type { TUI } from "@earendil-works/pi-tui";

initTheme();  // keyHint() 构建时调用 theme.fg，需要全局 theme

const fakeTheme = {
  fg: (_c: string, s: string) => s,
  bold: (s: string) => s,
} as unknown as Theme;

function makeTui(): TUI {
  return { requestRender: () => {} } as unknown as TUI;
}

function makeDeps(overrides: Partial<MenuStateMachineDeps> = {}): MenuStateMachineDeps {
  return {
    resolveApiKey: async () => "k",
    resolveBaseUrl: () => "http://x",
    initialCurrentProvider: undefined,
    initialFetchProvider: undefined,
    initialBaseUrl: undefined,
    onCommitPersist: () => {},
    onCommitFetchPersist: () => {},
    onCommitBaseUrlPersist: () => {},
    onClose: () => {},
    ...overrides,
  };
}

// --- renderBaseUrlSubmenu ---

test("renderBaseUrlSubmenu: renders input prefilled with current baseUrl", () => {
  const params = {
    currentBaseUrl: "https://x/v1",
    theme: fakeTheme,
    onCommit: () => {},
    onCancel: () => {},
  };
  const component = renderBaseUrlSubmenu(params) as unknown as {
    render: (w: number) => string[];
    _input: { getValue: () => string };
  };
  const out = component.render(80).join("\n");
  assert.match(out, /Base URL/i, "title must exist");
  assert.match(component._input.getValue(), /https:\/\/x\/v1/, "input prefilled");
});

test("renderBaseUrlSubmenu: onSubmit commits the entered value", () => {
  let committed = "";
  const component = renderBaseUrlSubmenu({
    currentBaseUrl: "",
    theme: fakeTheme,
    onCommit: (v) => { committed = v; },
    onCancel: () => {},
  }) as unknown as { _input: { onSubmit?: (v: string) => void } };
  component._input.onSubmit?.("https://new/v1");
  assert.equal(committed, "https://new/v1");
});

test("renderBaseUrlSubmenu: onEscape cancels", () => {
  let cancelled = false;
  const component = renderBaseUrlSubmenu({
    currentBaseUrl: "",
    theme: fakeTheme,
    onCommit: () => {},
    onCancel: () => { cancelled = true; },
  }) as unknown as { _input: { onEscape?: () => void } };
  component._input.onEscape?.();
  assert.equal(cancelled, true);
});

// --- state machine: sub-base-url mode ---

test("createMenuStateMachine: onActivateBaseUrl switches to sub-base-url mode", () => {
  const sm = createMenuStateMachine(makeDeps());
  sm.onActivateBaseUrl();
  assert.equal(sm.mode(), "sub-base-url");
});

test("createMenuStateMachine: base-url commit calls onCommitBaseUrlPersist and returns to top", () => {
  const persisted: Array<string | undefined> = [];
  const sm = createMenuStateMachine(makeDeps({ onCommitBaseUrlPersist: (v) => persisted.push(v) }));
  sm.onActivateBaseUrl();
  sm.onCommit("https://new/v1");
  assert.deepEqual(persisted, ["https://new/v1"]);
  assert.equal(sm.mode(), "top");
});

test("createMenuStateMachine: base-url submenu instance cached across renders and recreated after commit", () => {
  const sm = createMenuStateMachine(makeDeps());
  const tui = makeTui();
  sm.onActivateBaseUrl();
  const first = sm.getComponent(tui, fakeTheme);
  const second = sm.getComponent(tui, fakeTheme);
  assert.equal(first, second, "base-url submenu must be cached across renders");
  sm.onCommit("https://new/v1");
  sm.onActivateBaseUrl();
  const third = sm.getComponent(tui, fakeTheme);
  assert.notEqual(third, first, "base-url submenu must be recreated after commit");
});

test("createMenuStateMachine: initialBaseUrl prefills the base-url submenu input", () => {
  const sm = createMenuStateMachine(makeDeps({ initialBaseUrl: "https://init/v1" }));
  const tui = makeTui();
  sm.onActivateBaseUrl();
  const comp = sm.getComponent(tui, fakeTheme) as unknown as { _input: { getValue: () => string } };
  assert.equal(comp._input.getValue(), "https://init/v1");
});

test("createMenuStateMachine: base-url cancel returns to top without persisting", () => {
  let persisted = false;
  const sm = createMenuStateMachine(makeDeps({ onCommitBaseUrlPersist: () => { persisted = true; } }));
  sm.onActivateBaseUrl();
  sm.onCancel();
  assert.equal(sm.mode(), "top");
  assert.equal(persisted, false);
});

test("createMenuStateMachine: base-url commit with empty input deletes stored value (undefined persist)", () => {
  const persisted: Array<string | undefined> = [];
  const sm = createMenuStateMachine(makeDeps({ onCommitBaseUrlPersist: (v) => persisted.push(v) }));
  sm.onActivateBaseUrl();
  sm.onCommit("   "); // whitespace-only → sanitize to undefined (delete)
  assert.deepEqual(persisted, [undefined]);
  assert.equal(sm.mode(), "top");
});

test("createMenuStateMachine: base-url commit with invalid URL refuses to persist", () => {
  const persisted: Array<string | undefined> = [];
  const sm = createMenuStateMachine(makeDeps({ onCommitBaseUrlPersist: (v) => persisted.push(v) }));
  sm.onActivateBaseUrl();
  sm.onCommit("not a url");
  assert.deepEqual(persisted, [], "invalid URL must not be persisted");
  assert.equal(sm.mode(), "top");
});

test("sanitizeBaseUrlForPersist: empty → undefined, valid → normalized, invalid → { ok:false }", () => {
  assert.deepEqual(sanitizeBaseUrlForPersist("   "), { ok: true, value: undefined });
  assert.deepEqual(sanitizeBaseUrlForPersist("https://new/v1"), { ok: true, value: "https://new/v1" });
  const bad = sanitizeBaseUrlForPersist("ftp://nope");
  assert.equal(bad.ok, false);
});

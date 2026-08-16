// test/search-config-base-url-editor.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { initTheme, type Theme } from "@earendil-works/pi-coding-agent";
import { renderBaseUrlEditor } from "../src/tools/search-config.ts";

initTheme();

// The Input cursor and keyHint render ANSI/OSC escape sequences; strip them
// before text assertions (the brief's plain-text matches assume no escapes).
function stripAnsi(s: string): string {
  return s
    .replace(/\x1B\[[0-9;?]*[ -/]*[@-~]/g, "") // CSI (SGR, cursor, reverse video)
    .replace(/\x1B_[^\x07]*\x07/g, "") // OSC (kitty cursor placement)
    .replace(/\x1B/g, ""); // any stray escape
}

const fakeTheme = { fg: (_c: string, s: string) => s, bold: (s: string) => s } as unknown as Theme;

function makeParams(overrides: Partial<Parameters<typeof renderBaseUrlEditor>[0]> = {}) {
  return { current: "http://localhost:20128/v1", theme: fakeTheme, onCommit: () => {}, onCancel: () => {}, ...overrides };
}

function editor(overrides: Partial<Parameters<typeof renderBaseUrlEditor>[0]> = {}) {
  return renderBaseUrlEditor(makeParams(overrides)) as unknown as {
    render: (w: number) => string[];
    handleInput: (d: string) => void;
    _input: { setValue(v: string): void; handleInput(d: string): void };
  };
}

test("renderBaseUrlEditor: renders title, prefilled value, and hint", () => {
  const e = editor({ current: "https://route.example/v1" });
  const joined = stripAnsi(e.render(80).join("\n"));
  assert.match(joined, /Base URL/);
  assert.match(joined, /https:\/\/route\.example\/v1/);
  assert.match(joined, /enter save/);
});

test("renderBaseUrlEditor: Enter on valid prefilled value commits it", () => {
  const committed: Array<string | undefined> = [];
  const e = editor({ current: "https://route.example/v1", onCommit: (v) => committed.push(v) });
  e.handleInput("\n");
  assert.deepEqual(committed, ["https://route.example/v1"]);
});

test("renderBaseUrlEditor: empty input commits undefined (reset)", () => {
  const committed: Array<string | undefined> = [];
  const e = editor({ current: "https://route.example/v1", onCommit: (v) => committed.push(v) });
  e._input.setValue("");
  e.handleInput("\n");
  assert.deepEqual(committed, [undefined]);
});

test("renderBaseUrlEditor: invalid input shows error and does not commit", () => {
  const committed: Array<string | undefined> = [];
  let renders = 0;
  const e = editor({ current: "https://route.example/v1", onCommit: (v) => committed.push(v), requestRender: () => { renders++; } });
  e._input.setValue("not-a-url");
  e.handleInput("\n");
  assert.deepEqual(committed, []);
  assert.ok(renders >= 1, "error must request a re-render");
  assert.match(stripAnsi(e.render(80).join("\n")), /Invalid base URL/);
});

test("renderBaseUrlEditor: Escape cancels without committing", () => {
  const committed: Array<string | undefined> = [];
  let cancelled = 0;
  const e = editor({ current: "https://route.example/v1", onCommit: (v) => committed.push(v), onCancel: () => { cancelled++; } });
  e.handleInput("\x1b");
  assert.deepEqual(committed, []);
  assert.equal(cancelled, 1);
});

test("renderBaseUrlEditor: injected resolver drives the error path", () => {
  const e = editor({
    current: "http://x",
    resolveBaseUrlInput: (raw) => ({ ok: false, error: `boom: ${raw}` }),
    requestRender: () => {},
  });
  e.handleInput("\n");
  assert.match(stripAnsi(e.render(80).join("\n")), /boom: http:\/\/x/);
});

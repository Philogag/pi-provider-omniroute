import { test, mock, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initTheme, type Theme } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

// Fresh module instance per entry() call: /omniroute-settings registration is
// guarded by module-level state (settingsCommandRegistered) that the harness
// cannot reset, so a cache-busted dynamic import keeps tests order-independent
// (freshPi() already zeroes the harness counters).
let moduleSeq = 0;
async function entry(pi: ExtensionAPI): Promise<void> {
  const mod = (await import(`../src/index.ts?t=${++moduleSeq}`)) as {
    default: (pi: ExtensionAPI) => Promise<void>;
  };
  await mod.default(pi);
}

const registeredCommands: Record<string, (args: string, ctx: ExtensionCommandContext) => Promise<void> | void> = {};
let registerProviderCount = 0;
let registerToolCount = 0;
let registerCommandCalls = 0;
let sessionStartHandler: ((...args: unknown[]) => unknown) | undefined;

after(() => { mock.restoreAll(); });

function makeTui(): { requestRender: () => void } {
  return { requestRender: () => {} };
}

// Strip ANSI/OSC escapes from rendered lines before text assertions (the
// editor's Input cursor and keyHint emit escapes even with an identity theme).
function stripAnsi(s: string): string {
  return s
    .replace(/\x1B\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\x1B_[^\x07]*\x07/g, "")
    .replace(/\x1B/g, "");
}

function mockPi(): ExtensionAPI {
  return {
    registerProvider: () => { registerProviderCount++; },
    registerTool: () => { registerToolCount++; },
    registerCommand: (name: string, opts: { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> | void }) => {
      registerCommandCalls++;
      registeredCommands[name] = opts.handler;
    },
    on: (event: string, fn: (...args: unknown[]) => unknown) => {
      if (event === "session_start") sessionStartHandler = fn;
    },
  } as unknown as ExtensionAPI;
}

function freshPi(): ExtensionAPI {
  registerProviderCount = 0;
  registerToolCount = 0;
  registerCommandCalls = 0;
  for (const k of Object.keys(registeredCommands)) delete registeredCommands[k];
  return mockPi();
}

test("entry registers provider + 2 tools but not /omniroute-settings (TUI-only)", async () => {
  await entry(freshPi());
  assert.equal(registerProviderCount, 1);
  assert.equal(registerToolCount, 2);
  assert.equal(registeredCommands["omniroute-settings"], undefined, "command must not be registered before a TUI session start");
});

test("TUI session_start registers /omniroute-settings exactly once (idempotent)", async () => {
  await entry(freshPi());
  assert.ok(sessionStartHandler, "harness must capture session_start");
  await sessionStartHandler!({}, { mode: "tui" });
  await sessionStartHandler!({}, { mode: "tui" });
  assert.ok(registeredCommands["omniroute-settings"], "command must be registered after a TUI session start");
  assert.equal(registerCommandCalls, 1, "repeated session_start must not re-register");
});

test("print/json/rpc session_start never registers /omniroute-settings", async () => {
  for (const mode of ["print", "json", "rpc"]) {
    await entry(freshPi());
    await sessionStartHandler!({}, { mode });
    assert.equal(registeredCommands["omniroute-settings"], undefined, `${mode} must not register the settings command`);
    assert.equal(registerCommandCalls, 0, `${mode} must not call registerCommand`);
  }
});

test("TUI-registered handler no longer notifies in non-TUI contexts", async () => {
  await entry(freshPi());
  await sessionStartHandler!({}, { mode: "tui" });
  let notified: { msg: string; type: string } | null = null;
  const ctx = {
    mode: "print",
    modelRegistry: { getApiKeyForProvider: async () => "test-key" },
    ui: {
      notify: (msg: string, type?: "info" | "warning" | "error") => { notified = { msg, type: type ?? "info" }; },
      custom: async () => {},
    },
  } as unknown as ExtensionCommandContext;
  await registeredCommands["omniroute-settings"]("", ctx);
  assert.equal(notified, null, "the non-TUI notify branch must be gone");
});

test("wrapped custom component re-resolves the state-machine component per render", async () => {
  initTheme(); // the TUI path renders via the passed-in UI theme; initTheme must run first
  await entry(mockPi());
  await sessionStartHandler?.({}, { mode: "tui" });

  // Point the catalog fetch at an unreachable loopback port so it refuses
  // quickly and falls back to the built-in list instead of holding the loop.
  const prevBaseUrl = process.env.OMNIROUTE_BASE_URL;
  process.env.OMNIROUTE_BASE_URL = "http://127.0.0.1:1";

  let factory:
    | ((tui: unknown, theme: unknown, kb: unknown, done: (r?: unknown) => void) => unknown)
    | undefined;
  let doneResult: unknown = "unset";
  let requestRenderCount = 0;
  const ctx = {
    mode: "tui",
    modelRegistry: { getApiKeyForProvider: async () => "test-key" },
    ui: {
      notify: () => {},
      custom: async (f: typeof factory) => { factory = f; },
    },
  } as unknown as ExtensionCommandContext;

  await registeredCommands["omniroute-settings"]("", ctx);
  assert.ok(factory, "custom factory must be invoked in TUI mode with a resolvable key");

  const tui = { requestRender: () => { requestRenderCount++; } };
  // The custom callback now uses the UI theme passed by the host (Task 2 theme
  // channel switch); an identity stub keeps rendered text assertable.
  const fakeTheme = {
    fg: (_c: string, s: string) => s,
    bold: (s: string) => s,
  } as unknown as Theme;
  const wrapped = factory!(tui, fakeTheme, undefined, (r) => { doneResult = r; }) as {
    render: (w: number) => string[];
    invalidate: () => void;
    handleInput: (data: string) => void;
  };

  // Top mode: the first render is the top-level menu.
  assert.match(wrapped.render(80).join("\n"), /Search provider/);

  // Enter switches the state machine to sub mode; the very next render must
  // reflect the sub-mode (loading) component, not the stale top-level menu.
  // This is the regression the previous review flagged: capturing the component
  // once would render the frozen top menu here.
  wrapped.handleInput("\r");
  assert.ok(requestRenderCount >= 1, "Enter must trigger a re-render request");
  assert.match(wrapped.render(80).join("\n"), /Loading search providers/);

  // Let the (refused) catalog fetch settle into the built-in fallback list,
  // then confirm the sub-menu renders once the catalog is applied.
  await new Promise((r) => setTimeout(r, 50));
  assert.match(wrapped.render(80).join("\n"), /Search provider|Auto|Loading/);

  // In sub mode, one Esc returns to the top menu, then a second Esc closes the
  // overlay via done(undefined). The wrapper must keep honoring the live mode.
  wrapped.handleInput("\x1b");
  assert.equal(doneResult, "unset", "sub-mode Esc must not close the overlay");
  assert.match(wrapped.render(80).join("\n"), /Search provider/);
  doneResult = "unset";
  wrapped.handleInput("\x1b");
  assert.equal(doneResult, undefined, "top-level Esc must call done(undefined)");

  if (prevBaseUrl === undefined) delete process.env.OMNIROUTE_BASE_URL;
  else process.env.OMNIROUTE_BASE_URL = prevBaseUrl;
});

test("/omniroute-settings: top menu renders Base URL row; base-url reset commit refreshes models", async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "omniroute-cmd-basurl-test-"));
  const origPi = process.env.PI_AGENT_DIR;
  process.env.PI_AGENT_DIR = tmpDir;
  writeFileSync(join(tmpDir, "settings.json"), JSON.stringify({ "pi-provider-omniroute": { baseUrl: "https://cfg.example/v1" } }));
  try {
    await entry(mockPi());
    await sessionStartHandler?.({}, { mode: "tui" });
    const refreshCalls: Array<{ providers?: string[]; force?: boolean }> = [];
    let factory: ((tui: unknown, theme: unknown, kb: unknown, done: (r?: unknown) => void) => unknown) | undefined;
    const ctx = {
      mode: "tui",
      modelRegistry: { getApiKeyForProvider: async () => "test-key", refresh: async (o: unknown) => { refreshCalls.push(o as { providers?: string[]; force?: boolean }); } },
      ui: { notify: () => {}, custom: async (f: typeof factory) => { factory = f; } },
    } as unknown as ExtensionCommandContext;
    await registeredCommands["omniroute-settings"]("", ctx);
    const fakeTheme = { fg: (_c: string, s: string) => s, bold: (s: string) => s } as unknown as Theme;
    const wrapped = factory!(makeTui(), fakeTheme, undefined, () => {}) as { render: (w: number) => string[]; handleInput: (d: string) => void };
    assert.match(stripAnsi(wrapped.render(80).join("\n")), /Base URL:/);
    // Down Down Enter -> editor; Enter on empty -> reset commit
    wrapped.handleInput("\x1b[B");
    wrapped.handleInput("\x1b[B");
    wrapped.handleInput("\r");
    assert.match(stripAnsi(wrapped.render(80).join("\n")), /enter save/);
    // ctrl+k (\x0b) clears the prefilled value (tui.editor.deleteToLineEnd;
    // setValue leaves the cursor at 0, so ctrl+u/deleteToLineStart is a no-op).
    // Enter on the now-empty input commits undefined (reset).
    wrapped.handleInput("\x0b");
    wrapped.handleInput("\n");  // 空输入 = 重置
    assert.deepEqual(refreshCalls, [{ providers: ["omniroute"], force: true }], "reset commit must trigger model refresh");
    const cfg = JSON.parse(readFileSync(join(tmpDir, "settings.json"), "utf8"));
    assert.equal(cfg["pi-provider-omniroute"].baseUrl, undefined, "reset must remove baseUrl from settings block");
  } finally {
    if (origPi === undefined) delete process.env.PI_AGENT_DIR;
    else process.env.PI_AGENT_DIR = origPi;
  }
});

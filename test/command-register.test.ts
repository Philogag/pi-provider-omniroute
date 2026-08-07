import { test, mock, after } from "node:test";
import assert from "node:assert/strict";
import entry from "../src/index.ts";
import { initTheme, type Theme } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

const registeredCommands: Record<string, (args: string, ctx: ExtensionCommandContext) => Promise<void> | void> = {};
let registerProviderCount = 0;
let registerToolCount = 0;
let sessionStartHandler: ((...args: unknown[]) => unknown) | undefined;

after(() => { mock.restoreAll(); });

function mockPi(): ExtensionAPI {
  return {
    registerProvider: () => { registerProviderCount++; },
    registerTool: () => { registerToolCount++; },
    registerCommand: (name: string, opts: { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> | void }) => {
      registeredCommands[name] = opts.handler;
    },
    on: (event: string, fn: (...args: unknown[]) => unknown) => {
      if (event === "session_start") sessionStartHandler = fn;
    },
  } as unknown as ExtensionAPI;
}

test("entry registers /omniroute-settings command and provider + 2 tools", async () => {
  await entry(mockPi());
  assert.equal(registerProviderCount, 1);
  assert.equal(registerToolCount, 2);
  assert.ok(registeredCommands["omniroute-settings"], "/omniroute-settings must be registered");
});

test("/omniroute-settings in non-TUI mode notifies without opening UI", async () => {
  await entry(mockPi());
  let notified: { msg: string; type: string } | null = null;
  const ctx = {
    mode: "print",
    ui: { notify: (msg: string, type?: "info" | "warning" | "error") => { notified = { msg, type: type ?? "info" }; } },
  } as unknown as ExtensionCommandContext;
  await registeredCommands["omniroute-settings"]("", ctx);
  assert.ok(notified, "must notify in non-TUI mode");
  assert.match((notified as { msg: string } | null)!.msg, /TUI mode/i);
});

test("wrapped custom component re-resolves the state-machine component per render", async () => {
  initTheme(); // the TUI path renders via the passed-in UI theme; initTheme must run first
  await entry(mockPi());

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

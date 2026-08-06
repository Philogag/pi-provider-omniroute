import { test, mock, after } from "node:test";
import assert from "node:assert/strict";
import entry from "../src/index.ts";
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

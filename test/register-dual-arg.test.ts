import { test, mock, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import entry from "../src/index.ts";

let capturedName: string | undefined;
let capturedConfig: Record<string, unknown> | undefined;

function mockPi(): ExtensionAPI {
  return {
    registerProvider(name: string, config: unknown) {
      capturedName = name;
      capturedConfig = config as Record<string, unknown>;
    },
    registerTool() {},
    on() {},
    registerCommand() {},
  } as unknown as ExtensionAPI;
}

const origPiAgentDir = process.env.PI_AGENT_DIR;
beforeEach(() => {
  capturedName = undefined;
  capturedConfig = undefined;
  process.env.PI_AGENT_DIR = mkdtempSync(join(tmpdir(), "omniroute-dual-"));
  delete process.env.OMNIROUTE_BASE_URL;
});
after(() => {
  if (origPiAgentDir === undefined) delete process.env.PI_AGENT_DIR;
  else process.env.PI_AGENT_DIR = origPiAgentDir;
  mock.restoreAll();
});

function okModels(data: unknown[]): Response {
  return { ok: true, status: 200, json: async () => ({ data }) } as Response;
}

test("entry registers provider with dual-arg form: name omniroute + config api field", async () => {
  mock.method(globalThis, "fetch", async () => okModels([{ id: "m1" }]));
  await entry(mockPi());
  assert.equal(capturedName, "omniroute");
  assert.ok(capturedConfig, "config must be provided");
  assert.equal((capturedConfig as Record<string, unknown>)["api"], "omniroute");
  assert.equal((capturedConfig as Record<string, unknown>)["auth"], undefined, "no custom auth object");
  assert.equal((capturedConfig as Record<string, unknown>)["stream"], undefined, "no stream field");
  assert.equal((capturedConfig as Record<string, unknown>)["getModels"], undefined);
  assert.equal((capturedConfig as Record<string, unknown>)["refreshModels"], undefined);
});

test("entry fetches /models once at startup and maps into static models", async () => {
  const fetchMock = mock.method(globalThis, "fetch", async () =>
    okModels([{ id: "gpt-4o", capabilities: { reasoning: true } }]),
  );
  await entry(mockPi());
  const models = (capturedConfig as Record<string, unknown>)["models"] as Array<Record<string, unknown>>;
  assert.ok(Array.isArray(models), "models must be a static array");
  assert.equal(models.length, 1);
  assert.equal(models[0]["id"], "gpt-4o");
  assert.equal(models[0]["api"], "omniroute");
  assert.equal(models[0]["reasoning"], true);
  assert.ok((fetchMock.mock.calls[0]?.arguments[0] as string).includes("/models"));
});

test("entry survives /models failure with empty models + warn, still registers", async () => {
  const warn = mock.method(console, "warn", () => {});
  mock.method(globalThis, "fetch", async () => ({ ok: false, status: 401 }) as Response);
  await entry(mockPi());
  const models = (capturedConfig as Record<string, unknown>)["models"] as unknown[];
  assert.deepEqual(models, []);
  assert.ok(warn.mock.callCount() >= 1, "must warn on /models failure");
});

test("entry sets apiKey to undefined (stored credential)", async () => {
  mock.method(globalThis, "fetch", async () => okModels([]));
  await entry(mockPi());
  assert.equal((capturedConfig as Record<string, unknown>)["apiKey"], undefined);
});

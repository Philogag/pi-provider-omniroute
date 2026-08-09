// test/lazy-fetch.test.ts
import { test, mock, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import entry from "../src/index.ts";

let capturedName: string | undefined;
let capturedConfig: { models?: unknown[]; baseUrl?: string } | undefined;

function mockPi(): ExtensionAPI {
  return {
    registerProvider(name: string, config: { models?: unknown[]; baseUrl?: string }) {
      capturedName = name;
      capturedConfig = config;
    },
    registerTool() {},
    on() {},
    registerCommand() {},
  } as unknown as ExtensionAPI;
}

function okResponse(data: Array<{ id: string }>): Response {
  return { ok: true, status: 200, json: async () => ({ data }) } as Response;
}

const origPiAgentDir = process.env.PI_AGENT_DIR;
const origBaseUrl = process.env.OMNIROUTE_BASE_URL;
beforeEach(() => {
  capturedName = undefined;
  capturedConfig = undefined;
  process.env.PI_AGENT_DIR = mkdtempSync(join(tmpdir(), "omniroute-test-"));
  delete process.env.OMNIROUTE_BASE_URL;
});
after(() => {
  if (origPiAgentDir === undefined) delete process.env.PI_AGENT_DIR;
  else process.env.PI_AGENT_DIR = origPiAgentDir;
  if (origBaseUrl === undefined) delete process.env.OMNIROUTE_BASE_URL;
  else process.env.OMNIROUTE_BASE_URL = origBaseUrl;
  mock.restoreAll();
});

test("扩展加载期发起一次 /models 请求并映射到静态 models", async () => {
  const fetchMock = mock.method(globalThis, "fetch", async () =>
    okResponse([{ id: "gpt-4o" }, { id: "claude-3-5-sonnet" }]),
  );
  await entry(mockPi());
  assert.equal(fetchMock.mock.callCount(), 1, "exactly one /models request at load");
  const models = capturedConfig!.models!;
  assert.equal(models.length, 2);
  assert.deepEqual(models.map((m) => (m as { id: string }).id), ["gpt-4o", "claude-3-5-sonnet"]);
  assert.equal((models[0] as { baseUrl: string }).baseUrl, "http://localhost:20128/v1");
});

test("扩展加载期 /models 非 2xx 时降级为空列表并 warn，不抛", async () => {
  const warn = mock.method(console, "warn", () => {});
  mock.method(globalThis, "fetch", async () => ({ ok: false, status: 401 }) as Response);
  await entry(mockPi());
  assert.deepEqual(capturedConfig!.models, []);
  assert.ok(warn.mock.callCount() >= 1);
});

test("扩展加载期 /models 网络失败时降级为空列表并 warn，不抛", async () => {
  const warn = mock.method(console, "warn", () => {});
  mock.method(globalThis, "fetch", async () => { throw new TypeError("fetch failed"); });
  await entry(mockPi());
  assert.deepEqual(capturedConfig!.models, []);
  assert.ok(warn.mock.callCount() >= 1);
});

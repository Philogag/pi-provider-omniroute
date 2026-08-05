// test/lazy-fetch.test.ts
import { test, mock, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Provider, RefreshModelsContext } from "@earendil-works/pi-ai";
import { OMNIROUTE_DEFAULT_BASE_URL } from "../src/auth.ts";
import entry from "../src/index.ts";

let capturedProvider: Provider<"openai-completions"> | undefined;

function mockPi(): ExtensionAPI {
  return {
    registerProvider(p: Provider) {
      capturedProvider = p as Provider<"openai-completions">;
    },
  } as unknown as ExtensionAPI;
}

function okResponse(data: Array<{ id: string }>): Response {
  return { ok: true, status: 200, json: async () => ({ data }) } as Response;
}

function refreshCtx(): RefreshModelsContext {
  return { signal: new AbortController().signal } as RefreshModelsContext;
}

// 环境隔离：PI_AGENT_DIR 指向空临时目录，避免读到本机 ~/.pi/agent/auth.json
const origPiAgentDir = process.env.PI_AGENT_DIR;
const origBaseUrl = process.env.OMNIROUTE_BASE_URL;
beforeEach(() => {
  capturedProvider = undefined;
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

test("扩展加载期不发起任何 /models 请求", async () => {
  const fetchMock = mock.method(globalThis, "fetch", async () => okResponse([]));
  await entry(mockPi());
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("provider 注册后 getModels() 返回空数组", async () => {
  mock.method(globalThis, "fetch", async () => okResponse([]));
  await entry(mockPi());
  assert.ok(capturedProvider);
  assert.deepEqual(capturedProvider!.getModels(), []);
});

test("refreshModels 成功时填充缓存", async () => {
  mock.method(globalThis, "fetch", async () =>
    okResponse([{ id: "gpt-4o" }, { id: "claude-3-5-sonnet" }]),
  );
  await entry(mockPi());
  await capturedProvider!.refreshModels!(refreshCtx());
  const models = capturedProvider!.getModels();
  assert.equal(models.length, 2);
  assert.deepEqual(models.map((m) => m.id), ["gpt-4o", "claude-3-5-sonnet"]);
  assert.equal(models[0].baseUrl, OMNIROUTE_DEFAULT_BASE_URL);
});

test("refreshModels 非 2xx 时错误冒泡", async () => {
  mock.method(globalThis, "fetch", async () => ({ ok: false, status: 401 }) as Response);
  await entry(mockPi());
  await assert.rejects(
    capturedProvider!.refreshModels!(refreshCtx()),
    /OmniRoute \/models failed: 401/,
  );
});

test("refreshModels 网络错误时错误冒泡且未被吞掉", async () => {
  mock.method(globalThis, "fetch", async () => {
    throw new TypeError("fetch failed");
  });
  await entry(mockPi());
  await assert.rejects(capturedProvider!.refreshModels!(refreshCtx()), /fetch failed/);
});

test("refreshModels 失败后保留旧列表（后续读取命中缓存）", async () => {
  const fetchMock = mock.method(globalThis, "fetch", async () =>
    okResponse([{ id: "gpt-4o" }]),
  );
  await entry(mockPi());
  await capturedProvider!.refreshModels!(refreshCtx());
  assert.equal(capturedProvider!.getModels().length, 1);

  fetchMock.mock.mockImplementation(async () => ({ ok: false, status: 500 }) as Response);
  await assert.rejects(capturedProvider!.refreshModels!(refreshCtx()), /500/);
  assert.equal(capturedProvider!.getModels().length, 1); // 旧列表保留
});
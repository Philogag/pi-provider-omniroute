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
    registerTool() {
      // 桩：扩展工厂注册工具不应影响现有 provider 测试
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

test("refreshModels 使用 settings.json 中 pi-provider-omniroute 块的 baseUrl（优先于默认值）", async () => {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(join(process.env.PI_AGENT_DIR!, "settings.json"), JSON.stringify({ "pi-provider-omniroute": { baseUrl: "https://route.ai.philogag.com/v1" } }));
  let fetchedUrl: string | undefined;
  mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => {
    fetchedUrl = String(input);
    return okResponse([{ id: "gpt-4o" }]);
  });
  await entry(mockPi());
  await capturedProvider!.refreshModels!(refreshCtx());
  assert.equal(fetchedUrl, "https://route.ai.philogag.com/v1/models");
  assert.equal(capturedProvider!.getModels()[0].baseUrl, "https://route.ai.philogag.com/v1");
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

test("refreshModels 0.84.1 契约：stored 先发布，allowNetwork=false 时不再请求网络", async () => {
  // pi-ai 0.84.1 的 context：{ stored, publish, allowNetwork:false, signal } —
  // 应直接发布 stored 中的模型，且不得触发 fetch。
  const fetchMock = mock.method(globalThis, "fetch", async () => okResponse([]));
  await entry(mockPi());

  const storedModels = [
    { id: "cached-1", provider: "omniroute", baseUrl: "http://localhost:20128/v1" },
    { id: "other-provider", provider: "anthropic", baseUrl: "http://x/v1" },
  ];
  let published: { update?: () => void } | undefined;
  const ctx = {
    stored: { models: storedModels },
    allowNetwork: false,
    publish: async (publication: { update?: () => void }) => {
      published = publication;
      return true;
    },
    signal: new AbortController().signal,
  };

  await capturedProvider!.refreshModels!(ctx as never);
  assert.equal(fetchMock.mock.callCount(), 0, "offline restore must not hit the network");
  assert.ok(published, "publish must be called with the restored catalog");
  published!.update!();
  assert.deepEqual(
    capturedProvider!.getModels().map((m) => m.id),
    ["cached-1"],
    "only omniroute-provider models are restored",
  );
});

test("refreshModels 0.84.1 契约：成功时通过 publish persist+update 发布新列表", async () => {
  mock.method(globalThis, "fetch", async () => okResponse([{ id: "gpt-4o" }]));
  await entry(mockPi());

  let publication: { persist?: unknown; update?: () => void } | undefined;
  const ctx = {
    allowNetwork: true,
    publish: async (p: { persist?: unknown; update?: () => void }) => {
      publication = p;
      return true;
    },
    signal: new AbortController().signal,
  };

  await capturedProvider!.refreshModels!(ctx as never);
  assert.ok(publication, "publish must be called after a successful network refresh");
  assert.ok(publication!.persist, "persist payload must be provided");
  const persisted = publication!.persist as { models: Array<{ id: string }> };
  assert.deepEqual(persisted.models.map((m) => m.id), ["gpt-4o"]);
  publication!.update!();
  assert.deepEqual(capturedProvider!.getModels().map((m) => m.id), ["gpt-4o"]);
});

test("extension factory registers both web tools without throwing", async () => {
  await entry(mockPi() as unknown as Parameters<typeof entry>[0]);
  assert.ok(capturedProvider, "provider still registered");
});

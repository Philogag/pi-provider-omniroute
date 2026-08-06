// test/models-metadata.test.ts
import { test, mock, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Provider, RefreshModelsContext } from "@earendil-works/pi-ai";
import entry from "../src/index.ts";

let capturedProvider: Provider<"openai-completions"> | undefined;

function mockPi(): ExtensionAPI {
  return {
    registerProvider(p: Provider) {
      capturedProvider = p as Provider<"openai-completions">;
    },
    registerTool() {
      // 桩：与 lazy-fetch.test.ts 保持一致
    },
  } as unknown as ExtensionAPI;
}

// 条目形态开放：可选元数据字段任意，非法值由实现侧守卫兜底
type Entry = { id: string } & Record<string, unknown>;

function okResponse(data: Entry[]): Response {
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
  process.env.PI_AGENT_DIR = mkdtempSync(join(tmpdir(), "omniroute-meta-test-"));
  delete process.env.OMNIROUTE_BASE_URL;
});
after(() => {
  if (origPiAgentDir === undefined) delete process.env.PI_AGENT_DIR;
  else process.env.PI_AGENT_DIR = origPiAgentDir;
  if (origBaseUrl === undefined) delete process.env.OMNIROUTE_BASE_URL;
  else process.env.OMNIROUTE_BASE_URL = origBaseUrl;
  mock.restoreAll();
});

async function refreshOnce(data: Entry[]) {
  mock.method(globalThis, "fetch", async () => okResponse(data));
  await entry(mockPi());
  await capturedProvider!.refreshModels!(refreshCtx());
  return capturedProvider!.getModels();
}

test("contextWindow: max_input_tokens 优先于 context_length", async () => {
  const [m] = await refreshOnce([
    { id: "m1", max_input_tokens: 1048576, context_length: 2000000 },
  ]);
  assert.equal(m.contextWindow, 1048576);
});

test("contextWindow: max_input_tokens 缺失时用 context_length", async () => {
  const [m] = await refreshOnce([{ id: "m2", context_length: 131072 }]);
  assert.equal(m.contextWindow, 131072);
});

test("contextWindow: 两者均缺失时回退 128000", async () => {
  const [m] = await refreshOnce([{ id: "m3" }]);
  assert.equal(m.contextWindow, 128000);
});

test("contextWindow: 非法值按缺失处理（0 / 负数 / 字符串）", async () => {
  const [m] = await refreshOnce([
    { id: "m4", max_input_tokens: 0, context_length: -1 },
  ]);
  assert.equal(m.contextWindow, 128000);
});

test("maxTokens: 存在 max_output_tokens 时使用该值", async () => {
  const [m] = await refreshOnce([{ id: "m1", max_output_tokens: 65536 }]);
  assert.equal(m.maxTokens, 65536);
});

test("maxTokens: 缺失时回退 4096", async () => {
  const [m] = await refreshOnce([{ id: "m2" }]);
  assert.equal(m.maxTokens, 4096);
});

test("reasoning: capabilities.reasoning 为 true 时启用", async () => {
  const [m] = await refreshOnce([{ id: "m1", capabilities: { reasoning: true } }]);
  assert.equal(m.reasoning, true);
});

test("reasoning: 键缺失时禁用", async () => {
  const [m] = await refreshOnce([
    { id: "m2", capabilities: { tool_calling: true } },
  ]);
  assert.equal(m.reasoning, false);
});

test("reasoning: capabilities 整体缺失时禁用", async () => {
  const [m] = await refreshOnce([{ id: "m3" }]);
  assert.equal(m.reasoning, false);
});

test("input: capabilities.vision 为 true 时声明图片输入", async () => {
  const [m] = await refreshOnce([{ id: "m1", capabilities: { vision: true } }]);
  assert.deepEqual(m.input, ["text", "image"]);
});

test("input: input_modalities 含 image 时声明图片输入", async () => {
  const [m] = await refreshOnce([
    { id: "m2", input_modalities: ["text", "image"] },
  ]);
  assert.deepEqual(m.input, ["text", "image"]);
});

test("input: 无视觉证据时仅声明文本", async () => {
  const [m] = await refreshOnce([{ id: "m3" }]);
  assert.deepEqual(m.input, ["text"]);
});

test("name: 存在时使用该值", async () => {
  const [m] = await refreshOnce([{ id: "openai/gpt-4o", name: "GPT-4o" }]);
  assert.equal(m.name, "GPT-4o");
});

test("name: 缺失时回退 id", async () => {
  const [m] = await refreshOnce([{ id: "auto/best-coding" }]);
  assert.equal(m.name, "auto/best-coding");
});

test("name: 非字符串时回退 id", async () => {
  const [m] = await refreshOnce([{ id: "m6", name: 42 }]);
  assert.equal(m.name, "m6");
});

test("thinkingLevelMap: capabilities.thinking 为 true 时设置完整映射", async () => {
  const [m] = await refreshOnce([{ id: "m1", capabilities: { thinking: true } }]);
  assert.deepEqual(m.thinkingLevelMap, {
    minimal: "minimal",
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "high",
    max: "high",
  });
});

test("thinkingLevelMap: thinking 缺失时不设置", async () => {
  const [m] = await refreshOnce([
    { id: "m2", capabilities: { tool_calling: true } },
  ]);
  assert.equal(m.thinkingLevelMap, undefined);
});

test("thinkingLevelMap: capabilities 整体缺失时不设置", async () => {
  const [m] = await refreshOnce([{ id: "m3" }]);
  assert.equal(m.thinkingLevelMap, undefined);
});

test("input: input_modalities 非数组时按无视觉证据处理", async () => {
  const [m] = await refreshOnce([{ id: "m9", input_modalities: "text,image" }]);
  assert.deepEqual(m.input, ["text"]);
});

test("contextWindow: 字符串 max_input_tokens 按缺失处理", async () => {
  const [m] = await refreshOnce([{ id: "m5", max_input_tokens: "100" }]);
  assert.equal(m.contextWindow, 128000);
});

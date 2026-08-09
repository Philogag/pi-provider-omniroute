# use-dual-arg-provider-registration 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

---
change: use-dual-arg-provider-registration
design-doc: openspec/changes/use-dual-arg-provider-registration/superpower-design.md
base-ref: 0bcc0434f060ff8b5762c037149ffb4f598b3864
---

**Goal:** 将扩展注册从单参数 `pi.registerProvider(provider)` 改造为双参数 `pi.registerProvider("omniroute", config)`，使扩展同时兼容 pi 与 oh-my-pi（omp），并保留遥测诊断能力。

**Architecture:** 注册层（index.ts 双参数 + 静态 models）、配置层（omniroute.json 持久化 baseUrl）、模型层（启动 /models 一次 + 失败降级）、状态机层（/omniroute-settings 增 Base URL 子菜单）。

**Tech Stack:** TypeScript, @earendil-works/pi-coding-agent, @earendil-works/pi-tui (Input/SelectList/DynamicBorder), node:test, @earendil-works/pi-ai (compat streamSimple)

## Global Constraints

- `config.api` 必须为自定义名 `"omniroute"`（两宿主契约：omp `assertCustomApiName` 禁止内置名；pi `Api = KnownApi | (string & {})` 允许；`streamWith` 在 `model.api === extension.api` 时用 extension.streamSimple 接管——models 每项 `api` 必须同值）
- `config.apiKey` 必须为 **`undefined`**（stored credential）——pi 认 `$NAME`/`${NAME}`，omp 认裸名，两宿主语法**互斥**，唯一交集是 stored credential（/login）
- `config.baseUrl` = `resolveOmnirouteBaseUrl()`：omniroute.json `baseUrl` → `process.env.OMNIROUTE_BASE_URL` → `OMNIROUTE_DEFAULT_BASE_URL`
- 启动时 `await fetch(`${baseUrl}/models`)` 一次；失败 → 空 models + `console.warn`，**不抛、不阻断**注册
- 保留遥测包装：`streamSimple` 内 `withOmnirouteFetch` + `wrapStreamWithCost` 不变
- 删除：`auth` 对象（omnirouteApiKeyAuth）、`getModels`、`refreshModels`、`stream` 字段
- `src/tools/http.ts`、`src/tools/search.ts`、`src/tools/web-fetch.ts`、`src/tools/usage-telemetry.ts` 不改
- 禁改测试：`test/url.test.ts`、`test/tools-*.test.ts`、`test/tools-search.test.ts`、`test/usage-telemetry*.test.ts`、`test/search-tool-merge.test.ts`、`test/web-fetch-merge.test.ts`
- **`test/lazy-fetch.test.ts` 与 `test/models-metadata.test.ts` 必须重写**（Task 2 Step 6）：它们断言旧注册行为（单参数 Provider 对象、getModels/refreshModels 懒加载、加载期零 /models 请求），与新设计（双参数、静态 models、加载期急切拉取一次 /models）直接矛盾，无法兼容
- 基线：213/213 测试通过（上一变更后 214/214；本变更增删后数字可能变化，以实际为准）+ typecheck 0
- 每任务独立 commit，commit message 体现设计意图
- tasks.md 勾选只改内容不 commit
- omp 冒烟与 stored credential 实测为人工验证任务（Task 5），不由 subagent 执行

---

### Task 1: omniroute.json baseUrl 持久化（配置层）

**Files:**
- Modify: `src/tools/search-config.ts`（`OmnirouteConfigShape` :118-120、`readOmnirouteConfig` :126-151、`writeOmnirouteConfig` :153-178 区域）
- Test: `test/search-config-persistence.test.ts`（增 baseUrl 用例）

**Interfaces:**
- Produces:
  - `OmnirouteConfigShape` 增 `readonly baseUrl?: string`
  - `readOmnirouteConfig(): { baseUrl?: string; search?: {provider?: string}; fetch?: {provider?: string} }`（解析根级 `baseUrl` 字符串字段，非字符串 → warn + 跳过）
  - `writeOmnirouteConfig(provider: string | undefined, key: "search" | "fetch" = "search")` 不变（baseUrl 单独管理）
  - `writeOmnirouteBaseUrl(baseUrl: string | undefined): void`（新）：写/删根级 `baseUrl`，保留未知键，atomic tmp+rename，0o600
  - `resolveOmnirouteBaseUrl(): string`（新）：`readOmnirouteConfig().baseUrl` → `process.env.OMNIROUTE_BASE_URL` → `OMNIROUTE_DEFAULT_BASE_URL`（import 自 `../auth.ts`）

- [ ] **Step 1: 写失败测试（read baseUrl）**

追加到 `test/search-config-persistence.test.ts`：

```ts
test("readOmnirouteConfig: parses root baseUrl string", async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const origDir = process.env.PI_AGENT_DIR;
  const dir = mkdtempSync(join(tmpdir(), "omniroute-cfg-"));
  process.env.PI_AGENT_DIR = dir;
  try {
    writeFileSync(join(dir, "omniroute.json"), JSON.stringify({ baseUrl: "https://x/v1" }));
    const { readOmnirouteConfig } = await import("../src/tools/search-config.ts");
    assert.equal(readOmnirouteConfig().baseUrl, "https://x/v1");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    if (origDir === undefined) delete process.env.PI_AGENT_DIR;
    else process.env.PI_AGENT_DIR = origDir;
  }
});

test("readOmnirouteConfig: non-string baseUrl warns and is skipped", async () => {
  // PI_AGENT_DIR 指向临时目录，omniroute.json = { baseUrl: 123 }
  // 断言 readOmnirouteConfig().baseUrl === undefined 且 console.warn 被调用
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx tsx --test test/search-config-persistence.test.ts`
Expected: FAIL（`readOmnirouteConfig().baseUrl` 为 undefined；属性不存在）

- [ ] **Step 3: 实现 readOmnirouteConfig baseUrl 解析**

在 `src/tools/search-config.ts`：

```ts
export interface OmnirouteConfigShape {
  readonly baseUrl?: string;
  readonly search?: { readonly provider?: string };
  readonly fetch?: { readonly provider?: string };
}
```

`readOmnirouteConfig` 的 root 循环前加：

```ts
const rawBaseUrl = root["baseUrl"];
if (typeof rawBaseUrl === "string") result.baseUrl = rawBaseUrl;
else if (rawBaseUrl !== undefined) {
  console.warn(`[omniroute] ${path} \`baseUrl\` is not a string; treating as unset`);
}
```

返回类型改 `{ baseUrl?: string; search?: { provider: string }; fetch?: { provider: string } }`。

- [ ] **Step 4: 实现 writeOmnirouteBaseUrl + resolveOmnirouteBaseUrl**

`writeOmnirouteBaseUrl`（复用 writeOmnirouteConfig 的 read-preserve-unknown 模式）：

```ts
export function writeOmnirouteBaseUrl(baseUrl: string | undefined): void {
  const path = resolveOmnirouteConfigPath();
  const tmp = path + ".tmp";
  let root: Record<string, unknown> = {};
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      root = parsed as Record<string, unknown>;
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`[omniroute] failed to read ${path} before write: ${(err as Error).message}`);
    }
  }
  if (baseUrl === undefined) delete root["baseUrl"];
  else root["baseUrl"] = baseUrl;
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(tmp, JSON.stringify(root, null, 2) + "\n", { mode: 0o600 });
    renameSync(tmp, path);
  } catch (err) {
    console.warn(`[omniroute] failed to write ${path}: ${(err as Error).message}`);
    try { unlinkSync(tmp); } catch { /* ignore */ }
  }
}

export function resolveOmnirouteBaseUrl(): string {
  return (
    readOmnirouteConfig().baseUrl ??
    process.env.OMNIROUTE_BASE_URL ??
    OMNIROUTE_DEFAULT_BASE_URL
  );
}
```

`OMNIROUTE_DEFAULT_BASE_URL` 需 import：`import { OMNIROUTE_DEFAULT_BASE_URL } from "../auth.ts";`（加到现有 import）。

- [ ] **Step 5: 写 writeOmnirouteBaseUrl 测试**

```ts
test("writeOmnirouteBaseUrl: writes root baseUrl preserving unknown keys", async () => {
  // PI_AGENT_DIR 临时目录；先写 omniroute.json = { search: { provider: "tavily-search" } }
  // writeOmnirouteBaseUrl("https://y/v1")
  // 断言文件内容 = { search: { provider: "tavily-search" }, baseUrl: "https://y/v1" }
});

test("writeOmnirouteBaseUrl: undefined deletes root baseUrl", async () => {
  // 先写 { baseUrl: "https://y/v1" } → writeOmnirouteBaseUrl(undefined) → 断言 baseUrl 键不存在
});
```

- [ ] **Step 6: 写 resolveOmnirouteBaseUrl 优先级测试**

```ts
test("resolveOmnirouteBaseUrl: file beats env beats default", async () => {
  // 临时 PI_AGENT_DIR + omniroute.json { baseUrl: "https://file/v1" }
  // process.env.OMNIROUTE_BASE_URL = "https://env/v1"
  // 断言 resolveOmnirouteBaseUrl() === "https://file/v1"
  // 删除文件 → === "https://env/v1"
  // delete env → === OMNIROUTE_DEFAULT_BASE_URL
});
```

- [ ] **Step 7: 运行测试确认通过**

Run: `npx tsx --test test/search-config-persistence.test.ts test/search-config.test.ts`
Expected: PASS（含既有用例）

- [ ] **Step 8: Commit**

```bash
git add src/tools/search-config.ts test/search-config-persistence.test.ts
git commit -m "feat: persist omniroute baseUrl in omniroute.json with env/default fallback"
```

---

### Task 2: 注册层双参数改造（index.ts + auth 清理 + 静态 models）

**Files:**
- Modify: `src/index.ts`（注册块 :55-107 区域、import 行 :5-10）
- Modify: `src/auth.ts`（删 `omnirouteApiKeyAuth`/`promptBaseUrlWithRetry` + 相关 import）
- Modify: `src/auth-credentials.ts`（删 `resolveStoredBaseUrl`）
- Test: `test/register-dual-arg.test.ts`（新）、`test/auth.test.ts`（删 login/check 用例）、`test/auth-credentials.test.ts`（删 resolveStoredBaseUrl 用例）、`test/command-register.test.ts`（mock 适配双参数）

**Interfaces:**
- Consumes: Task 1 的 `resolveOmnirouteBaseUrl`、`writeOmnirouteBaseUrl`
- Produces:
  - `loadStaticModels(baseUrl: string): Promise<readonly OmnirouteModelEntry[]>`（新导出，index.ts 内或独立函数）：`fetch(`${baseUrl}/models`)`，非 2xx → `console.warn` + 返回 `[]`；`data` 缺省/非数组 → warn + `[]`；成功 → `data.map(toOmnirouteModel(m, baseUrl))`；`toOmnirouteModel` 返回值 `api` 改为 `"omniroute" as const`
  - 双参数注册：`pi.registerProvider("omniroute", { baseUrl, api: "omniroute", streamSimple, models })`

- [ ] **Step 1: 写失败测试（双参数注册捕获）**

新建 `test/register-dual-arg.test.ts`：

```ts
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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx tsx --test test/register-dual-arg.test.ts`
Expected: FAIL（`registerProvider` 仍被单参数调用，`capturedName` 为 undefined / 断言失败）

- [ ] **Step 3: 清理 auth.ts**

`src/auth.ts` 删除 `promptBaseUrlWithRetry`、`omnirouteApiKeyAuth` 及不再使用的 import（`ApiKeyAuth`、`AuthInteraction`）。保留 `OMNIROUTE_DEFAULT_BASE_URL`、`validateAndNormalizeBaseUrl`。

- [ ] **Step 4: 清理 auth-credentials.ts**

`src/auth-credentials.ts` 删除 `resolveStoredBaseUrl` 函数（保留 `readCredential`/`resolveAuthJsonPath`）。

- [ ] **Step 5: 改造 index.ts 注册块**

import 变更：
```ts
// 删: import { omnirouteApiKeyAuth, OMNIROUTE_DEFAULT_BASE_URL } from "./auth.ts";
// 删: import { resolveStoredBaseUrl } from "./auth-credentials.ts";
// 增: import { OMNIROUTE_DEFAULT_BASE_URL, validateAndNormalizeBaseUrl } from "./auth.ts"; // 若需校验
// 增: import { resolveOmnirouteBaseUrl } from "./tools/search-config.ts";
```

`toOmnirouteModel` 返回值 `api: "openai-completions" as const` → `api: "omniroute" as const`；`type OmnirouteModel = Model<"openai-completions">` → `type OmnirouteModel = Model<"omniroute">`。

注册块重写：

```ts
export default async function (pi: ExtensionAPI) {
  const baseUrl = resolveOmnirouteBaseUrl();

  let models: OmnirouteModel[] = [];
  try {
    const res = await fetch(`${baseUrl}/models`);
    if (!res.ok) {
      console.warn(`[omniroute] /models failed: ${res.status}; using empty model list`);
    } else {
      const { data } = (await res.json()) as { data: OmnirouteModelEntry[] };
      if (Array.isArray(data)) models = data.map((m) => toOmnirouteModel(m, baseUrl));
      else console.warn(`[omniroute] /models response missing data array; using empty model list`);
    }
  } catch (err) {
    console.warn(`[omniroute] /models fetch failed: ${err instanceof Error ? err.message : err}; using empty model list`);
  }

  const streamSimple = (
    model: OmnirouteModel,
    context: Context,
    options?: SimpleStreamOptions,
  ) => {
    let telemetry: OmnirouteTelemetry | undefined = undefined;
    const captured = withOmnirouteFetch(fetch, (t) => { telemetry = t; });
    return wrapStreamWithCost(
      streamSimple(model, context, { ...options, fetch: captured }),
      () => telemetry,
    );
  };

  pi.registerProvider("omniroute", {
    baseUrl,
    api: "omniroute",
    streamSimple,
    models,
  });
  // …tools 注册与 session_start/命令部分保持不变…
}
```

（若 `Model<"omniroute">` 类型与 `streamSimple` 参数类型不兼容，用 `as never` 或显式 `Model` 泛型转换——以 tsc 为准。）

- [ ] **Step 6: 重写 lazy-fetch.test.ts 与 models-metadata.test.ts（旧注册行为已废除）**

`test/lazy-fetch.test.ts` 整体重写——旧断言（加载期零请求 / getModels / refreshModels）与新设计冲突，改为测新行为：

```ts
// test/lazy-fetch.test.ts 重写
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
```

`test/models-metadata.test.ts` 重写——删 refreshModels 路径，改为通过静态 models 断言 toOmnirouteModel 映射（contextWindow/maxTokens/reasoning/input/cost 字段）：

```ts
// test/models-metadata.test.ts 重写（toOmnirouteModel 映射经静态 models 断言）
test("contextWindow: max_input_tokens 优先于 context_length", async () => {
  mock.method(globalThis, "fetch", async () =>
    okResponse([{ id: "m1", max_input_tokens: 1048576, context_length: 2000000 }]),
  );
  await entry(mockPi());
  const [m] = capturedConfig!.models! as Array<Record<string, unknown>>;
  assert.equal(m.contextWindow, 1048576);
});
// 其余用例（max_output_tokens→maxTokens、reasoning 映射、thinking→thinkingLevelMap、input modalities、默认值 128000/4096）同样改为经 capturedConfig.models 断言，保持既有断言值不变
```

（models-metadata.test.ts 其余用例逐条照搬原断言值，仅把 `refreshOnce(data)` 改为 `mock fetch + await entry(mockPi())` 后读 `capturedConfig!.models`。）

- [ ] **Step 7: 运行测试确认通过**

Run: `npx tsx --test test/register-dual-arg.test.ts test/auth.test.ts test/auth-credentials.test.ts test/command-register.test.ts test/lazy-fetch.test.ts test/models-metadata.test.ts`
Expected: PASS

- [ ] **Step 8: typecheck + 全量测试**

Run: `npm run typecheck && npm test`
Expected: typecheck exit 0；全量 PASS（213/213 ± 增删；lazy-fetch.test.ts 若引用被删的 getModels/refreshModels 会失败——该文件在禁改列表，若失败需在 Step 9 前核对原因）

- [ ] **Step 9: Commit**

```bash
git add src/index.ts src/auth.ts src/auth-credentials.ts test/register-dual-arg.test.ts test/auth.test.ts test/auth-credentials.test.ts test/command-register.test.ts test/lazy-fetch.test.ts test/models-metadata.test.ts
git commit -m "feat: dual-arg provider registration with static models and stored-credential auth"
```

---

### Task 3: 状态机层 — Base URL 子菜单

**Files:**
- Modify: `src/tools/search-config.ts`（`MenuStateMachineDeps`/`MenuStateMachine`/`createMenuStateMachine`、`renderTopLevelMenu`、新 `renderBaseUrlSubmenu`）
- Test: `test/search-config-state-machine.test.ts`（增）、`test/search-config-toplevel.test.ts`（增）

**Interfaces:**
- Consumes: `writeOmnirouteBaseUrl`（Task 1）、pi-tui `Input` 组件
- Produces:
  - `BaseUrlSubmenuParams { currentBaseUrl: string; theme: Theme; onCommit: (baseUrl: string) => void; onCancel: () => void; requestRender?: () => void }`
  - `renderBaseUrlSubmenu(params): Component`——Pattern 1：DynamicBorder 顶 + Text 标题 + `Input` + keyHint + DynamicBorder 底；`Input.setValue(currentBaseUrl)`；`onSubmit` → `onCommit(value)`；`onEscape` → `onCancel`；handleInput 转发；暴露 `_input` 供测试
  - `TopLevelMenuParams` 增 `baseUrlPreview: string` 与 `onActivateBaseUrl: () => void`；`renderTopLevelMenu` 第三行 `{ value: "base-url", label: \`Base URL: ${baseUrlPreview}\` }`
  - `MenuStateMachineDeps` 增 `initialBaseUrl: string | undefined`、`onCommitBaseUrlPersist: (baseUrl: string) => void`
  - `MenuStateMachine.mode()` 类型 → `"top" | "sub-search" | "sub-fetch" | "sub-base-url"`；新增 `cachedBaseUrlSubmenu` 缓存

- [ ] **Step 1: 写失败测试（renderBaseUrlSubmenu）**

追加到 `test/search-config-toplevel.test.ts`（或新文件 `test/search-config-base-url-submenu.test.ts`）：

```ts
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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx tsx --test test/search-config-toplevel.test.ts`
Expected: FAIL（`renderBaseUrlSubmenu` 未定义）

- [ ] **Step 3: 实现 renderBaseUrlSubmenu**

```ts
export interface BaseUrlSubmenuParams {
  readonly currentBaseUrl: string;
  readonly theme: Theme;
  readonly onCommit: (baseUrl: string) => void;
  readonly onCancel: () => void;
  readonly requestRender?: () => void;
}

export function renderBaseUrlSubmenu(params: BaseUrlSubmenuParams): Component {
  const { theme } = params;
  const input = new Input();
  input.setValue(params.currentBaseUrl);
  input.onSubmit = (value: string) => params.onCommit(value);
  input.onEscape = params.onCancel;

  const container = new Container();
  container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
  container.addChild(new Text(theme.fg("accent", theme.bold("Base URL")), 1, 0));
  container.addChild(input as unknown as Component);
  container.addChild(new Text(theme.fg("dim", keyHint("tui.input.submit", "save") + " · " + keyHint("tui.select.cancel", "back")), 1, 0));
  container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

  (container as unknown as { handleInput: (data: string) => void }).handleInput = (data: string): void => {
    input.handleInput(data);
    params.requestRender?.();
  };

  (container as unknown as { _input: Input })._input = input;
  return container as unknown as Component;
}
```

import 增 `Input`：`import { Container, Input, Loader, SelectList, Text, type Component, type SelectItem } from "@earendil-works/pi-tui";`

- [ ] **Step 4: 更新 renderTopLevelMenu 第三行**

`TopLevelMenuParams` 增字段；items 数组增第三项；onSelect 分支：

```ts
export interface TopLevelMenuParams {
  readonly currentProvider: string | undefined;
  readonly fetchPreview: string;
  readonly baseUrlPreview: string;
  readonly theme: Theme;
  readonly onActivateSearchProvider: () => void;
  readonly onActivateFetchProvider: () => void;
  readonly onActivateBaseUrl: () => void;
  readonly onClose?: () => void;
  readonly requestRender?: () => void;
}

const items: SelectItem[] = [
  { value: "search", label: `Search provider: ${preview}` },
  { value: "fetch", label: `Web Fetch provider: ${fetchPreview}` },
  { value: "base-url", label: `Base URL: ${baseUrlPreview}` },
];
selectList.onSelect = (item: SelectItem): void => {
  if (item.value === "fetch") params.onActivateFetchProvider();
  else if (item.value === "base-url") params.onActivateBaseUrl();
  else params.onActivateSearchProvider();
};
```

- [ ] **Step 5: 更新既有 toplevel 测试（新增参数）**

`test/search-config-toplevel.test.ts` 的 `makeParams` 增 `baseUrlPreview: "http://localhost:20128/v1"`、`onActivateBaseUrl: () => {}`。增用例：

```ts
test("renderTopLevelMenu: renders Base URL row", () => {
  const params = makeParams({ baseUrlPreview: "https://x/v1" });
  const component = renderTopLevelMenu(params) as unknown as { render: (w: number) => string[] };
  assert.match(component.render(80).join("\n"), /Base URL:\s+https:\/\/x\/v1/i);
});

test("renderTopLevelMenu: Enter on base-url row activates base URL submenu", () => {
  let activated = "";
  const params = makeParams({
    onActivateSearchProvider: () => { activated = "search"; },
    onActivateFetchProvider: () => { activated = "fetch"; },
    onActivateBaseUrl: () => { activated = "base-url"; },
  });
  const component = renderTopLevelMenu(params) as unknown as { _sl: { onSelect?: (item: { value: string; label: string }) => void } };
  component._sl.onSelect?.({ value: "base-url", label: "Base URL: https://x/v1" });
  assert.equal(activated, "base-url");
});
```

- [ ] **Step 6: 扩展状态机（sub-base-url 模式）**

`MenuStateMachineDeps` 增 `initialBaseUrl: string | undefined`、`onCommitBaseUrlPersist: (baseUrl: string) => void`。

`createMenuStateMachine`：
- `let currentBaseUrl = deps.initialBaseUrl ?? "";`
- `let mode: "top" | "sub-search" | "sub-fetch" | "sub-base-url" = "top";`
- 新缓存 `let cachedBaseUrlSubmenu: Component | undefined;`
- 新增 `onActivateBaseUrl()`：`mode = "sub-base-url"; cachedTopLevel = undefined; cachedBaseUrlSubmenu = undefined;`
- 所有 reset 路径（onCommit/onCancel/onEsc）加 `cachedBaseUrlSubmenu = undefined;`
- `onCommit` 分支：`if (mode === "sub-base-url") { cachedBaseUrlSubmenu = undefined; currentBaseUrl = provider; deps.onCommitBaseUrlPersist(provider); }`
- `getComponent` top 分支调 `renderTopLevelMenu({ ..., baseUrlPreview: currentBaseUrl, onActivateBaseUrl: () => { mode = "sub-base-url"; cachedTopLevel = undefined; cachedBaseUrlSubmenu = undefined; tui.requestRender(); } })`
- `getComponent` 末尾 `// mode === "sub-base-url"` 分支：

```ts
if (cachedBaseUrlSubmenu) return cachedBaseUrlSubmenu;
cachedBaseUrlSubmenu = renderBaseUrlSubmenu({
  currentBaseUrl,
  theme,
  requestRender: () => tui.requestRender(),
  onCommit: (v) => {
    cachedTopLevel = undefined;
    cachedBaseUrlSubmenu = undefined;
    currentBaseUrl = v;
    deps.onCommitBaseUrlPersist(v);
    mode = "top";
    tui.requestRender();
  },
  onCancel: () => {
    cachedTopLevel = undefined;
    cachedBaseUrlSubmenu = undefined;
    mode = "top";
    tui.requestRender();
  },
});
return cachedBaseUrlSubmenu;
```

- [ ] **Step 7: 更新状态机测试（makeDeps 增参 + 新用例）**

`test/search-config-state-machine.test.ts` 的 `makeDeps` 增 `initialBaseUrl: undefined`、`onCommitBaseUrlPersist: () => {}`。新用例：

```ts
test("createMenuStateMachine: onActivateBaseUrl switches to sub-base-url mode", () => {
  const sm = createMenuStateMachine(makeDeps());
  sm.onActivateBaseUrl();
  assert.equal(sm.mode(), "sub-base-url");
});

test("createMenuStateMachine: base-url commit calls onCommitBaseUrlPersist and returns to top", () => {
  const persisted: Array<string> = [];
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
```

- [ ] **Step 8: 运行测试确认通过**

Run: `npx tsx --test test/search-config-state-machine.test.ts test/search-config-toplevel.test.ts test/search-config-base-url-submenu.test.ts`
Expected: PASS

- [ ] **Step 9: typecheck + 全量测试**

Run: `npm run typecheck && npm test`
Expected: 0 + PASS

- [ ] **Step 10: Commit**

```bash
git add src/tools/search-config.ts test/search-config-state-machine.test.ts test/search-config-toplevel.test.ts test/search-config-base-url-submenu.test.ts
git commit -m "feat: Base URL submenu in settings state machine with cached input component"
```

---

### Task 4: index.ts 接线（settings 命令 + session_start）

**Files:**
- Modify: `src/index.ts`（/omniroute-settings 命令 handler :126-200 区域、session_start）
- Test: `test/command-register.test.ts`（增接线断言）、`test/session-start-config.test.ts`（若受影响）

**Interfaces:**
- Consumes: Task 1 `resolveOmnirouteBaseUrl`/`writeOmnirouteBaseUrl`、Task 3 `MenuStateMachineDeps.initialBaseUrl`/`onCommitBaseUrlPersist`
- Produces: 完整 settings 接线

- [ ] **Step 1: 写失败测试（顶层含 Base URL 行）**

`test/command-register.test.ts` 的 "wrapped custom component" 测试中，`wrapped.render(80)` 断言补 `/Base URL/`（当前无此行 → FAIL）：

```ts
assert.match(wrapped.render(80).join("\n"), /Base URL/);
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx tsx --test test/command-register.test.ts`
Expected: FAIL（顶层渲染无 Base URL 行）

- [ ] **Step 3: 接线 createMenuStateMachine deps**

命令 handler 的 `createMenuStateMachine({ ... })` 增：

```ts
initialBaseUrl: resolveOmnirouteBaseUrl(),
onCommitBaseUrlPersist: (baseUrl) => {
  writeOmnirouteBaseUrl(baseUrl);
},
```

（`resolveOmnirouteBaseUrl`/`writeOmnirouteBaseUrl` 从 `./tools/search-config.ts` import。）

- [ ] **Step 4: session_start 读取 baseUrl（无需变更——baseUrl 在注册时已静态解析；若 session_start 需刷新 provider baseUrl 则补，但双参数 provider baseUrl 固定，跳过）**

（本步骤无代码变更——设计 D-BASEURL 静态化，session_start 只处理 provider 选择。）

- [ ] **Step 5: 运行测试确认通过**

Run: `npx tsx --test test/command-register.test.ts`
Expected: PASS

- [ ] **Step 6: typecheck + 全量测试**

Run: `npm run typecheck && npm test`
Expected: 0 + PASS

- [ ] **Step 7: Commit**

```bash
git add src/index.ts test/command-register.test.ts
git commit -m "feat: wire base URL setting into omniroute-settings command"
```

---

### Task 5: 验证收尾

**Files:**
- Test: 全量回归
- Docs: `README.md` / `README.zh-CN.md`（注册说明：/login stored credential + settings Base URL 项）

**Interfaces:**
- Consumes: 全部任务产物

- [ ] **Step 1: 全量验证**

Run: `npm run typecheck && npm test`
Expected: typecheck 0；全量 PASS（213/213 基线 ± 增删）

- [ ] **Step 2: 残留检查**

```bash
grep -rn "omnirouteApiKeyAuth\|resolveStoredBaseUrl\|getModels\|refreshModels" src/ || echo "clean"
```

Expected: 仅注释/文档提及或无输出；src/ 无残留引用

- [ ] **Step 3: 标准 Pi 人工冒烟（用户侧，subagent 不做）**

- 清空/备份 `~/.pi/agent/auth.json` 的 omniroute 条目后：`/login omniroute`（标准流程，只存 key）
- 聊天一条消息 → 正常响应 + 遥测诊断可见（`usage.cost.total` = 遥测成本）
- `/omniroute-settings` → 顶层三行（Search / Web Fetch / Base URL）→ Base URL 项输入新值 → 持久化到 `~/.pi/agent/omniroute.json`
- 重启后新 baseUrl 生效（聊天走新地址）

- [ ] **Step 4: omp 冒烟（用户侧，subagent 不做）**

- `export PATH="$HOME/.bun/bin:$PATH" && omp install "git:github.com/Philogag/pi-provider-omniroute"` → 安装成功（无 appendAssistantMessageDiagnostic 错误）
- `omp -p --model omniroute/smart/deepseek-v4-flash "hi"` → 不崩溃、正常响应
- 若 omp 的 stored credential 未配置，按 omp login 流程配置 key 后重试

- [ ] **Step 5: README 更新**

`README.md` + `README.zh-CN.md`：注册段改为双参数描述（/login stored credential + settings Base URL 项 + env 优先级）。

- [ ] **Step 6: Commit**

```bash
git add README.md README.zh-CN.md
git commit -m "docs: dual-arg registration, stored-credential login, and Base URL setting"
```

---

## Self-Review 记录

**1. Spec coverage：**
- 需求 1（扩展在缺 diagnostics 导出宿主可加载）→ 既有实现（fix-omp-pi-ai-compat），本变更不触碰 usage-telemetry.ts ✓
- 需求 1 场景（标准 Pi 加载 / omp 加载 / 遥测内容不变 / usage.cost.total 覆盖）→ 全部由既有遥测测试 + Task 2/5 覆盖 ✓
- 需求 2（双参数注册）场景 4 个 → 双参数注册成功（Task 2 Step 1 test 1）、models 拉取失败降级（Task 2 Step 1 test 3）、streamSimple 遥测保留（Task 2 保留包装 + 既有遥测测试）、apiKey 标准字段（Task 2 Step 1 test 4）✓

**2. Placeholder scan：** 无 TBD/TODO；所有代码块完整可执行 ✓

**3. Type consistency：**
- `writeOmnirouteBaseUrl` / `resolveOmnirouteBaseUrl`（Task 1 定义，Task 4 消费）签名一致 ✓
- `MenuStateMachineDeps.initialBaseUrl/onCommitBaseUrlPersist`（Task 3 定义，Task 4 消费）一致 ✓
- `TopLevelMenuParams.baseUrlPreview/onActivateBaseUrl`（Task 3 定义，Task 4 隐式经状态机）一致 ✓
- `renderBaseUrlSubmenu` 暴露 `_input`（测试钩子，Task 3 Step 1/3 一致）✓
- `MenuStateMachine.mode()` 四态类型（Task 3 定义）与 index.ts wrapper 的 `sm.mode() === "top"` 判断兼容 ✓
- 注意：Task 2 中 `toOmnirouteModel` 的 `api` 类型改为 `"omniroute" as const`，`OmnirouteModel = Model<"omniroute">`——`streamSimple` 参数类型沿用 `OmnirouteModel`，若 tsc 报类型不匹配（Model 泛型约束为 KnownApi），用 `Model<Api>` 或 `as never` 适配（与既有 `stream(...)` `as never` 模式一致）
- 风险：`test/command-register.test.ts` 的 wrapped component 测试在 Task 2 后 provider 不再有 `auth`/`stream`——该测试只断言渲染输出，不访问这些字段，Task 2 Step 6 已核对 ✓

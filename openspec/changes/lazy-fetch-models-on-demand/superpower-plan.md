---
change: lazy-fetch-models-on-demand
design-doc: openspec/changes/lazy-fetch-models-on-demand/superpower-design.md
base-ref: 9687bf923981a1eda6126d3ca6c7abf159d18e74
---

# lazy-fetch-models-on-demand 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 移除扩展启动期的 `/models` 主动拉取，使模型列表仅在 pi ModelRuntime 需要时通过 `refreshModels` 按需获取，并用自动化测试固化该行为。

**Architecture:** `src/index.ts` 仅删除 `tryRegisterModels` 的自动调用与函数定义，`refreshModels({ signal })` 成为唯一拉取入口（实现零改动，天然满足 pi-ai 契约的 retain-on-failure 与 signal 透传）。新增 `test/lazy-fetch.test.ts`（node:test + mock fetch + mock ExtensionAPI + PI_AGENT_DIR 环境隔离）覆盖 delta spec 验收场景。

**Tech Stack:** TypeScript（NodeNext ESM）、node:test、node:assert/strict、`@earendil-works/pi-ai` Provider 契约、`@earendil-works/pi-coding-agent` ExtensionAPI 类型。

## Global Constraints

- `refreshModels` 内部实现**禁止修改**（fetch 路径、解析逻辑、错误消息原样保留）——来自 design.md D4
- 删除后 `src/index.ts` 内不得残留 `AbortController` / `setTimeout` / `console.warn`（均仅属于 `tryRegisterModels`）
- `provider.getModels()` 签名不变：始终返回 `OmnirouteModel[]`（空数组表示未拉取），**不**改为 `undefined`
- 测试不得依赖开发者本机 `~/.pi/agent/auth.json` 或 `OMNIROUTE_BASE_URL` 环境变量（用 `PI_AGENT_DIR` 指向空临时目录隔离）
- 测试风格沿用现有 `test/auth.test.ts`：`node:test` + `node:assert/strict` + `as unknown as` 类型断言
- 每个任务结束时运行 `npm run typecheck` 与 `npm test` 并提交

---

### Task 1: 新增失败测试（TDD 红）

**Files:**
- Create: `test/lazy-fetch.test.ts`
- Test: `test/lazy-fetch.test.ts`

**Interfaces:**
- Consumes: `src/index.ts` 的默认导出（`(pi: ExtensionAPI) => Promise<void>`）；`src/auth.ts` 的 `OMNIROUTE_DEFAULT_BASE_URL`
- Produces: `test/lazy-fetch.test.ts` 中可复用的 `mockPi()` / `okResponse()` / `refreshCtx()` 辅助与 6 个用例；测试通过 `pi.registerProvider` 捕获 `capturedProvider: Provider<"openai-completions">`，供 Task 2 实现后验证

- [ ] **Step 1: 编写测试文件**

```typescript
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
```

- [ ] **Step 2: 运行测试确认预期失败**

Run: `npm test 2>&1 | grep -E "扩展加载期|pass|fail"`（或 `node --test --experimental-strip-types test/lazy-fetch.test.ts`）

Expected: 至少 "扩展加载期不发起任何 /models 请求" 失败（现状 `tryRegisterModels` 在入口执行时发起 fetch → callCount === 1）；其余测试用例通过（它们直接驱动 `refreshModels`，与启动期拉取无关）。记录失败信息。

- [ ] **Step 3: 提交红测试**

```bash
git add test/lazy-fetch.test.ts
git commit -m "test(lazy-fetch): add failing tests for startup fetch suppression"
```

---

### Task 2: 实现——删除启动期拉取（TDD 绿）

**Files:**
- Modify: `src/index.ts:74-76`（`pi.registerProvider(provider);` 后的 `await tryRegisterModels(...)` 调用）
- Modify: `src/index.ts:78-96`（文件末尾 `tryRegisterModels` 函数定义）
- Test: `test/lazy-fetch.test.ts`（Task 1 创建）

**Interfaces:**
- Consumes: Task 1 的 `test/lazy-fetch.test.ts`
- Produces: 删除后的 `src/index.ts`——入口函数仅 `registerProvider(provider)`；`getModels` / `refreshModels` / `toOmnirouteModel` 原样保留。`Provider<"openai-completions">` 的 `refreshModels` 仍为 `({ signal }) => Promise<void>`

- [ ] **Step 1: 删除启动期调用**

在 `src/index.ts` 中删除：

```typescript
  pi.registerProvider(provider);

  await tryRegisterModels(baseUrl, (fresh) => { models = fresh; });
}
```

替换为：

```typescript
  pi.registerProvider(provider);
}
```

- [ ] **Step 2: 删除 `tryRegisterModels` 函数定义**

在 `src/index.ts` 中删除文件末尾整个函数（含 5s 超时与 `console.warn` 兜底）：

```typescript
async function tryRegisterModels(
  baseUrl: string,
  onModels: (models: OmnirouteModel[]) => void,
): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(`${baseUrl}/models`, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { data } = (await res.json()) as { data: Array<{ id: string }> };
    onModels(data.map((m) => toOmnirouteModel(m, baseUrl)));
  } catch (err) {
    clearTimeout(timeout);
    console.warn(
      `[omniroute] OmniRoute unavailable at ${baseUrl}, skipping model registration: ${err}`,
    );
  }
}
```

- [ ] **Step 3: 验证无残留引用**

Run: `rg -n "tryRegisterModels|AbortController|setTimeout|console\.warn" src/index.ts`

Expected: 无输出（`src/index.ts` 中三者均已清除；`auth.ts` / `auth-credentials.ts` 的 `console.warn` 属其他模块，不查）

- [ ] **Step 4: 运行测试确认全绿**

Run: `npm test`

Expected: 全部通过（现有 `auth-credentials.test.ts` / `auth.test.ts` / `url.test.ts` + 新增 `lazy-fetch.test.ts` 的 6 个用例，包括 Task 1 时失败的那一个）

- [ ] **Step 5: 类型检查**

Run: `npm run typecheck`

Expected: 无错误（`tsc --noEmit`，tsconfig 覆盖 `src/**` 与 `test/**`）

- [ ] **Step 6: 提交**

```bash
git add src/index.ts
git commit -m "refactor(index): drop eager /models fetch on extension load"
```

---

### Task 3: 同步 tasks.md 并全量验证

**Files:**
- Modify: `openspec/changes/lazy-fetch-models-on-demand/tasks.md`（将原 2.3/2.4 手动验证升级为自动化测试任务）

**Interfaces:**
- Consumes: Task 1 的 `test/lazy-fetch.test.ts` 与 Task 2 的 `src/index.ts` 改动
- Produces: 与实现计划一致的可跟踪 OpenSpec 任务清单（`- [ ] X.Y` 复选框格式，供 `openspec-cn` apply 阶段解析）

- [ ] **Step 1: 重写 tasks.md**

将 `openspec/changes/lazy-fetch-models-on-demand/tasks.md` 内容替换为：

```markdown
## 1. 移除启动期模型拉取

- [ ] 1.1 删除 `src/index.ts` 中 `pi.registerProvider(provider)` 之后对 `tryRegisterModels(baseUrl, ...)` 的 `await` 调用
- [ ] 1.2 删除 `src/index.ts` 末尾 `tryRegisterModels` 整个函数定义（不再被任何地方引用）
- [ ] 1.3 保留 `provider.refreshModels({ signal })` 的实现：仍然 `fetch('${baseUrl}/models')`、解析 `data[]`、映射为 `OmnirouteModel[]`，失败时 `throw`

## 2. 自动化测试（覆盖 delta spec 验收场景）

- [ ] 2.1 新增 `test/lazy-fetch.test.ts`：mock fetch + mock `ExtensionAPI`（仅 `registerProvider`）+ `PI_AGENT_DIR` 空目录环境隔离
- [ ] 2.2 用例：扩展加载期 fetch 调用数为 0；注册后 `getModels()` 返回 `[]`
- [ ] 2.3 用例：`refreshModels` 成功填充缓存（id 映射、baseUrl 为默认值）；非 2xx 与网络错误时 reject 冒泡（未被 `console.warn` 吞）
- [ ] 2.4 用例：`refreshModels` 失败后保留旧列表，后续读取命中内存缓存

## 3. 验证

- [ ] 3.1 运行 `npm run typecheck`，确认 `src/index.ts` 与 `test/lazy-fetch.test.ts` 通过类型检查
- [ ] 3.2 运行 `npm test`，确认现有 auth / credentials / url 测试与新增 lazy-fetch 测试全部通过
```

- [ ] **Step 2: 全量验证**

Run: `npm run typecheck && npm test`

Expected: typecheck 无错误；全部测试通过（含 6 个 lazy-fetch 用例）

- [ ] **Step 3: 提交**

```bash
git add openspec/changes/lazy-fetch-models-on-demand/
git commit -m "docs(openspec): sync lazy-fetch tasks with automated test plan"
```

---

## 自审记录

**1. Spec 覆盖**（`specs/lazy-model-fetch/spec.md` 7 个场景 → 任务）：
- 扩展加载期无网络请求 → Task 1 用例 1 / Task 2
- provider 注册后缓存为空 → Task 1 用例 2
- refreshModels 成功拉取 → Task 1 用例 3
- refreshModels 非 2xx 错误冒泡 → Task 1 用例 4
- refreshModels 网络不可达抛错、未被 console.warn 静默 → Task 1 用例 5
- 首次切到 omniroute 触发拉取 → Task 2 删除启动期调用后由 pi 驱动（依赖 pi 行为，自动化覆盖用例 1/3，冒烟验证可选）
- 后续读取命中缓存 → Task 1 用例 6

**2. Placeholder 扫描**：无 TBD/TODO/占位步骤；每个代码步骤含完整实现。

**3. 类型一致性**：`refreshModels` 入参统一为 `RefreshModelsContext`（`refreshCtx()` 辅助）；`Provider<"openai-completions">`、`ExtensionAPI` mock 与 `src/index.ts` 中类型一致；`mock.method`/`callCount`/`mockImplementation` 已实测可用（Node 22）。

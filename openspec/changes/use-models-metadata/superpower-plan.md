---
change: use-models-metadata
design-doc: openspec/changes/use-models-metadata/superpower-design.md
base-ref: ed8d4b1e3a34292340363d356a7ec7efdd873bbf
---

# use-models-metadata 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: 使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 按任务实现本计划。步骤使用 `- [ ]` 复选框跟踪。

**Goal:** 让 `src/index.ts` 在解析 `/v1/models` 时优先使用条目中的元数据字段（`max_input_tokens` / `context_length` / `max_output_tokens` / `capabilities` / `input_modalities` / `name`）注册 Pi 模型，仅在字段缺失或非法时回退到现有默认值。

**Architecture:** 在 `src/index.ts` 内完成全部改动（不新增模块）：定义 `OmnirouteModelEntry` 显式条目类型、新增模块级助手 `pickInt` 做防御性取值、扩展 `toOmnirouteModel` 的映射。测试沿用 `test/lazy-fetch.test.ts` 的捕获 provider 通道模式（mock `registerProvider` → 调 `refreshModels` → 断言 `getModels()`），全部新用例落在 `test/models-metadata.test.ts`，TDD 先行。

**Tech Stack:** TypeScript 5.9（`tsc --noEmit` typecheck）、node:test + `node --experimental-strip-types`（`npm test`）、`@earendil-works/pi-ai`（`Model<"openai-completions">`、`ThinkingLevelMap`）。

## Global Constraints

- 只改 `src/index.ts` 与新增 `test/models-metadata.test.ts`；不新增模块、不导出内部函数
- `/models` 请求路径、响应解析（仅解构 `data`）、auth 流程完全不变
- 回退默认值固定：`contextWindow: 128000`、`maxTokens: 4096`、`reasoning: false`、`input: ["text"]`、`name: m.id`、`thinkingLevelMap: undefined`
- `pickInt` 守卫：`typeof v === "number" && Number.isFinite(v) && v > 0`，否则按缺失处理
- `reasoning` 严格 `=== true`；`capabilities` 整体缺失按全 false / 无视觉 / 无思考处理
- `input` 视觉证据：`capabilities.vision === true` **或** `Array.isArray(m.input_modalities) && m.input_modalities.includes("image")`，任一成立即 `["text","image"]`
- `name` 仅当 `typeof m.name === "string"` 时采用，否则回退 `m.id`
- `thinkingLevelMap` 仅当 `capabilities.thinking === true` 时设为完整映射表（含 `xhigh`/`max` → `"high"`），**不设置 `off` 键**
- 每任务结束必须通过 `npm run typecheck` 与 `npm test` 全绿后提交

---

## 文件结构

| 文件 | 职责 | 动作 |
| --- | --- | --- |
| `src/index.ts` | `OmnirouteModelEntry` 类型、`pickInt` 助手、`toOmnirouteModel` 映射、`refreshModels` 注解 | 修改（4 个任务的实现步骤） |
| `test/models-metadata.test.ts` | 全部新用例：contextWindow / maxTokens / reasoning / input / name / thinkingLevelMap 映射与回退 | 新建（Task 1-4 分步追加用例） |
| `test/lazy-fetch.test.ts` | 既有回归保护（`{ id }` 最小条目 + 默认值断言） | **零修改**，作为回归基线 |

**接口约定**（Task 间共享，实现者只看到自己的任务，凭此块学习相邻任务的名字与类型）：

```typescript
// src/index.ts 内（不导出）
interface OmnirouteModelEntry {
  id: string;
  name?: string;
  context_length?: number;
  max_input_tokens?: number;
  max_output_tokens?: number;
  capabilities?: {
    tool_calling?: boolean;
    reasoning?: boolean;
    thinking?: boolean;
    temperature?: boolean;
    vision?: boolean;
  };
  input_modalities?: string[];
}

function pickInt(...vs: Array<number | undefined>): number | undefined;

const THINKING_LEVEL_MAP = {
  minimal: "minimal", low: "low", medium: "medium",
  high: "high", xhigh: "high", max: "high",
} as const;
```

**任务 ↔ tasks.md 复选框映射**：Task 1 → 1.1/1.2/1.3/2.1/2.2/2.3 的 contextWindow 部分；Task 2 → 1.4/1.5/2.3 的 maxTokens+reasoning 部分；Task 3 → 1.6/1.7/2.3 的 input+name 部分、2.4；Task 4 → 1.8/2.5；Task 5 → 1.9/2.6/3.1/3.2。apply 阶段按 tasks.md 复选框逐项勾选。

---

### Task 1: contextWindow 映射（TDD 红→绿）

**Files:**
- Create: `test/models-metadata.test.ts`（脚手架 + 4 个 contextWindow 用例）
- Modify: `src/index.ts`（`OmnirouteModelEntry` + `pickInt` + `contextWindow` 行 + `refreshModels` 注解）
- Test: `npm test -- test/models-metadata.test.ts`、`npm run typecheck`

**Interfaces:**
- Consumes: 既有 `refreshModels({ signal })` → `getModels()` 通道；`mockPi()` / `refreshCtx()` 沿用 lazy-fetch 模式
- Produces: `refreshOnce(data)` 测试助手（单条目数组 → 刷新 → 返回模型数组）；`OmnirouteModelEntry`；`pickInt`

- [ ] **Step 1: 编写脚手架与失败测试**

新建 `test/models-metadata.test.ts`（完整内容，与 `test/lazy-fetch.test.ts` 同构）：

```typescript
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
```

- [ ] **Step 2: 运行测试验证红**

Run: `npm test -- test/models-metadata.test.ts`
Expected: 4 个用例中「1048576 优先」与「131072 回退」**失败**（当前实现恒为 128000）；「两者均缺失回退」与「非法值回退」通过（现状即是默认值）。红在两条优先用例上，符合 TDD 预期。

- [ ] **Step 3: 最小实现**

在 `src/index.ts` 中，在 `type OmnirouteModel = Model<"openai-completions">;` 之后新增类型与助手：

```typescript
interface OmnirouteModelEntry {
  id: string;
  name?: string;
  context_length?: number;
  max_input_tokens?: number;
  max_output_tokens?: number;
  capabilities?: {
    tool_calling?: boolean;
    reasoning?: boolean;
    thinking?: boolean;
    temperature?: boolean;
    vision?: boolean;
  };
  input_modalities?: string[];
}

function pickInt(...vs: Array<number | undefined>): number | undefined {
  for (const v of vs) {
    if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  }
  return undefined;
}
```

修改 `toOmnirouteModel` 签名与 `contextWindow`（其余字段保持现状）：

```typescript
function toOmnirouteModel(m: OmnirouteModelEntry, baseUrl: string): OmnirouteModel {
  const result: OmnirouteModel = {
    id: m.id,
    name: m.id,
    api: "openai-completions" as const,
    provider: "omniroute",
    baseUrl,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: pickInt(m.max_input_tokens, m.context_length) ?? 128000,
    maxTokens: 4096,
  };
  return result;
}
```

修改 `refreshModels` 的 `data` 注解：

```typescript
const { data } = (await res.json()) as { data: OmnirouteModelEntry[] };
```

- [ ] **Step 4: 运行测试验证绿**

Run: `npm test -- test/models-metadata.test.ts`
Expected: 4 个用例全部 PASS。

- [ ] **Step 5: 类型检查与全量回归**

Run: `npm run typecheck`
Expected: 无错误（`capabilities` 只读已知键，多余键在 JSON 解析时自然通过）。

Run: `npm test`
Expected: 全绿，含既有 `test/lazy-fetch.test.ts`（`{ id }` 条目走回退，零修改通过）。

- [ ] **Step 6: 提交**

```bash
git add test/models-metadata.test.ts src/index.ts
git commit -m "feat: map contextWindow from /v1/models metadata"
```

---

### Task 2: maxTokens 与 reasoning 映射（TDD 红→绿）

**Files:**
- Modify: `test/models-metadata.test.ts`（追加 5 个用例）
- Modify: `src/index.ts`（`maxTokens` 与 `reasoning` 两行）
- Test: `npm test -- test/models-metadata.test.ts`、`npm run typecheck`

**Interfaces:**
- Consumes: Task 1 的 `refreshOnce` / `Entry` / `pickInt` / `OmnirouteModelEntry`
- Produces: 无新符号；改变 `toOmnirouteModel` 的 `maxTokens` / `reasoning` 语义

- [ ] **Step 1: 追加失败测试**（追加到 `test/models-metadata.test.ts` 末尾）

```typescript
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
```

- [ ] **Step 2: 运行测试验证红**

Run: `npm test -- test/models-metadata.test.ts`
Expected: 「max_output_tokens 65536」与「reasoning: true」两条**失败**（当前分别为 4096 / false）；其余通过。

- [ ] **Step 3: 最小实现**

`src/index.ts` 的 `toOmnirouteModel` 中：

```typescript
reasoning: m.capabilities?.reasoning === true,
// ...
maxTokens: pickInt(m.max_output_tokens) ?? 4096,
```

- [ ] **Step 4: 运行测试验证绿**

Run: `npm test -- test/models-metadata.test.ts`
Expected: 9 个用例全部 PASS。

- [ ] **Step 5: 类型检查与全量回归**

Run: `npm run typecheck` 与 `npm test`
Expected: 全绿。

- [ ] **Step 6: 提交**

```bash
git add test/models-metadata.test.ts src/index.ts
git commit -m "feat: map maxTokens and reasoning from /v1/models"
```

---

### Task 3: input 视觉声明与 name 显示名称（TDD 红→绿）

**Files:**
- Modify: `test/models-metadata.test.ts`（追加 6 个用例）
- Modify: `src/index.ts`（`input` 与 `name` 两行）
- Test: `npm test -- test/models-metadata.test.ts`、`npm run typecheck`

**Interfaces:**
- Consumes: Task 1 的 `refreshOnce` / `Entry`
- Produces: 无新符号；改变 `toOmnirouteModel` 的 `input` / `name` 语义

- [ ] **Step 1: 追加失败测试**（追加到 `test/models-metadata.test.ts` 末尾）

```typescript
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
```

- [ ] **Step 2: 运行测试验证红**

Run: `npm test -- test/models-metadata.test.ts`
Expected: 「vision 为 true」「input_modalities 含 image」「name 存在」「name 非字符串」4 条**失败**（当前分别为 `["text"]` / `["text"]` / `m.id` / `m.id`）；「无视觉证据」「name 缺失」通过。

- [ ] **Step 3: 最小实现**

`src/index.ts` 的 `toOmnirouteModel` 中（`name` 行放在 `id` 之后，`input` 行替换现有 `["text"]`）：

```typescript
name: typeof m.name === "string" ? m.name : m.id,
// ...
input:
  m.capabilities?.vision === true || (Array.isArray(m.input_modalities) && m.input_modalities.includes("image"))
    ? ["text", "image"]
    : ["text"],
```

- [ ] **Step 4: 运行测试验证绿**

Run: `npm test -- test/models-metadata.test.ts`
Expected: 15 个用例全部 PASS。

- [ ] **Step 5: 类型检查与全量回归**

Run: `npm run typecheck` 与 `npm test`
Expected: 全绿。

- [ ] **Step 6: 提交**

```bash
git add test/models-metadata.test.ts src/index.ts
git commit -m "feat: declare vision input and display name from /v1/models"
```

---

### Task 4: thinkingLevelMap 思考等级映射（TDD 红→绿）

**Files:**
- Modify: `test/models-metadata.test.ts`（追加 3 个用例）
- Modify: `src/index.ts`（`THINKING_LEVEL_MAP` 常量 + `thinkingLevelMap` 行）
- Test: `npm test -- test/models-metadata.test.ts`、`npm run typecheck`

**Interfaces:**
- Consumes: Task 1 的 `refreshOnce` / `Entry`
- Produces: 模块常量 `THINKING_LEVEL_MAP`（测试引用断言，避免魔法字面量漂移）；`thinkingLevelMap` 字段语义

- [ ] **Step 1: 追加失败测试**（追加到 `test/models-metadata.test.ts` 末尾）

```typescript
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
```

- [ ] **Step 2: 运行测试验证红**

Run: `npm test -- test/models-metadata.test.ts`
Expected: 「thinking 为 true 时设置完整映射」**失败**（当前为 undefined）；其余两条通过。

- [ ] **Step 3: 最小实现**

`src/index.ts` 中，在 `pickInt` 之后、`toOmnirouteModel` 之前新增模块常量：

```typescript
const THINKING_LEVEL_MAP = {
  minimal: "minimal",
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "high",
  max: "high",
} as const;
```

`toOmnirouteModel` 返回值中新增一行（`reasoning` 之后）：

```typescript
thinkingLevelMap:
  m.capabilities?.thinking === true ? THINKING_LEVEL_MAP : undefined,
```

> 类型兼容说明：`as const` 对象键是 `ModelThinkingLevel` 的子集、值是可赋给 `string | null` 的字面量，满足 `ThinkingLevelMap = Partial<Record<ModelThinkingLevel, string | null>>`；`off` 键刻意不设置（pi 关闭思考时不发 `reasoning_effort`，见设计文档 §3.1）。

- [ ] **Step 4: 运行测试验证绿**

Run: `npm test -- test/models-metadata.test.ts`
Expected: 18 个用例全部 PASS。

- [ ] **Step 5: 类型检查与全量回归**

Run: `npm run typecheck` 与 `npm test`
Expected: 全绿。

- [ ] **Step 6: 提交**

```bash
git add test/models-metadata.test.ts src/index.ts
git commit -m "feat: map thinking capability to thinkingLevelMap"
```

---

### Task 5: 全量验证与回归收尾

**Files:**
- Verify: `test/lazy-fetch.test.ts`（零修改回归基线）
- Verify: `src/index.ts`（最终形态通读）
- Test: `npm run typecheck`、`npm test`

**Interfaces:**
- Consumes: Task 1-4 的全部产出
- Produces: 无代码产出；确认变更可交付

- [ ] **Step 1: 类型检查**

Run: `npm run typecheck`
Expected: `tsc --noEmit` 无错误退出。

- [ ] **Step 2: 全量测试**

Run: `npm test`
Expected: 全部测试文件（auth / lazy-fetch / models-metadata / tools-http / tools-search / tools-web-fetch / url / auth-credentials）全绿，`test/lazy-fetch.test.ts` 的 7 个用例未改动仍通过（`{ id }` 最小条目 + 默认值回退，作为「元数据缺失不回归」的回归保护）。

- [ ] **Step 3: 通读最终 `src/index.ts`**

逐行确认：`OmnirouteModelEntry` 只声明已消费键；`pickInt` 守卫 `typeof number && Number.isFinite && > 0`；`contextWindow`/`maxTokens` 回退链正确；`reasoning` 严格 `=== true`；`input` 双证据任一成立；`name` 非字符串回退；`thinkingLevelMap` 无 `off` 键；`/models` 请求与 `data` 解构未变。

- [ ] **Step 4: 手动冒烟（可选）**

Run: 对可达的本地 OmniRoute 实例执行一次模型刷新（如 `curl $OMNIROUTE_BASE_URL/models` 核验字段），确认注册模型显示真实上下文窗口、推理/视觉标志与显示名称。OmniRoute 不可达时以 Step 2 为准。

- [ ] **Step 5: 确认 tasks.md 进度并提交遗留**

按本计划完成情况勾选 `openspec/changes/use-models-metadata/tasks.md` 对应复选框（1.1-1.9 / 2.1-2.6 / 3.1-3.2），如实现过程中产生未提交改动：

```bash
git add openspec/changes/use-models-metadata/tasks.md
git commit -m "docs: update tasks.md progress for use-models-metadata"
```

---

## Self-Review（写毕自检）

**1. Spec 覆盖**（`specs/models-metadata/spec.md` 六大需求 → 任务）：

| 需求 | 任务 |
| --- | --- |
| contextWindow 三级回退（含非法值） | Task 1（4 用例覆盖优先/回退/默认/非法） |
| maxTokens（含缺失回退） | Task 2 |
| reasoning（含 capabilities 缺失） | Task 2 |
| input 视觉双证据 / 仅文本 | Task 3 |
| name（含非字符串回退） | Task 3 |
| thinkingLevelMap（含缺失不设置） | Task 4 |

边界矩阵（设计 §4）：#1 capabilities 缺失 → Task 2/3/4 的 `m3` 用例；#2 显式 false → reasoning 用例；#4 非法值 → Task 1；#7 非字符串 name → Task 3；#9 裸数组非目标 → 不改；#10 多余键 → `Entry` 开放类型。全部覆盖，无缺口。

**2. Placeholder 扫描**：所有步骤均含完整可执行代码与预期输出；无 "TBD"/"TODO"/"适当处理"类占位。

**3. 类型一致性**：`OmnirouteModelEntry` / `pickInt` / `THINKING_LEVEL_MAP` 在「文件结构」接口约定块统一定义，Task 1-4 引用名一致；`refreshOnce` 由 Task 1 定义、Task 2-4 复用；`Entry` 类型用于全部新用例。`thinkingLevelMap` 在 Task 4 中一次定义（`THINKING_LEVEL_MAP` 常量），无跨任务漂移。

**4. 回归保护**：`test/lazy-fetch.test.ts` 零修改；Task 1 Step 5 / Task 5 Step 2 均显式验证既有用例通过。

---

## 执行交接

计划已保存至 `openspec/changes/use-models-metadata/superpower-plan.md`。两种执行方式：

1. **Subagent-Driven（推荐）** — 每个任务派发独立 subagent，任务间双阶段评审，快速迭代
2. **Inline Execution** — 本会话内按 executing-plans 批量执行，带检查点评审

输入 `/opsx-sp-apply`（或 `superpowers:openspec-apply-change`）开始进入开发阶段。

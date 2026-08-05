# OmniRoute Pi Extension Phase 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pi Agent 接入 OmniRoute，注册为 OpenAI 兼容 provider，自动导入模型，优雅降级。

**Architecture:** 项目本身就是 pi extension（`pi -e .` 加载），入口 `src/index.ts`。扩展在启动时通过 async factory 注册 provider、注册 `refreshModels` 回调、尝试拉取模型列表（失败时 graceful degrade）。

**Tech Stack:** TypeScript, `@earendil-works/pi-coding-agent`, `@sinclair/typebox`

## Global Constraints

- `baseUrl` 默认值：`http://localhost:20128/api/v1`（`/api/v1` 前缀必须）
- `cost` 类型必须是对象：`{ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }`（不是数字）
- `input: ["text"]`（保守策略，不假设多模态）
- `reasoning: false`、`contextWindow: 128000`、`maxTokens: 4096`
- `apiKey` 动态策略：env 存在 → `"local"`，缺失 → `"$OMNIROUTE_API_KEY"`
- Provider ID：`"omniroute"`
- `api`：`"openai-completions"`
- `fetch` 超时：5 秒（`AbortController` + `setTimeout`）

---
change: init-pi-extension
design-doc: openspec/changes/init-pi-extension/superpower-design.md
---

## 任务总览

| # | 任务 | 文件变更 | 依赖 |
|---|---|---|---|
| 1 | 依赖安装 | `package.json` 修改 | 无 |
| 2 | 验证 pi 入口发现 | 无（仅测试） | 1 |
| 3 | 创建扩展入口 | `src/index.ts` 新建 | 1, 2 |
| 4 | 完整实现 | `src/index.ts` 覆盖 | 3 |
| 5 | 手动验证测试 | 无（仅测试） | 4 |

---

### Task 1: 安装 npm 依赖

**文件：**
- Modify: `package.json`

**步骤：**

- [ ] **Step 1: 更新 package.json 添加依赖**

打开 `package.json`，将内容替换为：

```json
{
  "name": "pi-provider-omniroute",
  "version": "1.0.0",
  "description": "OmniRoute OpenAI-compatible provider for Pi Agent",
  "type": "module",
  "main": "index.js",
  "scripts": {
    "test": "echo \"Error: no test specified\" && exit 1"
  },
  "author": "",
  "license": "ISC",
  "dependencies": {
    "@earendil-works/pi-coding-agent": "latest",
    "@sinclair/typebox": "latest"
  }
}
```

> **注意**：`"type": "module"` 确保 Node.js 按 ESM 模式解析 `import` 语句。若 pi extension 加载器支持 CommonJS 可省略，但设计文档中使用 ESM `import`，因此需显式声明。

- [ ] **Step 2: 安装依赖**

Run: `npm install`
Expected: 依赖下载完成，无报错

---

### Task 2: 验证 pi 入口文件发现机制（前置验证）

**文件：**
- 无文件变更（仅测试）

**步骤：**

- [ ] **Step 1: 确认 pi 是否支持 `src/index.ts` 入口**

先尝试直接加载（pi 可能已支持 `src/index.ts`）：

Run: `pi -e . --help 2>&1 | head -20`
或查看 pi 文档中关于 `-e` 加载的入口文件约定。

- [ ] **Step 2: 根据验证结果决定入口路径**

**情况 A**：pi 支持 `src/index.ts` 作为入口
→ 无需额外操作，继续 Task 3

**情况 B**：pi 只识别根目录 `index.ts`（或 `.ts` 文件）
→ 在项目根目录创建 `index.ts`，内容为：

```typescript
// index.ts — 根目录入口，re-export src/index.ts
export { default } from "./src/index.js";
```

> ⚠️ 注意：根目录 `index.ts` 用 `.js` 后缀（ESM 输出），因为 Node.js ESM 中 re-export 必须用实际文件扩展名或通过 package.json 的 exports 映射。如果 pi 不支持 `.js` 后缀，改用：

```typescript
// index.ts — 根目录入口，re-export（兼容 pi 加载器）
import extension from "./src/index.js";
export default extension;
```

**验证方式**：运行 `pi -e . --version` 或 `pi -e . --list-models` 看是否报错"找不到入口文件"。

---

### Task 3: 创建扩展骨架（只含类型导入和常量）

**文件：**
- Create: `src/index.ts`

**接口：**
- Produces: `MODEL_DEFAULTS` 常量（供 Task 4 使用）

**步骤：**

- [ ] **Step 1: 创建 src 目录和 index.ts 骨架**

创建 `src/index.ts`，内容为：

```typescript
// src/index.ts — pi extension 入口（骨架）
import type { ExtensionAPI, ProviderModelConfig } from "@earendil-works/pi-coding-agent";

const DEFAULT_BASE_URL = "http://localhost:20128/api/v1";

const MODEL_DEFAULTS: Omit<ProviderModelConfig, "id" | "name"> = {
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128000,
  maxTokens: 4096,
};

export default async function (pi: ExtensionAPI) {
  // TODO: 实现完整逻辑（Task 4）
  console.log("[omniroute] Extension loaded (skeleton)");
}
```

- [ ] **Step 2: 验证骨架可被 pi 加载**

Run: `pi -e . --list-models 2>&1`
Expected: 看到 `[omniroute] Extension loaded (skeleton)` 输出，无 TypeScript/import 报错

- [ ] **Step 3: 确认 pi 对 MODEL_DEFAULTS 类型的处理**

检查 `@earendil-works/pi-coding-agent` 是否导出 `ProviderModelConfig` 类型（预期在 `ExtensionAPI` 的 import 中已包含）。如果 TypeScript 编译报错，检查实际包导出名称。

---

### Task 4: 完整实现 src/index.ts

**文件：**
- Modify: `src/index.ts`（覆盖 Task 3 的骨架）

**接口：**
- Consumes: `MODEL_DEFAULTS`（Task 3 定义的常量）
- Produces: `tryRegisterModels` 函数

**步骤：**

- [ ] **Step 1: 用完整实现覆盖 src/index.ts**

用以下内容完全替换 `src/index.ts`：

```typescript
// src/index.ts — pi extension 入口
import type { ExtensionAPI, ProviderModelConfig } from "@earendil-works/pi-coding-agent";

const DEFAULT_BASE_URL = "http://localhost:20128/api/v1";

const MODEL_DEFAULTS: Omit<ProviderModelConfig, "id" | "name"> = {
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128000,
  maxTokens: 4096,
};

export default async function (pi: ExtensionAPI) {
  const apiKey = process.env.OMNIROUTE_API_KEY;
  const baseUrl = process.env.OMNIROUTE_BASE_URL ?? DEFAULT_BASE_URL;

  // 注册 provider（立即可见，models 初始为空）
  pi.registerProvider("omniroute", {
    baseUrl,
    // 动态认证策略：env 存在用 "local" 占位（无认证），缺失则引用 env
    apiKey: apiKey ? "local" : "$OMNIROUTE_API_KEY",
    api: "openai-completions",
    models: [],
    // 支持运行时刷新：pi update --models
    async refreshModels({ signal }) {
      const res = await fetch(`${baseUrl}/models`, { signal });
      if (!res.ok) throw new Error(`OmniRoute /models failed: ${res.status}`);
      const { data } = await res.json() as { data: Array<{ id: string }> };
      return data.map(
        (m): ProviderModelConfig => ({ id: m.id, name: m.id, ...MODEL_DEFAULTS }),
      );
    },
  });

  // 启动时尝试拉取模型（优雅降级）
  await tryRegisterModels(baseUrl, pi);
}

async function tryRegisterModels(baseUrl: string, pi: ExtensionAPI): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(`${baseUrl}/models`, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { data } = await res.json() as { data: Array<{ id: string }> };
    const models: ProviderModelConfig[] = data.map(
      (m) => ({ id: m.id, name: m.id, ...MODEL_DEFAULTS }),
    );
    // 用真实模型替换初始空列表
    pi.registerProvider("omniroute", { models });
  } catch (err) {
    clearTimeout(timeout);
    console.warn(`[omniroute] OmniRoute unavailable, skipping model registration: ${err}`);
  }
}
```

- [ ] **Step 2: TypeScript 类型检查**

Run: `npx tsc --noEmit src/index.ts 2>&1`
Expected: 无类型错误（`ProviderModelConfig`、`ExtensionAPI` 导入正确）

> 如果 `@earendil-works/pi-coding-agent` 包中 `ProviderModelConfig` 不是命名导出，参考包的实际导出调整 import。查看方式：`cat node_modules/@earendil-works/pi-coding-agent/dist/index.d.ts | grep "ProviderModelConfig"`

- [ ] **Step 3: 验证扩展加载（无 OmniRoute）**

Run: `pi -e . --list-models 2>&1`
Expected: 
- 输出中可见 `omniroute` provider
- 看到 `[omniroute] OmniRoute unavailable, skipping model registration: ...` 警告（OmniRoute 未启动时）
- 无 TypeScript 运行时错误

---

### Task 5: 手动验证测试矩阵

**文件：**
- 无文件变更（仅测试）

**步骤（按顺序执行）：**

- [ ] **Step 1: T3 — OmniRoute 未启动**

Run: `pi -e . --list-models 2>&1`
Expected: 
- `omniroute` provider 存在（名称可见）
- 无 OmniRoute 模型（列表为空或无 `omniroute/` 前缀模型）
- 包含 `[omniroute] OmniRoute unavailable` 警告

- [ ] **Step 2: 启动 OmniRoute 后测试**

确保 OmniRoute 运行在 `localhost:20128`。

Run: `curl http://localhost:20128/api/v1/models` 验证 OmniRoute 可访问。

- [ ] **Step 3: T1 — OmniRoute 运行（无 API key）**

Run: `unset OMNIROUTE_API_KEY && pi -e . --list-models 2>&1`
Expected:
- 列出 `omniroute/` 前缀的模型
- 无 `OMNIROUTE_API_KEY` 时使用 `"local"` 占位，OmniRoute 无认证模式应正常返回模型

- [ ] **Step 4: T2 — OmniRoute 运行 + API key 已设置**

Run: `OMNIROUTE_API_KEY=xxx pi -e . --list-models 2>&1`
Expected: 同 T1，apiKey 为 "local" 占位，OmniRoute 忽略认证头正常返回

- [ ] **Step 5: T7 — refreshModels 运行时刷新**

Run: `pi -e . update --models 2>&1 && pi -e . --list-models 2>&1`
Expected: 模型列表刷新（与启动时一致）

- [ ] **Step 6: T4 — 普通对话（非流式）**

Run: `OMNIROUTE_API_KEY=xxx pi -e .` 启动交互 session，发送简单消息
Expected: 正常响应（非流式）

- [ ] **Step 7: T5 — 流式对话（SSE）**

在 Pi session 中发送需要较长回复的消息
Expected: 流式输出正常

- [ ] **Step 8: T8 — 认证失败（401/403）**

配置 OmniRoute 要求认证头，设置错误的 `OMNIROUTE_API_KEY`：
Run: `OMNIROUTE_API_KEY=wrong_key pi -e . --list-models 2>&1`
Expected: 
- `omniroute` provider 存在
- 无模型
- 包含认证失败警告

---

## 自检清单

完成 Task 4 后，运行以下检查：

1. **Spec 覆盖**：对照 `superpower-design.md` 和 `tasks.md`，每个决策点都有对应实现？
   - ✅ D-1 扩展加载（`pi -e .`）
   - ✅ D-2 动态认证策略（env 存在 → "local"，缺失 → "$OMNIROUTE_API_KEY"）
   - ✅ D-3 工厂内 fetch + refreshModels 回调
   - ✅ D-4 仍注册 provider（空模型）+ console.warn
   - ✅ D-5 模型默认值（cost 对象、contextWindow、maxTokens、input、reasoning）
   - ✅ D-6 5 秒 fetch 超时（AbortController）

2. **占位符扫描**：搜索以下模式，确保无残留：
   - `TBD`、`TODO`、`FIXME`
   - `// 实现` 类型的注释
   - 空函数体（只有 `// TODO` 的函数）

3. **类型一致性**：
   - `MODEL_DEFAULTS` 中 `cost` 是对象（非数字）
   - `refreshModels` 返回 `ProviderModelConfig[]`
   - `apiKey` 策略与决策一致

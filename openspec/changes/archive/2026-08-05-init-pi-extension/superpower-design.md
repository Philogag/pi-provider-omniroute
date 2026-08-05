# OmniRoute Pi Extension Phase 1 — Superpower Design

> 本文档基于 OpenSpec 变更 `init-pi-extension` 的 proposal/design/specs 进行深度技术设计。
> OpenSpec 是需求事实源，本文不做需求重写，仅做实现方案、技术风险和测试策略的细化。

## 上游需求（来自 OpenSpec，不重写）

**目标**：Pi Agent 接入 OmniRoute（本地 AI API 代理路由器），注册为 OpenAI 兼容 provider，自动导入可用模型，优雅降级。

**架构约束**：
- `baseUrl: http://localhost:20128/api/v1`（`/api/v1` 前缀由 OmniRoute 架构决定）
- OmniRoute `/api/v1/models` 仅返回 `id`、`object`、`owned_by`，无 contextWindow/cost/maxTokens
- 使用 `@earendil-works/pi-coding-agent` + `@sinclair/typebox`

**任务边界**：Phase 1 仅实现接入，不做管理工具封装。

---

## 架构概览

```
src/
└── index.ts          # async 工厂函数入口

根 package.json
└── 添加 @earendil-works/pi-coding-agent, @sinclair/typebox
```

运行方式：`pi -e .`（项目根目录本身就是 extension，pi 加载 `src/index.ts` 作为入口）。

### 启动流程

```
pi -e . 启动
  └─ 加载当前目录，入口为 src/index.ts
        └─ 调用 async factory(pi)
              ├─ 读取 $OMNIROUTE_API_KEY, $OMNIROUTE_BASE_URL
              ├─ resolve apiKey 策略（见 §认证策略）
              ├─ registerProvider("omniroute", {
              │    baseUrl, apiKey, api: "openai-completions",
              │    models: [],            ← 初始空
              │    refreshModels,         ← 支持运行时刷新
              │   })
              │    (立即执行，provider 在启动完成前可见)
              ├─ 启动时拉取模型（try-catch 包装）
              │    成功 → 用真实模型列表重新调用 registerProvider
              │    失败 → console.warn + 继续（provider 保持空模型）
              └─ factory await 完成，pi 继续启动
```

---

## 核心设计决策

### D-1：扩展加载

通过 `pi -e .` 将项目根目录作为 extension 加载，pi 自动识别 `src/index.ts` 为入口。

来源依据：`extensions.md` 文档明确支持 `-e` / `--extension` 指定本地路径作为 extension（用于快速测试和项目级加载）。

> ⚠️ **验证点**：`pi -e .` 是否自动识别 `src/index.ts` 而非仅识别根目录 `index.ts`？若不识别，考虑在根目录放置 `index.ts` re-export `src/index.ts`，或改用根目录 `index.ts` 直接作为入口。

### D-2：认证策略

采用**动态选择**策略：

| 条件 | `apiKey` 值 | 行为 |
|---|---|---|
| `$OMNIROUTE_API_KEY` 存在 | `"local"`（字面占位） | 无认证模式，本地 OmniRoute 通常忽略认证头 |
| `$OMNIROUTE_API_KEY` 缺失 | `"$OMNIROUTE_API_KEY"`（pi env 引用） | 请求时解析；缺失则 pi 抛清晰错误 |

**为什么不用 `authHeader: true`**：`openai-completions` API 通过 OpenAI SDK 自动发送 `Authorization: Bearer`，`authHeader` 为显式开关（默认 false），无需设置。

来源依据：`openai-completions.js` 中 `getClientApiKey` 确认 SDK 处理 Bearer 认证；`authHeader` 仅在需要自定义 header 时使用。

### D-3：模型注册时机——双重策略

采用**工厂内 fetch + `refreshModels` 回调**两者结合：

1. **工厂内 fetch**（启动时一次性拉取）：
   - `pi.registerProvider` 先注册带空模型的 provider（立即生效）
   - 随后 `fetch("${baseUrl}/models")` 拉取真实列表
   - 成功则重新 `registerProvider` 替换为真实模型
   - 失败则 `console.warn` 后继续

2. **`refreshModels` 回调**（运行时刷新）：
   - 支持 `pi update --models` 命令重新拉取模型目录
   - 当 `refreshModels` 返回时，pi 自动用新列表替换 extension-provided models
   - 对 live server（如本地 OmniRoute 动态增减模型）场景友好

来源依据：`extensions.md` llama.cpp 示例展示了 `refreshModels` 的标准用法。

### D-4：OmniRoute 不可用时的降级策略

**策略：仍注册 provider（空模型）**。

- Provider 名称 `"omniroute"` 在 Pi 中可见
- 模型列表为空，`pi --list-models` 不显示 OmniRoute 模型
- OmniRoute 恢复后用户可运行 `pi update --models` 刷新模型
- 打印 `console.warn` 告知用户降级原因

**为什么选 A 而非跳过 provider 注册**：provider 注册本身不依赖网络；保留 provider 让用户在 OmniRoute 恢复后能感知到它的存在；跳过注册则用户完全无法察觉 OmniRoute 曾被尝试加载。

### D-5：模型默认值

| 字段 | 值 | 说明 |
|---|---|---|
| `reasoning` | `false` | 保守关闭；思考能力需后续按模型配置（Phase 4） |
| `input` | `["text"]` | 保守策略；不假设多模态，避免幻觉图像调用 |
| `cost` | `{ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }` | 免费本地模型 |
| `contextWindow` | `128000` | 大部分现代模型保守默认值 |
| `maxTokens` | `4096` | 保守，适合大多数部署 |

**注意**：`cost` 必须是对象而非数字（类型是 `ModelCost`），`design.md` 和 `spec.md` 中的 `cost: 0` 与 API 类型不兼容，实现时必须映射为全 0 对象。

### D-6：网络请求

- `fetch` 携带 5 秒超时（`AbortController` + `setTimeout`）
- 捕获 `TypeError`（网络错误）、非 2xx HTTP 状态
- 不重试（启动时一次失败足够，降级信息已告知用户）

---

## 实现方案

### 文件结构

```
src/
└── index.ts          # 扩展入口（async 工厂函数）

根目录 package.json   # 添加依赖
```

### src/index.ts 完整实现

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

### 根 package.json 变更

```diff
+  "dependencies": {
+    "@earendil-works/pi-coding-agent": "^...",
+    "@sinclair/typebox": "^..."
+  }
```

---

## 技术风险与缓解

| 风险 | 概率 | 影响 | 缓解措施 |
|---|---|---|---|
| `contextWindow: 128000` 对小上下文模型导致 prompt 浪费 | 中 | 低 | Phase 4 从 OmniRoute 管理端点补全真实值 |
| `input: ["text"]` 对多模态模型不准确 | 中 | 中 | Phase 4 补全；保守策略避免幻觉图像调用 |
| `$OMNIROUTE_API_KEY` 设为 "local" 但远程 OmniRoute 实际需要认证 | 低 | 高 | 当前针对本地代理场景；Phase 2 管理工具可考虑配置化 |
| 5 秒超时对慢网络不够 | 低 | 低 | 可配置化（Phase 2）；当前够用 |
| `pi -e .` 对 `src/index.ts` 的入口识别失败 | 低 | 高 | 如 `pi -e .` 只识别根目录 `index.ts`，在根目录放 `index.ts` re-export `src/index.ts` 作为 fallback |

---

## 测试策略

### 手动测试矩阵

| # | 场景 | 验证方式 | 预期结果 |
|---|---|---|---|
| T1 | OmniRoute 运行 + `$OMNIROUTE_API_KEY` 已设置 | `pi -e . --list-models` | 列出 OmniRoute 模型（`omniroute/*`） |
| T2 | OmniRoute 运行 + `$OMNIROUTE_API_KEY` 未设置 | `pi -e . --list-models` + 终端输出 | 列出模型 + console.warn 提示 env 缺失 |
| T3 | OmniRoute 未启动 | `pi -e . --list-models` + 终端输出 | provider 存在（`omniroute`），无模型 + console.warn |
| T4 | 普通对话（非流式） | `pi -e .` 启动 session 并对话 | 正常响应 |
| T5 | 流式对话（SSE） | `pi -e .` 启动 session 并对话 | 正常流式输出 |
| T6 | OpenAI 工具调用透传 | 使用含 tools 的对话 | 工具调用正常透传到 OmniRoute |
| T7 | `pi -e . update --models` | 运行命令后 `pi -e . --list-models` | 模型列表刷新 |
| T8 | 认证失败（401/403） | OmniRoute 设置错误 key | console.warn + provider 保持空模型 |

### 边界条件

1. **OmniRoute 返回空模型列表**：`data: []` → provider 注册成功但无模型，不报错
2. **OmniRoute 返回非标准字段**：解析时只取 `id`，其他字段静默忽略
3. **fetch 超时**：`AbortError` 被 catch，视为不可用
4. **pi 启动时 OmniRoute 不可用，后续恢复**：用户运行 `pi update --models` 刷新
5. **并发调用 factory**：pi 串行加载扩展，无并发问题

---

## 实现任务（与 OpenSpec tasks.md 对应）

本设计不创建独立任务列表，实现任务以 OpenSpec `tasks.md` 为准。

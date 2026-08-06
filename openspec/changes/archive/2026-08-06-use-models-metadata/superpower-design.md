# 深度技术设计：use-models-metadata

> 本设计文档基于 OpenSpec 需求（`proposal.md` / `design.md` / `specs/models-metadata/spec.md`）做实现层面的细化。需求本身以 OpenSpec 为事实源，本文件不重新定义需求；Brainstorm 中确认的两项新决策（`name ?? id`、`thinkingLevelMap` 基础映射）已回写 delta spec 与 design.md。

## 1. 概述

`src/index.ts` 的 `toOmnirouteModel` 目前把 `/v1/models` 的每个条目硬编码映射为固定元数据（`contextWindow: 128000` / `maxTokens: 4096` / `reasoning: false` / `input: ["text"]` / `name: m.id`）。本变更改为**优先使用响应中的额外字段**，仅在缺失或非法时回退：

| Pi `Model` 字段 | 数据源（优先 → 回退） |
| --- | --- |
| `contextWindow` | `max_input_tokens` → `context_length` → `128000` |
| `maxTokens` | `max_output_tokens` → `4096` |
| `reasoning` | `capabilities.reasoning`（严格 `=== true`）→ `false` |
| `input` | `capabilities.vision === true` 或 `input_modalities` 含 `"image"` → `["text","image"]`；否则 `["text"]` |
| `name` | `name`（非字符串视为缺失）→ `id` |
| `thinkingLevelMap` | `capabilities.thinking === true` → 完整映射表；否则 `undefined` |

不新增模块、不改 `/models` 请求路径与 auth 流程、不消费 `pricing`/`effort_tiers`（非目标）。

## 2. 实现方案（src/index.ts）

### 2.1 条目类型显式化

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
```

`refreshModels` 的解析处：

```typescript
const { data } = (await res.json()) as { data: OmnirouteModelEntry[] };
models = data.map((m) => toOmnirouteModel(m, baseUrl));
```

> `capabilities` 快照间键集合不统一（`effort_tiers`、`supportsThinking` 等私有键可能出现）。类型只声明**已消费**的键；多余键在 JSON 解析时自然通过，不构成类型错误。`pickInt` 的 `typeof v === "number"` 守卫使 `null`/字符串等运行时脏值安全。

### 2.2 防御性取值 `pickInt`

```typescript
function pickInt(...vs: Array<number | undefined>): number | undefined {
  for (const v of vs) {
    if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  }
  return undefined;
}
```

覆盖的非法形态：`null`、字符串、`NaN`、`Infinity`、`0`、负数。快照实测 `context_length` 最小合法值 4100、最大 2 000 000，`max_output_tokens` 最小 1000、最大 1 048 576 —— 均通过守卫，不做额外钳制（跟随服务端真实上限是正确行为）。

### 2.3 映射函数

```typescript
const THINKING_LEVEL_MAP = {
  minimal: "minimal", low: "low", medium: "medium",
  high: "high", xhigh: "high", max: "high",
} as const;

function toOmnirouteModel(m: OmnirouteModelEntry, baseUrl: string): OmnirouteModel {
  return {
    id: m.id,
    name: typeof m.name === "string" ? m.name : m.id,
    api: "openai-completions" as const,
    provider: "omniroute",
    baseUrl,
    reasoning: m.capabilities?.reasoning === true,
    thinkingLevelMap: m.capabilities?.thinking === true ? THINKING_LEVEL_MAP : undefined,
    input: m.capabilities?.vision === true || m.input_modalities?.includes("image")
      ? ["text", "image"] : ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: pickInt(m.max_input_tokens, m.context_length) ?? 128000,
    maxTokens: pickInt(m.max_output_tokens) ?? 4096,
  };
}
```

`THINKING_LEVEL_MAP` 提为模块常量：测试可直接引用断言，避免魔法字面量漂移。`as const` 对象与 `ThinkingLevelMap`（`Partial<Record<ModelThinkingLevel, string | null>>`）结构兼容：键是 `ModelThinkingLevel` 的子集，值类型为字符串字面量（可赋给 `string | null`）。

## 3. pi-ai 契约对齐（为什么 D8 的映射表是必需的）

追踪 `@earendil-works/pi-ai` 消费路径，确认各字段的运行时语义：

### 3.1 `reasoning` / `thinkingLevelMap`

`dist/models.js` `getSupportedThinkingLevels`：

```typescript
if (!model.reasoning) return ["off"];              // reasoning=false → 无思考等级
if (mapped === null) return false;                  // null → 不支持
if (level === "xhigh" || level === "max") return mapped !== undefined;  // xhigh/max 必须有显式映射
```

`dist/api/openai-completions.js`（默认 `reasoningFormat: "openai"`、`supportsReasoningEffort` 自动探测）：

```typescript
params.reasoning_effort = model.thinkingLevelMap?.[options.reasoningEffort] ?? options.reasoningEffort;
```

**关键结论**：
- 未映射的 pi 等级**原样透传**为 `reasoning_effort`。pi 等级包含 `"xhigh"`/`"max"`，而 `reasoning_effort` 合法取值仅 `minimal`/`low`/`medium`/`high` —— 无映射时用户选择 xhigh/max 会直接 400
- 因此 D8 映射表不只是"锦上添花"：它把 `xhigh`/`max` 收敛到 `high`，修复潜在运行期错误，同时让 `getSupportedThinkingLevels` 把这两个等级标记为可用（映射为字符串而非 `undefined`）
- `minimal → "minimal"` 为恒等映射：无映射时 pi 同样透传 `"minimal"`，行为无回归
- `off` 键刻意不设置：关闭思考时 pi 不发 `reasoning_effort`（`model.thinkingLevelMap?.off` 为 undefined 即跳过），避免强制下发 `"none"` 之类的无效值

### 3.2 `contextWindow` / `maxTokens`

Pi 用 `contextWindow` 做输入 token 预算与截断、`maxTokens` 做 `max_completion_tokens` 上限。取 `max_input_tokens` 优先正是因为它是**输入侧预算**的精确值；`context_length` 语义随厂商而异（部分含输出预留），仅作次级来源。

### 3.3 `input` 视觉声明

`input: ["text","image"]` 使 Pi 向 OpenAI 兼容接口发送图片 content 块。视觉证据两选一：`capabilities.vision === true`（快照 2 出现）或 `input_modalities` 含 `"image"`（快照 2 出现）；快照 1 两者皆无 → 保持 `["text"]`，无回归。

## 4. 边界条件矩阵

| # | 边界 | 行为 | 依据 |
| --- | --- | --- | --- |
| 1 | `capabilities` 整体缺失 | reasoning/vision/thinking 全按缺失 → false/undefined/text-only | D3/D8/测试场景 |
| 2 | `capabilities.reasoning` 显式 `false` | `reasoning: false`（17 条快照条目如此） | D3 |
| 3 | `capabilities.thinking: true` 但 `reasoning: false` | 映射表被设置但 pi 因 `reasoning=false` 仅暴露 `["off"]`，无害 | 3.1 契约 |
| 4 | `context_length` / `max_input_tokens` 为 `0`/负数/字符串/`null` | `pickInt` 拦截 → 回退链下一级 | D5 |
| 5 | 两窗口字段皆缺失 | `contextWindow: 128000`（现状不变） | D1 |
| 6 | `max_output_tokens` 极小（如 1000） | 如实采用；旧默认 4096 反而请求越界 | D2 |
| 7 | `name` 为非字符串（数字等） | 回退 `id` | D7 |
| 8 | `input_modalities` 含 `"image"` 且 `capabilities.vision` 为 false | 仍声明视觉（任一证据成立） | D4 |
| 9 | `/models` 返回 `{ data: [...] }` 或裸数组 | 保持现状仅解构 `data`（裸数组非本变更目标，见非目标） | 不变式 |
| 10 | 快照间 `capabilities` 键集合不一致 | 只读已知键，未知键静默忽略 | 2.1 |

## 5. 测试策略（test/models-metadata.test.ts）

沿用 `test/lazy-fetch.test.ts` 的 provider 通道模式（捕获 `registerProvider` → 调 `refreshModels({ signal })` → 断言 `getModels()`），无需导出内部函数。环境隔离：`PI_AGENT_DIR` → 空临时目录、`OMNIROUTE_BASE_URL` → delete、`fetch` → `mock.method`、`after()` 恢复。

### 5.1 用例 ↔ delta spec 场景映射

| 用例 | 断言 | 覆盖场景 |
| --- | --- | --- |
| max_input_tokens 1048576 + context_length 2000000 | contextWindow = 1048576 | 存在 max_input_tokens 时使用该值 |
| 仅 context_length 131072 | contextWindow = 131072 | max_input_tokens 缺失时用 context_length |
| 仅 `{ id }` | contextWindow = 128000 | 两者均缺失回退 |
| max_input_tokens: 0 / context_length: -1 / 字符串 | contextWindow = 128000 | 非法值按缺失 |
| max_output_tokens: 65536 | maxTokens = 65536 | 存在时使用 |
| 无 max_output_tokens | maxTokens = 4096 | 缺失回退 |
| capabilities.reasoning: true | reasoning = true | 启用推理 |
| capabilities 无 reasoning / 整体缺失 | reasoning = false | 禁用推理 |
| capabilities.vision: true | input = ["text","image"] | vision 声明 |
| input_modalities: ["text","image"] | input = ["text","image"] | modalities 声明 |
| 无视觉证据 | input = ["text"] | 仅文本 |
| name: "GPT-4o" | name = "GPT-4o" | name 存在 |
| 无 name / name 非字符串 | name = id | name 回退 |
| capabilities.thinking: true | thinkingLevelMap 深等于映射表 | 完整映射 |
| capabilities 无 thinking | thinkingLevelMap === undefined | 不设置 |

### 5.2 TDD 节奏与回归保护

- 测试先行：用例全部落在新文件 `test/models-metadata.test.ts`，在实现前红、实现后绿
- 既有 `test/lazy-fetch.test.ts` 用 `{ id }` 最小条目 + 默认值断言（id/baseUrl/长度），与回退行为正交 → 预期**零修改**通过，作为"元数据缺失不回归"的回归保护
- 收尾 `npm run typecheck` + `npm test` 全绿

## 6. 技术风险与权衡

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| 个别模型 `context_length` 虚标过大 | Pi 输入预算过乐观，超限被服务端截断 | 优先 `max_input_tokens`（更保守）；截断以实际请求结果为准 |
| `reasoning_effort: "minimal"` 对部分模型非法（较新取值） | 选 minimal 时 400 | 与现状透传行为一致，无回归；用户可改选 low/medium/high |
| `reasoning: true` 使 Pi 发送 `reasoning_effort`，个别路由模型忽略/拒绝 | 思考参数无效 | OpenAI 兼容接口通常忽略未知参数；Pi 侧可手动关闭 thinking |
| 视觉声明与实际不符 | 图片消息被路由拒绝 | 仅跟随 OmniRoute 数据（`vision` / `input_modalities`），不自行推断 |
| `supportsReasoningEffort` 由 baseUrl 自动探测（本地 localhost 默认开启） | 探测结果影响是否下发 `reasoning_effort` | 探测逻辑在 pi-ai，非本变更可控；映射表仅在开启时生效，双向下安全 |
| `max_output_tokens` 缺失 276/546 的模型输出上限被低估（4096） | 长输出截断 | 用户已决策保持 4096（保守、无越界）；服务端补齐字段后自动解除 |

## 7. 开放问题 / 后续

- `capabilities.effort_tiers` / `supportsThinking` 细粒度 tier → `thinkingLevelMap` 的逐模型校准（非目标，独立变更）
- `pricing` 字段 → Pi `cost`（非目标，OmniRoute 计费在路由层）
- `/models` 裸数组响应加固（非目标，行为不变式）

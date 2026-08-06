## 上下文

`src/index.ts` 的 `toOmnirouteModel` 目前把 `/v1/models` 返回的每个条目都映射为固定元数据：

```typescript
const result: OmnirouteModel = {
  id: m.id, name: m.id, api: "openai-completions", provider: "omniroute", baseUrl,
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128000,
  maxTokens: 4096,
};
```

`refreshModels` 的类型注解为 `Array<{ id: string }>`，丢弃了响应中已有的额外字段：

- `context_length`（数字，实测快照 546 条目中仅 8 条缺失）
- `max_input_tokens`（数字，快照中 388 条缺失）
- `max_output_tokens`（数字，快照中 276 条缺失）
- `capabilities`（布尔字典，键不固定：`reasoning`、`tool_calling`、`thinking`、`temperature`、`vision`、`effort_tiers`、`supportsThinking` 均可能出现）
- `input_modalities`（字符串数组，可含 `"image"`）

Pi 的 `Model` 类型要求 `contextWindow: number`、`maxTokens: number`、`reasoning: boolean`、`input: ("text"|"image")[]` 均为必填，因此映射必须有回退值。

## 目标 / 非目标

**目标：**
- 优先使用 `/v1/models` 的 `max_input_tokens` / `context_length` / `max_output_tokens` / `capabilities` / `input_modalities` 填充 Pi `Model` 元数据
- 字段缺失或非法（非有限数、≤ 0）时回退到现有默认值（128000 / 4096 / false / text-only），行为与旧版本一致
- 保持 `/models` 请求路径、响应解析、auth 流程完全不变
- 映射逻辑可被单元测试直接覆盖

**非目标：**
- 不映射 `capabilities.effort_tiers` / `supportsThinking` 的细粒度 tier（仅做 `thinking` 布尔位 → 基础映射表，见 D8）
- 不消费 `pricing` 字段（成本保持 0，OmniRoute 按量计费在路由层处理）
- 不引入本地持久化缓存、不改变按需拉取策略
- 不改动 search / fetch 工具与 `/login` 流程

## 决策

### D1: 上下文窗口优先级 `max_input_tokens` → `context_length` → 128000

```typescript
contextWindow: pickInt(m.max_input_tokens, m.context_length) ?? 128000
```

理由：
- `max_input_tokens` 语义最精确：模型可接受的最大**输入** token 数，即对话上下文可用空间；`context_length` 是总上下文（部分厂商含输出预留，直接用作输入窗口可能过乐观）
- `max_input_tokens` 缺失率高（快照 388/546），`context_length` 几乎总是存在（538/546）；二者相同时结果一致，因此「先精确值、后总量」的链式回退在数据完整性上最优
- 实测二者相等（如 1048576），无取舍

> 替代方案 A：优先 `context_length`。否决：语义上可能含输出预留，且未利用更精确的 `max_input_tokens`。
>
> 替代方案 B：取 `min(max_input_tokens, context_length)`。否决：多一层计算，实际场景中二者相等或其一缺失，链式回退结果一致，更简单。

### D2: 输出上限 `maxTokens = max_output_tokens ?? 4096`

`max_output_tokens` 存在时直接使用（真实输出上限，如 1000~1048576 不等）；缺失时回退 4096，与现状一致。

### D3: 推理能力 `reasoning = capabilities.reasoning ?? false`

只读 `capabilities.reasoning` 布尔位：`true` 时 Pi 会向 OpenAI 兼容接口发送 `reasoning_effort` 等参数，`false`/缺失时回退 false（现状）。快照中存在 `capabilities` 全 false 的条目（17 条），此类模型保持非推理，符合数据。思考等级的细粒度映射见 D8。

### D4: 视觉输入 `input` 含 image 当且仅当有视觉证据

```typescript
input: m.capabilities?.vision === true ||
  (Array.isArray(m.input_modalities) && m.input_modalities.includes("image"))
  ? ["text", "image"] : ["text"]
```

`capabilities.vision` 与 `input_modalities` 是同一信息的两种表述（快照中部分条目只有其一），二者任一为真即声明视觉。避免误报：仅当数据明确声明时加入 `"image"`。`input_modalities` 非数组（如字符串）按无视觉证据处理：`Array.isArray` 守卫避免 `.includes` 抛错导致整链刷新失败。

### D5: 防御性取值 `pickInt` 校验有限正数

```typescript
function pickInt(...vs: Array<number | undefined>): number | undefined {
  for (const v of vs) if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  return undefined;
}
```

`null`、字符串、`NaN`、`Infinity`、`0`、负数一律按缺失处理，走回退路径。类型注解上字段为可选 `number`，运行时仍防御。

### D6: 条目类型显式化，映射留在 `src/index.ts`

```typescript
interface OmnirouteModelEntry {
  id: string;
  context_length?: number;
  max_input_tokens?: number;
  max_output_tokens?: number;
  capabilities?: {
    tool_calling?: boolean; reasoning?: boolean; thinking?: boolean;
    temperature?: boolean; vision?: boolean;
  };
  input_modalities?: string[];
}
```

`refreshModels` 的 `data` 注解从 `Array<{ id: string }>` 改为 `OmnirouteModelEntry[]`，`toOmnirouteModel` 接收完整条目。不新增模块：改动仅涉及一个函数，且现有测试模式（捕获 provider → 调 `refreshModels` → 断言 `getModels()`）已经能覆盖映射，无需导出内部函数。

> 替代方案：新建 `src/models.ts` 独立模块。否决：单一调用点、无复用需求，额外模块增加间接性；测试可通过 provider 通道覆盖。

### D7: 显示名称 `name = m.name ?? m.id`

部分条目（快照 2）带 `name` 字段（如厂商产品名），Pi 模型列表用它更可读；缺失或非字符串时回退 `id`，行为与现状一致。纯显示层增强，不影响请求。

### D8: 思考等级映射 `thinkingLevelMap`（`capabilities.thinking === true` 时）

```typescript
thinkingLevelMap: m.capabilities?.thinking === true
  ? { minimal: "minimal", low: "low", medium: "medium", high: "high", xhigh: "high", max: "high" }
  : undefined
```

动机来自 pi-ai 内部机制（`dist/api/openai-completions.js`）：

- 默认 OpenAI 格式下 `params.reasoning_effort = model.thinkingLevelMap?.[level] ?? level` —— **未映射的 pi 等级会被原样透传**。pi 等级 `xhigh`/`max` 不是合法的 `reasoning_effort` 取值，若用户选择这两个等级且无映射，服务端会 400
- `getSupportedThinkingLevels`：`xhigh`/`max` 只有在映射存在（非 undefined）时才被列为可用；映射到字符串后用户可安全选择，请求时收敛为 `"high"`
- `minimal` 恒等映射与现状行为一致（无映射时同样透传 `"minimal"`），不引入回归
- `off` 键不设置：pi 关闭思考时不发送 `reasoning_effort`，保持现状

> 替代方案：`effort_tiers` / `supportsThinking` 细粒度推导。否决：快照间键集合不统一（`supportsThinking` 是 OmniRoute 私有键），tier 字符串（`low`/`medium`/`high`）到 pi 等级（`minimal`~`max`）的对应需逐模型校准，风险大于收益；留作后续独立变更。

## 风险 / 权衡

| 风险 | 缓解措施 |
| --- | --- |
| 个别模型元数据错误（如 `context_length` 虚标过大） | 优先 `max_input_tokens`（更保守）；`pickInt` 拦截非法值；Pi 侧截断逻辑仍以实际请求结果为准 |
| `reasoning: true` 使 Pi 发送 `reasoning_effort`，个别路由模型不支持 | OpenAI 兼容接口对未知参数通常忽略；用户可在 Pi 中手动关闭 thinking |
| 视觉声明与实际不符导致请求被路由拒绝 | 仅跟随 OmniRoute 数据（`capabilities.vision` / `input_modalities`），不自行推断 |
| `max_output_tokens` 极小（如 1000）导致 Pi 输出截断过早 | 这是模型的真实上限；旧默认 4096 反而会请求越界。跟随服务端数据是正确行为 |
| 快照之间 `capabilities` 键集合不一致 | 只读取稳定出现的 `reasoning` / `vision`，其余键忽略（非目标） |
| 个别端点返回非数组 `input_modalities`（如字符串） | `Array.isArray` 守卫，按缺失处理（无视觉证据 → `["text"]`） |

## 迁移计划

- **破坏性变更**：无。所有字段都有回退值，元数据不完整的模型行为与旧版本完全一致
- **部署**：随扩展下一次启动生效（`refreshModels` 在模型列表刷新时执行）
- **回滚**：`git revert` 该变更即可，无状态迁移

## 开放问题

- 无重大待定项。`thinkingLevelMap` 映射（`effort_tiers`）与 `pricing` 消费留作后续独立变更

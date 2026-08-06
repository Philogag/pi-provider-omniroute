## 实现计划

> 本变更的细粒度实现计划见 **[`superpower-plan.md`](./superpower-plan.md)**（Task 1-5，TDD 红→绿，每任务独立提交）。
> 任务映射：Task 1 → 1.1/1.2/1.3/2.1/2.2/2.3(contextWindow)；Task 2 → 1.4/1.5/2.3(maxTokens+reasoning)；Task 3 → 1.6/1.7/2.3(input+name)/2.4；Task 4 → 1.8/2.5；Task 5 → 1.9/2.6/3.1/3.2。

## 1. 测试先行（specs/models-metadata 覆盖）

- [x] 1.1 新建 `test/models-metadata.test.ts`，复用 `test/lazy-fetch.test.ts` 的捕获 provider 模式（mock `registerProvider`、`PI_AGENT_DIR` 指向空临时目录），新增 `okResponse` 助手接受完整条目（含 `context_length` / `max_input_tokens` / `max_output_tokens` / `capabilities` / `input_modalities` / `name`）
- [x] 1.2 编写 contextWindow 映射测试：`max_input_tokens` 优先于 `context_length`（如 `{ max_input_tokens: 1048576, context_length: 2000000 }` → 1048576）；仅 `context_length` 时使用之（131072）；两者缺失时回退 128000
- [x] 1.3 编写非法值回退测试：`max_input_tokens: 0`、`context_length: -1`、非数字（如字符串）均回退 128000
- [x] 1.4 编写 maxTokens 映射测试：`max_output_tokens: 65536` → 65536；缺失时回退 4096
- [x] 1.5 编写 reasoning 映射测试：`capabilities.reasoning: true` → `reasoning: true`；键缺失或 `capabilities` 缺失 → `false`
- [x] 1.6 编写 input 映射测试：`capabilities.vision: true` 或 `input_modalities: ["text","image"]` → `["text","image"]`；无视觉证据 → `["text"]`
- [x] 1.7 编写 name 映射测试：`name: "GPT-4o"` → `name === "GPT-4o"`；`name` 缺失或非字符串 → 回退 `id`
- [x] 1.8 编写 thinkingLevelMap 映射测试：`capabilities.thinking: true` → `thinkingLevelMap` 深等于 `{ minimal: "minimal", low: "low", medium: "medium", high: "high", xhigh: "high", max: "high" }`；`thinking` 缺失或非 true → `undefined`
- [x] 1.9 确认 `test/lazy-fetch.test.ts` 现有断言（`{ id }` 条目 + 默认值回退）无需修改仍全部通过

## 2. 实现映射（src/index.ts）

- [x] 2.1 在 `src/index.ts` 定义 `interface OmnirouteModelEntry`（`id` 必填；`name` 可选 string；`context_length`、`max_input_tokens`、`max_output_tokens` 为可选 number；`capabilities` 可选布尔字典含 `reasoning`/`vision`/`thinking`；`input_modalities` 可选 string[]），`refreshModels` 的 `data` 注解从 `Array<{ id: string }>` 改为 `OmnirouteModelEntry[]`
- [x] 2.2 添加模块级助手 `pickInt(...vs)`：返回第一个「typeof number 且 `Number.isFinite` 且 `> 0`」的值，否则 `undefined`
- [x] 2.3 修改 `toOmnirouteModel` 数值与能力映射：`contextWindow: pickInt(m.max_input_tokens, m.context_length) ?? 128000`；`maxTokens: pickInt(m.max_output_tokens) ?? 4096`；`reasoning: m.capabilities?.reasoning === true`；`input: m.capabilities?.vision === true || m.input_modalities?.includes("image") ? ["text","image"] : ["text"]`；`cost` 等其余字段保持不变
- [x] 2.4 修改 `toOmnirouteModel` 显示名称：`name: typeof m.name === "string" ? m.name : m.id`
- [x] 2.5 修改 `toOmnirouteModel` 思考等级：`thinkingLevelMap: m.capabilities?.thinking === true ? { minimal: "minimal", low: "low", medium: "medium", high: "high", xhigh: "high", max: "high" } : undefined`（不设置 `off` 键）
- [x] 2.6 `npm run typecheck` 通过（`capabilities` 键集合开放：只读取已知键，类型注解不含 `effort_tiers` 等未消费键）

## 3. 验证

- [x] 3.1 `npm test` 全绿（含新增 `models-metadata.test.ts` 与既有测试）
- [x] 3.2 手动冒烟：对本地 OmniRoute 实例执行一次模型刷新，确认注册模型显示真实上下文窗口、推理/视觉标志与显示名称（可选，OmniRoute 不可达时以 3.1 为准）——本次已跳过：环境无可达 OmniRoute 实例，以 3.1 的 `npm test` 全绿为准

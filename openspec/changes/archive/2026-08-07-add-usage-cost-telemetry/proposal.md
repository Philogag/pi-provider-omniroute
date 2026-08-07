## 为什么

Pi 的会话计费统计（`message.usage.cost`）目前用模型静态价格表计算（`calculateCost(model, usage)`，本扩展所有模型 `cost: 0`），无法反映 OmniRoute 的真实成本。OmniRoute 在每个完成响应中通过 `X-OmniRoute-*` 成本遥测头（`X-OmniRoute-Response-Cost`、`X-OmniRoute-Tokens-In/Out` 等）报告实际花费，但这些数据目前被 Pi 丢弃——用户在 Pi 中看不到任何成本信息。接入后，每次会话消息的成本统计将显示 OmniRoute 报告的真实 USD 金额。

## 变更内容

- **捕获 OmniRoute 成本遥测**：在 omniroute provider 的流式响应中解析 `X-OmniRoute-*` 遥测数据——`X-OmniRoute-Response-Cost`（USD，10 位小数）、`X-OmniRoute-Tokens-In`、`X-OmniRoute-Tokens-Out`、`X-OmniRoute-Model`、`X-OmniRoute-Provider`、`X-OmniRoute-Cache-Hit`、`X-OmniRoute-Latency-Ms`。注意：流式响应中这些数据位于响应 body 尾部的 SSE 注释行（`: x-omniroute-*`，`after_provider_response` 的 headers 中不可见）；非流式响应中它们位于 HTTP headers。
- **覆盖 Pi 的计费统计**：通过包装 provider 的 `streamSimple`/`stream`，在流结束时将解析到的真实成本写入 `message.usage.cost.total`（保留 Pi 计算的 token 用量；`cost` 四分量中仅 `total` 使用真实值，`input/output/cacheRead/cacheWrite` 保持按模型价格计算的值）。
- **缓存命中语义**：当 `X-OmniRoute-Cache-Hit: true` 时 `Response-Cost` 为 `0`（增量成本），按 OmniRoute 文档原样采用（hits 计 0 成本）。

## 功能 (Capabilities)

### 新增功能
- `usage-cost-telemetry`: 从 OmniRoute 完成响应捕获 `X-OmniRoute-*` 成本遥测，并将其接入 Pi 的 `message.usage.cost` 统计。

### 修改功能
<!-- 无：不修改现有 capability 的规范级行为 -->

## 影响

- `src/index.ts`：修改 omniroute provider 的 `streamSimple`/`stream` 包装，注入自定义 `fetch`（包装 Response body 以捕获 SSE 注释行遥测）并包装返回的事件流（在 `done` 事件覆盖 cost）。
- 新增辅助模块（如 `src/tools/usage-telemetry.ts`）：SSE 注释行解析 + 成本覆盖逻辑，含单元测试。
- 无新依赖（复用 pi-ai 的 `options.fetch` 注入点与 `AssistantMessageEventStream` 事件包装）。
- 行为变化：`/login` 后所有 omniroute 会话消息的 `usage.cost.total` 显示真实成本（原为 0）；Pi 的会话/成本统计 UI 随之更新。

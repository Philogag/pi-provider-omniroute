## 新增需求

### 需求:捕获 OmniRoute 成本遥测

系统必须捕获 OmniRoute 流式完成响应 body 中的 `X-OmniRoute-*` 成本遥测数据，包括 `X-OmniRoute-Response-Cost`（USD 金额）、`X-OmniRoute-Tokens-In`、`X-OmniRoute-Tokens-Out`、`X-OmniRoute-Model`、`X-OmniRoute-Provider`、`X-OmniRoute-Cache-Hit`、`X-OmniRoute-Latency-Ms`。系统必须解析响应 body 中以 `: x-omniroute-` 前缀的 SSE 注释行。系统不得修改流式响应的原始字节流（透传语义必须保持）。

#### 场景:流式响应解析 SSE 注释行遥测

- **当** omniroute provider 收到流式响应，其 body 尾部包含注释行 `: x-omniroute-response-cost=0.0000190400` 和 `: x-omniroute-tokens-in=88` 与 `: x-omniroute-tokens-out=13`
- **那么** 系统解析出 responseCost 为 0.00001904、tokensIn 为 88、tokensOut 为 13

#### 场景:遥测行跨 chunk 边界

- **当** 流式响应的遥测注释行被分割到相邻的多个数据 chunk 中
- **那么** 系统仍能正确解析出完整遥测值

#### 场景:无遥测时静默降级

- **当** 响应中不包含任何 `X-OmniRoute-*` 遥测数据
- **那么** 系统不报错，成本统计保持 Pi 的静态计算值

#### 场景:遥测值无法解析

- **当** 遥测行中的数值不是有效数字（如 `: x-omniroute-response-cost=abc`）
- **那么** 系统忽略该行，不覆盖成本统计

### 需求:成本遥测接入 Pi 计费统计

系统必须将捕获的 `X-OmniRoute-Response-Cost` 写入 Pi 会话消息的 `message.usage.cost.total` 字段。写入必须在流结束（`done` 事件）时进行。系统必须仅覆盖 `total` 字段，不得修改 `usage` 的 token 计数（`input_tokens`/`output_tokens`），也不得修改 `cost` 的 `input`/`output`/`cacheRead`/`cacheWrite` 分项。

#### 场景:流结束覆盖成本总计

- **当** 流完成（`done` 事件）且已捕获遥测 responseCost 0.00001904
- **那么** 最终消息的 `message.usage.cost.total` 为 0.00001904

#### 场景:覆盖仅限 omniroute provider

- **当** 非 omniroute provider 发起流式请求
- **那么** 其响应不被该遥测捕获逻辑处理，成本统计不受影响

#### 场景:缓存命中时成本为零

- **当** 遥测报告 `X-OmniRoute-Cache-Hit: true` 且 `X-OmniRoute-Response-Cost` 为 0
- **那么** `message.usage.cost.total` 为 0（按 OmniRoute 计费语义，缓存命中不产生增量成本）

#### 场景:未捕获遥测时不覆盖

- **当** 流结束时未捕获到任何 responseCost
- **那么** `message.usage.cost.total` 保持 Pi 的静态计算值（0）

### 需求:遥测详情附加到消息诊断

系统必须将捕获的完整遥测数据附加到会话消息的 `message.diagnostics` 数组，诊断项的 `type` 必须为 `omniroute-telemetry`，`details` 必须包含 `responseCost`、`tokensIn`、`tokensOut`、`model`、`provider`、`cacheHit` 字段。

#### 场景:附加遥测诊断

- **当** 流完成且已捕获遥测（responseCost 0.00001904、tokensIn 88、tokensOut 13、model deepseek-v4-flash、provider opencode-go、cacheHit false）
- **那么** 最终消息的 `message.diagnostics` 包含一个 `type` 为 `omniroute-telemetry` 的项，其 `details.responseCost` 为 0.00001904、`details.cacheHit` 为 false

#### 场景:无遥测时不附加诊断

- **当** 流结束时未捕获到任何遥测数据
- **那么** `message.diagnostics` 不被修改

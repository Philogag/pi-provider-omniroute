## MODIFIED Requirements
### 需求:捕获 OmniRoute 成本遥测

系统必须捕获 OmniRoute 流式完成响应 body 中的 `X-OmniRoute-*` 遥测数据，包括 `X-OmniRoute-Response-Cost`（USD 金额）、`X-OmniRoute-Tokens-In`、`X-OmniRoute-Tokens-Out`、`X-OmniRoute-Tokens-Per-Second`（生成速率，仅正值有效）、`X-OmniRoute-Ttft-Ms`（首 token 延迟，仅正值有效）、`X-OmniRoute-Model`、`X-OmniRoute-Provider`、`X-OmniRoute-Cache-Hit`、`X-OmniRoute-Latency-Ms`。系统必须解析响应 body 中以 `: x-omniroute-` 前缀的 SSE 注释行。系统不得从 `X-OmniRoute-Latency-Ms` 推算 tokens-per-second（该延迟包含 TTFT，推算值不可靠）；网关未报告或报告 0/非法值的 tok/s 与 ttft 必须保持缺失。系统不得修改流式响应的原始字节流（透传语义必须保持）。

#### 场景:流式响应解析 SSE 注释行遥测

- **当** omniroute provider 收到流式响应，其 body 尾部包含注释行 `: x-omniroute-response-cost=0.[PHONE_REDACTED]` 和 `: x-omniroute-tokens-in=88` 与 `: x-omniroute-tokens-out=13`
- **那么** 系统解析出 responseCost 为 0.00001904、tokensIn 为 88、tokensOut 为 13

#### 场景:解析 tokens-per-second 与 ttft-ms 遥测行

- **当** 流式响应 body 包含注释行 `: x-omniroute-tokens-per-second=80.5` 与 `: x-omniroute-ttft-ms=300`
- **那么** 系统解析出 tokensPerSecond 为 80.5、ttftMs 为 300

#### 场景:零值或非法 tok/s 忽略且不推算

- **当** 响应包含 `: x-omniroute-tokens-per-second=0` 或 `: x-omniroute-tokens-per-second=abc`，且存在 `: x-omniroute-latency-ms=2000`
- **那么** 系统不产生 tokensPerSecond 字段，且不得根据 latency-ms 推算任何 tok/s 值

#### 场景:遥测行跨 chunk 边界

- **当** 流式响应的遥测注释行被分割到相邻的多个数据 chunk 中
- **那么** 系统仍能正确解析出完整遥测值

#### 场景:无遥测时静默降级

- **当** 响应中不包含任何 `X-OmniRoute-*` 遥测数据
- **那么** 系统不报错，成本统计保持 Pi 的静态计算值

#### 场景:遥测值无法解析

- **当** 遥测行中的数值不是有效数字（如 `: x-omniroute-response-cost=abc`）
- **那么** 系统忽略该行，不覆盖成本统计

### 需求:遥测详情附加到消息诊断

系统必须在流完成（`done` 事件）时，将捕获到的遥测数据附加到会话消息的 `message.diagnostics` 数组；只要捕获到任意非空遥测字段即附加，不以 `responseCost` 是否存在为前提。诊断项的 `type` 必须为 `omniroute-telemetry`。`details` 必须包含已捕获字段中的 `responseCost`、`tokensIn`、`tokensOut`、`tokensPerSecond`、`ttftMs`、`latencyMs`、`model`、`provider`、`cacheHit`；未被捕获的字段必须省略。附加诊断不得修改 `message.usage` 的 token 计数或 `cost` 分项。

#### 场景:附加遥测诊断

- **当** 流完成且已捕获遥测（responseCost 0.00001904、tokensIn 88、tokensOut 13、model deepseek-v4-flash、provider opencode-go、cacheHit false）
- **那么** 最终消息的 `message.diagnostics` 包含一个 `type` 为 `omniroute-telemetry` 的项，其 `details.responseCost` 为 0.00001904、`details.cacheHit` 为 false

#### 场景:仅 tok/s 无 responseCost 时也附加诊断

- **当** 流完成且仅捕获到 tokensPerSecond 80.5（无 responseCost）
- **那么** `message.diagnostics` 包含 `type` 为 `omniroute-telemetry` 的项且 `details.tokensPerSecond` 为 80.5，`details` 不含 `responseCost` 字段，`message.usage.cost.total` 不被覆盖

#### 场景:details 包含延迟字段

- **当** 流完成且捕获到 latencyMs 1161
- **那么** 附加的 `omniroute-telemetry` 诊断 `details.latencyMs` 为 1161

#### 场景:无遥测时不附加诊断

- **当** 流结束时未捕获到任何遥测数据
- **那么** `message.diagnostics` 不被修改

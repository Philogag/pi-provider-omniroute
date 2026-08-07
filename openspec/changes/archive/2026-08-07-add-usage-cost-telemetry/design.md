## 上下文

- 本扩展把 OmniRoute 注册为 Pi 的 `omniroute` provider（`src/index.ts`），所有导入模型的 `cost` 字段为 0（`toOmnirouteModel` 中 `cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }`）。
- Pi 的计费统计通过 `calculateCost(model, usage)` 用模型静态价格计算 `message.usage.cost`（pi-ai `dist/api/openai-completions.js:1078-1088`），因此当前 omniroute 消息成本恒为 0，用户看不到真实花费。
- OmniRoute v3.8.x 在完成响应中携带成本遥测头（见 [API_REFERENCE.md#custom-headers](https://github.com/diegosouzapw/OmniRoute/blob/release/v3.8.50/docs/reference/API_REFERENCE.md#custom-headers)）：
  - `X-OmniRoute-Response-Cost`：USD，固定 10 位小数，`0.0000000000` 表示免费/无定价
  - `X-OmniRoute-Tokens-In` / `X-OmniRoute-Tokens-Out`
  - `X-OmniRoute-Model` / `X-OmniRoute-Provider` / `X-OmniRoute-Latency-Ms` / `X-OmniRoute-Cache-Hit` / `X-OmniRoute-Fallback-Attempts` / `X-OmniRoute-Request-Id` / `X-OmniRoute-Version`
  - `X-OmniRoute-Cost-Saved`：缓存命中时报告"本可花费"的原始成本
  - 缓存命中语义：`X-OmniRoute-Cache-Hit: true` 时 `Response-Cost` 为 0（增量成本），原始成本在 `Cost-Saved`
- **实测确认**（route.ai.philogag.com，2026-08-07）：
  - 非流式响应：遥测位于 **HTTP 响应头**（`x-omniroute-response-cost: 0.0000268800` 等）
  - 流式响应（Pi 默认 `stream: true` + `stream_options: { include_usage: true }`）：遥测**不在 HTTP headers**（只有 `x-omniroute-route-class`），也不在 `response.trailers`（undefined），而是以 **SSE 注释行**形式追加在响应 body 尾部 `data: [DONE]` 之前：
    ```
    : x-omniroute-cache-hit=false
    : x-omniroute-latency-ms=1161
    : x-omniroute-response-cost=0.0000190400
    : x-omniroute-tokens-in=88
    : x-omniroute-tokens-out=13
    data: [DONE]
    ```
  - SSE 注释行以 `: ` 开头，openai SDK 的流解析器会忽略它们（标准 SSE 行为），因此 Pi 侧无法感知——遥测数据被丢弃。
  - **brainstorm 决策**：仅解析 body 注释行（不做 headers 解析；Pi 默认永远流式，非流式场景已从 delta spec 移除）。
- pi-ai 集成点（源码核实 `dist/api/openai-completions.js`）：
  - `stream(model, context, options)` 接受 `options.fetch` 自定义 fetch，传入 `createClient` → `new OpenAI({ fetch })`（:128, :508）
  - 流事件用 `AssistantMessageEventStream`（`dist/utils/event-stream.js`），导出了 `createAssistantMessageEventStream()` 工厂（d.ts 注明 "for use in extensions"）
  - `streamSimple` 是 `stream` 的薄包装（:466-474）
  - **诊断扩展点**：`AssistantMessage` 无 `details` 字段（types.d.ts:288-304）；官方工具 `appendAssistantMessageDiagnostic(message, diagnostic)`（dist/utils/diagnostics.js）+ `AssistantMessageDiagnostic { type, timestamp, error?, details?: Record<string,unknown> }`；Pi 的 usage-totals.js:15 `totals.cost += usage.cost.total` 聚合成本。
- 本扩展 `src/index.ts:97-103` 已有 `streamSimple`/`stream` 透传包装，是注入点。

## 目标 / 非目标

**目标：**
- 在 omniroute provider 的流式完成响应中捕获 `X-OmniRoute-*` 成本遥测（SSE 注释行）
- 将捕获的真实成本写入 Pi 的 `message.usage.cost.total`，使 Pi 会话/计费统计显示 OmniRoute 报告的实际 USD 金额
- 将完整遥测附加到 `message.diagnostics`（type: omniroute-telemetry）供诊断
- 零新依赖、零外部 API 变更

**非目标：**
- 不解析非流式响应的 HTTP headers 遥测（Pi 默认永远流式；已从 delta spec 移除该场景）
- 不修改 Pi 的 `calculateCost` 逻辑或模型静态价格（`cost` 字段仍为 0；我们只覆盖 `total`）
- 不在 Pi UI 新增成本展示组件（Pi 侧已有 cost 展示，只需喂数据）
- 不接入 `X-OmniRoute-Cost-Saved`（缓存省下的钱）——仅按 OmniRoute 计费语义采用 `Response-Cost`（命中即 0）
- 不暴露 `Latency-Ms`/`Model`/`Provider`/`Request-Id` 等遥测详情到 UI（仅入 diagnostics）
- 不修改 search/fetch 工具

## 决策

### D1: 捕获机制 —— 自定义 `fetch` 包装 Response body，逐行解析 SSE 注释行（仅 body）

在 provider 的 `streamSimple`/`stream` 包装中，将 `options.fetch` 替换为自定义 fetch：
1. 调用原始 fetch 获得 `Response`
2. 若响应成功（ok）且为流式（body 存在），用 `response.body.pipeThrough(new TransformStream(...))` 包装字节流：累积解码文本，按行扫描 `^: x-omniroute-(.+?)=(.+)$` 注释行，解析进遥测对象；原字节原样 `enqueue` 透传
3. 返回 `new Response(transformedBody, response)`（保留状态/头）
4. **不做 headers 解析**（Pi 默认永远流式；非流式场景已从 delta spec 移除）

**为什么选 X 而不是 Y：**
- 备选 Y1：`after_provider_response` 事件读 headers —— **不可行**：流式时遥测不在 headers（实测只有 route-class），该事件在 body 消费前触发，拿不到 body 注释行
- 备选 Y2：`message_end` 事件改写 `usage.cost` —— 但拿不到遥测数据（事件里没有 HTTP 层信息），仍需捕获通道
- 备选 Y3：完整自定义 `streamSimple` 重写流解析 —— 工作量巨大且易错（要复刻 openai SDK 的 SSE/chunk 解析、工具调用、thinking 处理）
- 选 X：`options.fetch` 是 pi-ai 官方支持的注入点（源码确认传入 `new OpenAI({ fetch })`），TransformStream 在字节层面拦截、解析后透传，SDK 行为完全不变——最小侵入

### D2: 写入机制 —— 包装 `AssistantMessageEventStream`，在 `done` 事件覆盖 `usage.cost.total`

自定义 fetch 捕获的遥测存入闭包变量；`stream` 包装把 pi-ai 返回的流转发到一个 `createAssistantMessageEventStream()` 新流，逐事件 `push`，遇到 `type === "done"` 时：若捕获到 `responseCost` 则写 `event.message.usage.cost.total = responseCost`（仅在不为 0 或总成本为 0 时覆盖？—— 策略：**始终用遥测值覆盖 total**，因为遥测是真实成本，包括命中时的 0；Pi 静态计算的值是 0 且无意义）。

**为什么选 X 而不是 Y：**
- 备选 Y：直接 mutate pi-ai 返回流的内部 `output` —— 不可达（流内部状态封装）
- 选 X：`createAssistantMessageEventStream()` 是 pi-ai 为扩展提供的官方工厂，事件转发是文档化的 Custom Streaming API 模式（`custom-provider#usage-and-cost` 示例）

### D3: 遥测详情写入 message.diagnostics（非 details）

`AssistantMessage` 无 `details` 字段（types.d.ts:288-304，仅 ToolResultMessage 有）。官方扩展点是 `diagnostics?: AssistantMessageDiagnostic[]` + `appendAssistantMessageDiagnostic(message, diagnostic)`（dist/utils/diagnostics.js）。附加 `{ type: "omniroute-telemetry", timestamp: Date.now(), details: { responseCost, tokensIn, tokensOut, model, provider, cacheHit } }`。已检查 pi 的 diagnostics 消费：当前仅加载诊断（collision/error），per-message diagnostics 无副作用渲染——安全。

### D3b: 缓存命中语义

`X-OmniRoute-Cache-Hit: true` 时 `Response-Cost = 0.0000000000`。按 OmniRoute 计费语义原样采用（hits cost nothing，无条件覆盖为 0）。不改写 `Cost-Saved`。

### D4: 仅覆盖 `total`，保留 token 用量

`message.usage` 的 token 数由 openai SDK 的 `include_usage` chunk 提供（Pi 已正确解析），不变。`usage.cost` 四分量中仅覆盖 `total`（`input/output/cacheRead/cacheWrite` 保持 Pi 静态计算值 0）——避免伪造分项。

### D5: 解析容错

- 注释行可能跨 chunk 边界：TransformStream 维护跨 transform 调用的行缓冲，flush 时处理残留
- 无遥测（旧版 OmniRoute / 非 omniroute 响应 / 出错）：静默跳过，cost 保持 Pi 计算值——降级安全
- 数值解析失败（NaN）：忽略该行

### D6: 覆盖范围仅限 omniroute provider

自定义 fetch 仅注入 omniroute provider 的 streamSimple/stream（`src/index.ts` 的 provider 定义内），不影响 Pi 全局 fetch。通过 `new URL(url)` 校验请求 host 是否为当前 baseUrl 可进一步收紧（防御性，防 session_id 等其它 fetch 误匹配）。

## 风险 / 权衡

- **[pi-ai 内部实现变更]** `options.fetch` 注入点或 `AssistantMessageEventStream` API 未来可能变化 → 代码集中在单一模块 `src/tools/usage-telemetry.ts`，升级 pi-ai 时易定位；若注入点消失，降级为不捕获（行为回到现状，无回归）
- **[SSE 解析与 SDK 不一致]** 若 OmniRoute 未来改变注释行格式 → 解析器按模式匹配失败则静默跳过，不破坏流
- **[成本显示语义变化]** 用户习惯 cost=0 → 现在显示真实成本，可能触发对"为什么这行贵"的疑问 → README/变更说明中注明数据来自 OmniRoute 遥测
- **[性能]** TransformStream 逐字节透传 + 行扫描，对 40K+ 响应有轻微开销 → 仅保留行缓冲与正则匹配，无额外拷贝；遥测行集中在尾部，实际扫描量小
- **[测试依赖真实网络]** 单元测试用构造的 SSE 文本片段，无需真实请求 → 测试策略见 tasks

## 迁移计划

- 纯新增能力，无迁移/回滚步骤；发布后立即生效（新会话起 Pi 显示真实 cost）
- 若出现异常，移除 `streamSimple`/`stream` 包装中的 usage-telemetry 引用即回退

## 未决问题

- 是否需要把 `X-OmniRoute-Response-Cost` 之外的信息（如 `Latency-Ms`、`Cache-Hit`）也写入 message details？——本变更不处理，留待 phase 4
- `usage.cost.total` 覆盖时是否保留一个遥测来源标记（如 `details.omnirouteCostSource: "telemetry"`）便于诊断？——默认不加，保持最小

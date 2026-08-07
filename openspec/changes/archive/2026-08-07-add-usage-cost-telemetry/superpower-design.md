# Superpower Design — add-usage-cost-telemetry

## 目标

把 OmniRoute 完成响应的成本遥测（`X-OmniRoute-Response-Cost` 等）接入 Pi 的 `message.usage.cost.total`，让 Pi 会话/成本统计显示真实 USD 花费（当前模型静态价格全 0，用户看不到任何成本）。

## 架构（4 层）

```
src/tools/usage-telemetry.ts (新模块)
├─ parseOmnirouteTelemetryLine(line) → Partial<OmnirouteTelemetry> | null
│      // 解析 ": x-omniroute-<key>=<value>" SSE 注释行；NaN/缺键容错；返回 null 跳过
├─ extractOmnirouteTelemetry(text) → OmnirouteTelemetry | undefined
│      // 累积解码文本中的全部注释行 → 合并遥测对象
├─ createTelemetryTransformStream() → TransformStream<Uint8Array, Uint8Array>
│      // 字节→字符串→行缓冲（跨 chunk 边界）→ 原字节原样 enqueue 透传；提取遥测到闭包
├─ withOmnirouteFetch(fetch, onTelemetry?) → fetch
│      // 包装 fetch：调用原 fetch → response.body.pipeThrough(transform) → new Response(transformed, response)
└─ wrapStreamWithCost(stream, telemetry) → AssistantMessageEventStream
       // createAssistantMessageEventStream() 逐事件转发；done 时覆盖 cost.total + appendAssistantMessageDiagnostic
```

**数据流**：`provider.stream()` → `withOmnirouteFetch(options.fetch)` 捕获遥测（闭包）→ pi-ai 解析流 → `wrapStreamWithCost(stream, telemetry)` → `done` 事件写 `message.usage.cost.total` + `message.diagnostics` → Pi `usage-totals.js:15` 聚合 `usage.cost.total` → 会话成本统计显示真实成本。

**OmnirouteTelemetry 类型**：
```ts
interface OmnirouteTelemetry {
  responseCost?: number;   // X-OmniRoute-Response-Cost (USD, 10 位小数)
  tokensIn?: number;       // X-OmniRoute-Tokens-In
  tokensOut?: number;      // X-OmniRoute-Tokens-Out
  model?: string;          // X-OmniRoute-Model
  provider?: string;       // X-OmniRoute-Provider
  cacheHit?: boolean;      // X-OmniRoute-Cache-Hit
  latencyMs?: number;      // X-OmniRoute-Latency-Ms
}
```

## 决策

### D1: 仅解析 body SSE 注释行（不做 headers）

- 用户选择"仅 body 注释行"。Pi 默认永远流式（`stream: true` + `stream_options.include_usage`），流式时遥测在 body 尾部 `: x-omniroute-*` 注释行（实测），HTTP headers 只有 `x-omniroute-route-class`。
- openai SDK 的 SSE 解析器忽略 `: ` 注释行（标准 SSE 行为），所以 Pi 侧丢弃——必须自己解析。
- 非流式 headers 解析不做（spec 已回写移除该场景）。

### D2: done 事件无条件覆盖 cost.total

- 用户选择"无条件覆盖"（含缓存命中 0——按 OmniRoute 计费语义 hits 免费）。
- 写 `event.message.usage.cost.total = responseCost`。仅覆盖 total；`input/output/cacheRead/cacheWrite` 分项与 token 计数保持 Pi 静态计算值（`usage-totals.js:15 totals.cost += usage.cost.total` 正是读取 total，所以显示即真实成本）。

### D3: 遥测详情写入 message.diagnostics（非 details）

- 用户选择"cost + 遥测 details"，但**源码核实 `AssistantMessage` 无 `details` 字段**（types.d.ts:288-304，只有 ToolResultMessage 有 details）。
- 官方扩展点：`diagnostics?: AssistantMessageDiagnostic[]` + pi-ai 工具 `appendAssistantMessageDiagnostic(message, diagnostic)`（dist/utils/diagnostics.js，`AssistantMessageDiagnostic { type, timestamp, error?, details?: Record<string,unknown> }`）。
- 附加 `{ type: "omniroute-telemetry", timestamp: Date.now(), details: { responseCost, tokensIn, tokensOut, model, provider, cacheHit } }`。
- 检查过 pi 的 TUI/interactive-mode 消费：diagnostics 目前用于加载诊断（collision/error），per-message diagnostics 无副作用渲染——安全。

### D4: TransformStream 字节透传 + 行缓冲

- `response.body.pipeThrough(createTelemetryTransformStream())`，返回 `new Response(transformedBody, response)`（保留 status/headers）。
- transform：TextDecoder 解码 → 累积 → 按 `\n` 分行 → 非完整行留缓冲（跨 chunk）→ flush 处理残留 → 解析 `^: x-omniroute-(.+?)=(.+)$` → 原字节 enqueue 透传。
- 多 chunk 组合：注释行可能被切分（实测 body 尾部注释行与 `[DONE]` 相邻），行缓冲保证完整解析。

### D5: 静默降级

- 无遥测（旧版 OmniRoute / 出错响应 / 非 omniroute）→ 不覆盖不报错，cost 保持 Pi 计算值。
- 数值 NaN / 键缺失 → 忽略该行。
- 容错优先级：不破坏流 > 捕获成本。

### D6: 仅 omniroute provider 生效

- 注入点：src/index.ts provider 定义的 stream/streamSimple 包装（:97-103）——`stream: (model, context, options) => { ... }` 内注入 `withOmnirouteFetch(options.fetch)` 与 `wrapStreamWithCost`。
- 不修改 Pi 全局 fetch 行为；其他 provider 不受影响。
- 可选防御：`new URL(url).host` 校验是否 baseUrl（防 session_id 等其它请求误匹配）——默认加，成本低。

## 组件接口

### parseOmnirouteTelemetryLine(line: string): Partial<OmnirouteTelemetry> | null
- 输入一行文本（无换行）。匹配 `^: x-omniroute-([a-z-]+)=(.+)$`。
- 键映射：`response-cost`→responseCost、`tokens-in`→tokensIn、`tokens-out`→tokensOut、`model`→model、`provider`→provider、`cache-hit`→cacheHit("true"/"false")、`latency-ms`→latencyMs。
- 数值解析 NaN → 忽略该键；未知键忽略；非注释行返回 null。

### extractOmnirouteTelemetry(text: string): OmnirouteTelemetry | undefined
- 对 text 按行调用 parse，合并结果；无任何键 → undefined。

### createTelemetryTransformStream(): TransformStream<Uint8Array, Uint8Array>
- transform(chunk)：TextDecoder decode(chunk, {stream:true}) → 拼接 buffer → 按 `\n` 切分完整行 → 每行 parse 进 telemetry 闭包 → 原 chunk enqueue。
- flush()：处理残留行（无换行结尾）。
- **注意**：TextDecoder 逐 chunk decode 需 `{stream: true}`，否则多字节 UTF-8 字符跨 chunk 会乱码（遥测值都是 ASCII，但 body 内容含中文——必须正确）。

### withOmnirouteFetch(fetch: typeof globalThis.fetch, onTelemetry?: (t: OmnirouteTelemetry) => void): typeof globalThis.fetch
- 返回 async (input, init) => { const res = await fetch(input, init); if (!res.ok || !res.body) return res; const { readable, writable } = createTelemetryTransformStream(); res.body.pipeTo(writable); return new Response(readable, res); }
- 解析到遥测时调 onTelemetry（包装器闭包收集）。

### wrapStreamWithCost(stream: AssistantMessageEventStream, telemetry: OmnirouteTelemetry | undefined): AssistantMessageEventStream
- `const out = createAssistantMessageEventStream(); const pump = async () => { for await (const event of stream) { if (event.type === "done" && telemetry?.responseCost !== undefined) { event.message.usage.cost.total = telemetry.responseCost; appendAssistantMessageDiagnostic(event.message, { type: "omniroute-telemetry", timestamp: Date.now(), details: {...} }); } out.push(event); } out.end(); }; void pump(); return out;`
- 无遥测 → 纯转发（out.push/end），零副作用。
- 注意 appendAssistantMessageDiagnostic 签名（dist/utils/diagnostics.d.ts）：`(message: T, diagnostic: AssistantMessageDiagnostic)`，内部 `message.diagnostics = [...(message.diagnostics ?? []), diagnostic]`。

## 测试策略（单测为主，用户选择）

### 单元测试（test/usage-telemetry.test.ts）
- parseOmnirouteTelemetryLine：完整行（cost/tokens/cache-hit/model/provider/latency）、非注释行 → null、NaN 数值 → 忽略键、未知键 → 忽略、`cache-hit=true/false` → boolean。
- extractOmnirouteTelemetry：多行合并、无匹配 → undefined。
- createTelemetryTransformStream：构造 chunk 序列（单 chunk / 注释行跨 chunk 切分 / 空 flush / 中文内容跨 chunk 不乱码——校验透传字节与解码内容）→ 断言提取到的遥测。
- 透传完整性：transform 输出 === 输入字节序列（chunk-by-chunk enqueue 等价）。

### 事件流测试（test/usage-telemetry-stream.test.ts）
- 构造 AssistantMessageEventStream（createAssistantMessageEventStream() + push 事件 + end）→ wrapStreamWithCost → 消费输出流 → 断言：
  - done 事件后 message.usage.cost.total === responseCost
  - message.diagnostics 含 type omniroute-telemetry 且 details 字段完整
  - token 计数（usage.input/output/totalTokens）不变
  - cost 分项（input/output/cacheRead/cacheWrite）不变
  - 无遥测 → 输出流与输入流事件等价（total 不变、无 diagnostics）
  - 非 done 事件（text_/start/error）不被修改
- 异步等待：done 是 isComplete 事件，push 后流 result() 可 await——用 `await stream.result()` 拿最终 message。

### 接线测试（test/index-usage-telemetry.test.ts 或并入既有 provider 测试）
- mock fetch 返回构造的 Response（body = new Blob([sseText]) 或 ReadableStream）→ 调 provider stream 包装 → 断言流消费后 message.usage.cost.total。
- **注**：既有测试 test/lazy-fetch.test.ts 禁改；新测试文件独立。

## 边界条件

| 条件 | 行为 |
|---|---|
| 流中断（用户 Esc/abort） | 无 done 事件 → 不覆盖（可接受，成本信息丢失不阻断） |
| 遥测行切分在任意位置 | 行缓冲跨 chunk 处理 |
| 多个遥测键（10 键） | 合并单 telemetry 对象 |
| body 含多字节 UTF-8（中文） | TextDecoder {stream:true} 逐 chunk 正确解码 |
| 无遥测 / 旧版 OmniRoute | 静默降级，cost 保持 0 |
| 非 2xx 响应 | 跳过包装（!res.ok 直接 return res） |
| 未来 pi-ai 移除 options.fetch / createAssistantMessageEventStream | 降级：provider 包装退化纯透传，无回归 |

## 风险

| 风险 | 缓解 |
|---|---|
| pi-ai options.fetch / event-stream API 变化 | 逻辑集中在单一模块 usage-telemetry.ts；注入点消失则降级纯透传 |
| OmniRoute 注释行格式变化 | 模式匹配失败静默跳过，不破坏流 |
| 成本显示语义变化（用户习惯 0） | README 注明数据来源 |
| TransformStream 性能开销 | 仅行缓冲 + 正则，无额外拷贝；遥测行集中在尾部 |
| 真实会话冒烟依赖 live key | 保留为可选人工验证（4.2），不进 CI |

## 与既有代码关系

- src/index.ts :97-103 stream/streamSimple 包装改为注入 usage-telemetry。
- 新增 src/tools/usage-telemetry.ts + 2 个新测试文件。
- 禁改文件（既有约束沿用）：src/auth.ts、src/auth-credentials.ts、src/tools/http.ts、test/lazy-fetch.test.ts、test/auth-credentials.test.ts、test/url.test.ts、test/tools-*.test.ts。
- 无新依赖。

## 开放问题

- diagnostics 是否会被未来 Pi 版本渲染到 UI？→ 已查当前版本无副作用；若未来渲染，type 前缀 omniroute-telemetry 便于过滤。
- 是否需要暴露 latencyMs/provider/model 给用户？→ 本变更仅 cost.total + diagnostics，其余留 phase 4。

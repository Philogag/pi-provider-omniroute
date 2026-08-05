# superpower-design：add-search-fetch-tools 深度技术设计

> 变更：`add-search-fetch-tools`（`openspec/changes/add-search-fetch-tools/`）
> 需求事实源：`proposal.md` / `design.md` / `specs/web-search-tool/spec.md` / `specs/web-fetch-tool/spec.md`
> 本文件只做实现层设计，不重定义需求。OpenSpec 为准。

## 1. 范围与目标

将 OmniRoute 的 `POST /v1/search` 与 `POST /v1/web/fetch` 封装为 pi function tool（`omniroute_web_search`、`omniroute_web_fetch`），复用现有 omniroute 凭据体系，纯增量，无新增运行时依赖。

**本次头脑风暴确认的补充决策（不在原 OpenSpec 中）：**
- 工具**默认启用**，**不提供** `promptSnippet` / `promptGuidelines`（保持系统提示精简）。
- 所有返回给 agent 的**文案（描述、错误、截断提示）用英文**，与现有代码错误风格一致。
- 两个工具参数各增加工具自有字段 **`timeoutMs`（可选，默认 30000，钳制 1000–120000）**，**不进入请求体**，仅控制本地超时。

## 2. 模块结构与数据流

```
src/tools/http.ts       凭据解析 + HTTP 请求（唯一接触网络与凭据的模块）
src/tools/search.ts     omniroute_web_search（schema + 纯函数 + execute）
src/tools/web-fetch.ts  omniroute_web_fetch（schema + 纯函数 + execute）
src/index.ts            扩展工厂内注册两个工具
test/tools-http.test.ts
test/tools-search.test.ts
test/tools-web-fetch.test.ts
```

调用链（search 为例）：
```
LLM tool call
  → prepareArguments（trim query；URL/协议校验）
  → schema 校验（pi 运行时）
  → execute(params, signal, ctx)
      ├─ resolveApiKey(ctx) ──────────── 无 key → 英文指引，返回（不发请求）
      ├─ resolveBaseUrl(ctx)
      ├─ buildSearchBody(params) ─────── 剔除 timeoutMs，补齐默认值
      └─ omnirouteRequest("/search", body, { apiKey, baseUrl, signal, timeoutMs })
          ├─ ok      → formatSearchResults(json) → 返回文本
          ├─ !ok     → 按契约出错误文本
```

## 3. src/tools/http.ts 设计

### 3.1 `resolveBaseUrl(ctx: ExtensionContext): string`
优先级：
1. `ctx.model?.provider === "omniroute"` 时取 `ctx.model.baseUrl`（`toOmnirouteModel` 已把 provider baseUrl 写入模型）。
2. `process.env.OMNIROUTE_BASE_URL`。
3. `OMNIROUTE_DEFAULT_BASE_URL`（`http://localhost:20128/api/v1`，从 `src/auth.ts` 复用导出，不重复字面量）。

拼接时**剥离 baseUrl 尾斜杠**（`baseUrl.replace(/\/+$/, "")`）再拼路径，兼容 auth.ts 保留用户原始输入的策略。

### 3.2 `resolveApiKey(ctx): Promise<string | undefined>`
`ctx.modelRegistry.getApiKeyForProvider("omniroute")`。已核实 pi 实现：`try/catch` 包裹、失败返回 `undefined`、**不会触发登录弹窗**。无 key 时由工具层返回指引文案。

### 3.3 `omnirouteRequest(path, body, opts)`

```ts
type RequestOptions = {
  apiKey: string;          // 已由调用方解析
  baseUrl: string;
  signal?: AbortSignal;    // agent 中断信号
  timeoutMs: number;       // 已钳制
};

type OmnirouteResult =
  | { ok: true; text: string; json?: unknown }        // 2xx
  | { ok: false; status: number; message: string; cancelled?: boolean };
```

行为：
- URL：`${stripTrailingSlash(baseUrl)}${path}`（path 以 `/` 开头，如 `/search`、`/web/fetch`）。
- 请求头：`Authorization: Bearer <apiKey>`、`Content-Type: application/json`、`Accept: application/json`。
- **超时/中止组合**：优先 `AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])`（Node ≥20.3）；检测不到 `AbortSignal.any` 时回退为手动 `setTimeout` + `controller.abort()` 组合（`t.after`/`finally` 清理 timer）。`signal` 本身已 abort 时短路。
- **2xx**：读文本；`Content-Type` 含 json 或 `JSON.parse` 成功 → 附带 `json`，否则 `json` 置空（覆盖 `screenshot` 等非 JSON 形态）。
- **非 2xx**：尝试解析错误体（`error`/`message`/`detail` 字段），失败则仅状态码。消息格式（英文）：
  `OmniRoute /search failed: 429 (rate limited)`。
- **网络失败**（`TypeError: fetch failed`、`ECONNREFUSED`、DNS）：`{ ok: false, status: 0, message: "Cannot reach OmniRoute at <baseUrl>: <原因>" }`。
- **超时**：`{ ok: false, status: 0, message: "OmniRoute /search timed out after 30000ms" }`。
- **abort**（用户/agent 中断，`AbortError`）：`{ ok: false, status: 0, message: "cancelled", cancelled: true }` —— 工具层据此返回简短取消提示，**不抛未捕获异常**。

## 4. src/tools/search.ts 设计

### 4.1 参数 schema（TypeBox）
镜像 `v1SearchSchema` 全字段：`query`（必填 string，`minLength: 1`、`maxLength: 500`）、`provider`（14 项 enum）、`max_results`（int 1–100）、`search_type`（web|news）、`offset`（int ≥0）、`country`（≤2）、`language`（2–5）、`time_range`（6 项 enum）、`content`（嵌套对象）、`filters`（嵌套对象）、`synthesis`（嵌套对象）、`provider_options`（record）、`strict_filters`（boolean）+ 工具自有 `timeoutMs`（int 1000–120000）。
- 外层 `Type.Object({...}, { additionalProperties: false })`。
- 全部使用 `Type.Optional`，默认值由 `buildSearchBody` 显式补齐（不依赖 TypeBox `default` 的运行时行为）。
- **嵌套对象也设 `additionalProperties: false`**，与 `content`/`filters`/`synthesis` 的子结构一致。

### 4.2 `prepareArguments` 与执行前校验（双保险，不依赖 pi 运行时行为）
- `prepareArguments` 对 `query` 执行 `.trim()` 并返回新对象（供 schema `minLength: 1` 拒绝纯空白输入）。
- `execute` 首行做防御校验：`params.query.trim().length === 0` → 直接返回参数错误文本，**不发请求**。
- 这样无论 pi 运行时的 schema 校验管线如何表现，spec 场景"空 query 被拒绝，不得发出 HTTP 请求"均由本扩展自身保证，可单测断言 fetch 未被调用。

### 4.3 `buildSearchBody(params)`（纯函数，导出可测）
- 仅挑选服务端字段（`timeoutMs` 在此剔除）。
- 补齐默认：`max_results: 5`、`search_type: "web"`、`offset: 0`、`strict_filters: false`（与 spec 场景"最小参数请求"断言一致）。
- 数值字段保持 number（TypeBox 校验后类型已确定）。

### 4.4 `formatSearchResults(json)`（纯函数，导出可测）
- 输入：`omnirouteRequest` 的 `json`。
- `json.results` 为数组 → 逐条格式化为：
  ```
  1. <title>
     URL: <url>
     <snippet>
     (provider: <citation.provider>, published: <published_at>)
  ```
  （字段缺失时跳过对应行，绝不因缺字段抛错。）
- **截断策略：按结果条目边界**——先格式化全部条目，从前往后累加，直到追加下一条会超过 20 000 字符硬上限；截断后追加 `\n\n[truncated: N of M results shown]`。
- `results` 缺失/为空 → 回显 `query`（如响应中有）并降级返回截断后的原始 JSON 文本（`JSON.stringify(json).slice(0, 20000)`）。

### 4.5 工具定义
- `name: "omniroute_web_search"`、`label: "OmniRoute Web Search"`。
- `description`（英文，含关键用法）：示例：
  `Search the web or news via OmniRoute's configured search providers (Tavily, Brave, Exa, Serper, etc.). Returns ranked results with titles and URLs. Use for current events, fact lookup, and finding sources.`
- 无 `promptSnippet` / `promptGuidelines`（本次决策）。
- `execute(toolCallId, params, signal, onUpdate, ctx)`：
  1. `const apiKey = await resolveApiKey(ctx)`；`undefined` → 返回：
     `OmniRoute API key is not configured. Run /login omniroute or set OMNIROUTE_API_KEY.`（不发请求）。
  2. `buildSearchBody(params)`、`resolveBaseUrl(ctx)`。
  3. `omnirouteRequest("/search", body, { apiKey, baseUrl, signal, timeoutMs })`。
  4. 按 `OmnirouteResult` 判别映射为 `AgentToolResult` 的 `content: [{ type: "text", text }]`；`cancelled` → `"Search cancelled."`。

## 5. src/tools/web-fetch.ts 设计

### 5.1 参数 schema（TypeBox）
镜像 `v1WebFetchSchema`：`url`（必填 string）、`provider`（firecrawl|jina-reader|tavily-search|tinyfish）、`format`（markdown|html|links|screenshot）、`depth`（0|1|2）、`wait_for_selector`（≤256）、`include_metadata`（boolean）+ `timeoutMs`。外层 `additionalProperties: false`。

### 5.2 URL 校验在 `execute` 内确定性执行
pi 运行时不做 typebox `format` 校验（已核实 dist 中无 `Value.Check` 路径），**不依赖 format 注册**。在 `execute` 首行手动校验：
```ts
let u: URL;
try { u = new URL(params.url); } catch { return { ok: false, error: "url must be a valid http(s) URL" }; }
if (u.protocol !== "http:" && u.protocol !== "https:") { return { ok: false, error: "url must be an http(s) URL" }; }
```
校验失败 → 返回错误文本且**不发请求**（满足 spec"非法 URL 被拒绝"场景，单测断言 fetch 未被调用）。非法 `provider` 由 enum schema 拒绝（无需手写）。

### 5.3 `buildFetchBody(params)`
补齐默认：`format: "markdown"`、`depth: 0`、`include_metadata: false`；剔除 `timeoutMs`。

### 5.4 `extractFetchContent(json)`（纯函数，导出可测）
- 按优先级提取字符串正文：`content`（若为 string）→ `content.markdown`/`content.text`（若为对象）→ `markdown` → `html` → `text`。
- 截断：> 40 000 字符时 `slice(0, 40000)` 并追加 `\n\n[content truncated at 40000 chars]`。
- 无任何可提取字段 → 降级返回 `JSON.stringify(json).slice(0, 40000)`（覆盖 spec"返回可读提示而非空白"——raw JSON 即非空可读兜底）。

### 5.5 工具定义
- `name: "omniroute_web_fetch"`、`label: "OmniRoute Web Fetch"`。
- `description`（英文）示例：
  `Fetch and extract content from a URL via OmniRoute's configured web-fetch providers (Firecrawl, Jina Reader, Tavily Extract, TinyFish). Returns the page content as markdown by default.`
- `execute` 流程与 search 一致（路径 `/web/fetch`）。

## 6. src/index.ts 集成

- `import { searchTool } from "./tools/search.ts"`、`import { webFetchTool } from "./tools/web-fetch.ts"`。
- 工具定义用 `defineTool()` 包裹以保留参数类型推断（pi 官方推荐）。
- 扩展工厂内、`registerProvider` 之后调用 `pi.registerTool(searchTool)` / `pi.registerTool(webFetchTool)`。
- 工具注册失败不得阻断 provider 注册（`try/catch` 包住注册调用并 `console.warn`，保证旧功能不回归）。

## 7. 测试策略（node:test，`npm test` 已启用 `--experimental-strip-types`）

**通用手法**：
- mock 网络：`globalThis.fetch = async (url, init) => new Response(body, { status, headers })`，`t.after` 还原原 fetch；断言请求用捕获的 `(url, init)`。
- 假 ctx：`{ modelRegistry: { getApiKeyForProvider: async () => "test-key" } } as unknown as ExtensionContext`；无 key 场景返回 `undefined`。
- 超时测试：`timeoutMs: 10` + fetch 桩挂起，断言消息含 `timed out`。
- abort 测试：`AbortController` 在请求前 `abort()`，断言 `cancelled` 分支。

**spec 场景 ↔ 测试映射（写入 tasks 引用）：**

| spec 场景 | 测试位置 |
|---|---|
| search：空 query 拒绝 | tools-search：断言返回错误且 fetch 未被调用（execute 防御校验分支） |
| fetch：非法 URL 拒绝 | tools-web-fetch：断言返回错误且 fetch 未被调用（execute 内 `new URL` 校验） |
| search：请求路径正确 / Content-Type | tools-search：断言 fetch 收到 `/search` POST + JSON 头 |
| search：最小参数请求体 | tools-search：断言 body 含补齐默认值 |
| search：Bearer 头 | tools-http：断言 `Authorization: Bearer test-key` |
| search：无 key 指引 | tools-search：无 key ctx + 断言 fetch 未调用、文本含 login |
| search：返回结果列表 | tools-search：mock 3 条 results，断言文本含 3 条标题与 URL |
| search：超长截断 | tools-search：生成超 20k 的 results，断言条目边界截断 + 提示 |
| search：429 透传 | tools-search：mock 429，断言文本含 `429` |
| search：服务不可达 | tools-http / tools-search：fetch 抛 TypeError，断言 `Cannot reach` |
| fetch：最小参数请求体 | tools-web-fetch：断言 body 默认值 |
| fetch：非法 provider 拒绝 | tools-web-fetch：断言返回错误且 fetch 未调用（enum schema 拒绝） |
| fetch：成功返回正文 | tools-web-fetch：mock 含 markdown 的响应，断言正文出现 |
| fetch：正文超长截断 | tools-web-fetch：mock 超 40k，断言截断提示 |
| fetch：401 透传 | tools-web-fetch：mock 401，断言文本含 `401` |
| fetch：服务不可达 | tools-web-fetch：同 search 模式 |

**纯函数单测**（无网络）：`buildSearchBody` / `buildFetchBody` 默认值与字段剔除；`formatSearchResults` 条目边界截断与 raw 兜底；`extractFetchContent` 字段优先级与兜底。

**类型与回归**：`npm run typecheck`（strict，参考 `tsconfig.json`）；现有 `test/auth*.test.ts`、`test/lazy-fetch.test.ts`、`test/url.test.ts` 全部保持通过。

## 8. 边界条件与风险

| 风险 | 缓解 |
|---|---|
| 响应形状未经验证（本地无服务端、OpenAPI v3.8.50 未覆盖） | 防御式字段提取 + raw JSON 兜底；`formatSearchResults`/`extractFetchContent` 对缺字段不抛错；tasks 保留 4.4 真实服务端验证项 |
| `screenshot` 格式 2xx 但非 JSON | 2xx 分支 JSON.parse 失败 → `json` 置空 → raw 文本兜底 |
| `AbortSignal.any` 在旧 Node 缺失 | 运行时特性检测，回退手动 timer 组合；`finally` 清理 timer |
| LLM 传超大/非法 `timeoutMs` | schema 钳制 1000–120000，越界由校验拒绝 |
| baseUrl 带尾斜杠或含自定义路径 | 拼接前剥离尾斜杠；复用 auth.ts 导出的默认常量 |
| 超大响应体撑爆内存/上下文 | 截断硬上限（20k/40k）；读文本后仅 `slice` 输出，不在工具层整体格式化超限内容 |
| 工具注册失败影响现有 provider | 注册调用 try/catch + warn，失败不阻断 |
| 配额/成本（真实调用已配置 provider） | 工具描述明示"via OmniRoute's configured providers"；权限门控留待后续（OpenSpec 非目标） |

## 9. 与 OpenSpec 的衔接

- 本设计不修改 proposal / specs（已核对：方案与所有 spec 场景一致；`timeoutMs` 是工具自有参数、不改变请求契约，spec 未禁止额外参数）。
- 若实现中确认真实响应形状与提取逻辑偏差，**只回写 delta spec**（在对应 `specs/<cap>/spec.md` 增补场景），并在 tasks 4.4 验收后执行。
- 后续步骤：`/opsx-sp-plan` 生成实现计划（替代 writing-plans），再 `/opsx-apply`。

## 上下文

当前扩展（`pi-provider-omniroute`）仅注册一个 OpenAI 兼容 provider（`openai-completions`），提供聊天与模型列表能力。OmniRoute v3.9+ 服务端新增了两个 agent 级 Web 端点：

- `POST /api/v1/search` — 统一 Web/News 搜索（provider 抽象：Tavily、Brave、Exa、Serper 等），请求体由 `v1SearchSchema` 校验（已从 OmniRoute 源码 `src/shared/validation/schemas/apiV1.ts` 确认），支持缓存/合并（coalescing）。
- `POST /api/v1/web/fetch` — URL 内容抓取（Firecrawl、Jina Reader、Tavily Extract、TinyFish），请求体由 `v1WebFetchSchema` 校验，配额感知回退由服务端处理。

两个端点均使用 Bearer API key 认证（与 chat 端点一致）。扩展需把这些端点封装为 `pi.registerTool()` 工具，使 agent 获得 Web 搜索与抓取能力。约束：无新增运行时依赖（`@sinclair/typebox` 已在 dependencies）；测试不依赖本地 OmniRoute 实例（本机当前未运行，OpenAPI 文档为 v3.8.50，未覆盖新端点）。

## 目标 / 非目标

**目标：**
- 注册两个工具：`omniroute_web_search`、`omniroute_web_fetch`，参数严格镜像服务端 schema。
- 复用现有 omniroute 凭据体系（stored credential / `OMNIROUTE_API_KEY` env），请求自动携带 Bearer 头。
- 结构化的成功返回（搜索：结果列表；抓取：正文），超长截断防止撑爆上下文。
- 可读的错误返回（未配置 key、非 2xx、网络不可达），不抛出未捕获异常，尊重 abort signal。
- 单元可测：mock fetch，无需真实服务端。

**非目标：**
- 不封装 `GET /v1/search`（列出已配置 provider）与 `GET /v1/search/analytics`。
- 不做 roadmap Phase 2 的管理类工具（providers/keys/usage 等）。
- 不做工具级权限门控/成本确认 UI。
- 不改变现有 provider/聊天行为（纯增量）。

## 决策

### D1: 启动时注册工具（扩展工厂内）

在 `src/index.ts` 的扩展工厂中调用 `pi.registerTool()`，与 `pi.registerProvider()` 并列。pi 支持启动后任意时刻注册并在同会话立即生效。
**替代方案**：在 `session_start` 事件中注册 —— 复杂度更高且收益为零；启动注册更符合规范"扩展加载完成即可用"的要求。

### D2: `src/tools/` 目录 + 共享 HTTP 辅助

新增三个文件：
- `src/tools/http.ts` — 共享 `omnirouteRequest(path, body, opts)`：拼接 `${baseUrl}${path}`、注入 `Authorization: Bearer`、`Content-Type: application/json`、非 2xx 结构化错误、网络错误包装、透传 abort signal。
- `src/tools/search.ts` — `omniroute_web_search` 工具定义。
- `src/tools/web-fetch.ts` — `omniroute_web_fetch` 工具定义。

导出纯函数（`buildSearchBody`、`formatSearchResults`、`buildFetchBody`、`extractFetchContent`）便于无网络单测。
**替代方案**：单文件 `src/tools.ts` —— 当前规模可行，但 roadmap Phase 2/3 会持续增加工具，目录化可避免文件膨胀。

### D3: 凭据解析走 provider registry

key：`await ctx.modelRegistry.getApiKeyForProvider("omniroute")` —— 经 provider 的 auth 配置解析 stored credential 或 `OMNIROUTE_API_KEY`，与聊天请求同一来源。baseUrl 顺序：`ctx.model?.provider === "omniroute"` 时取 `ctx.model.baseUrl` → `process.env.OMNIROUTE_BASE_URL` → 默认 `http://localhost:20128/api/v1`。解析不到 key 时返回引导文案（`/login omniroute` 或设 env），不发请求。
**替代方案**：直接读 `process.env` —— 会漏掉 stored credential；重新实现 `resolve()` 对 ExtensionContext 的适配 —— 过度设计，`getApiKeyForProvider` 已覆盖。

### D4: TypeBox 参数 schema 镜像服务端

`search.ts` 参数与 `v1SearchSchema` 字段一一对应（query 必填；provider 枚举 14 项；max_results 1–100 默认 5；search_type/offset/country/language/time_range/content/filters/synthesis/provider_options/strict_filters），请求体显式补齐默认值。`web-fetch.ts` 参数与 `v1WebFetchSchema` 对应（url 必填且 http/https；provider 4 项枚举；format 默认 markdown；depth 0|1|2；wait_for_selector ≤256；include_metadata 默认 false）。两处均设 `additionalProperties: false`，防止 LLM 拼出服务端未知字段。
**替代方案**：只暴露最小子集（query/url/max_results）—— 服务端字段已全部可选且有默认，全量镜像成本低且提升可控性。

### D5: 响应处理与截断

搜索：解析 JSON，若含 `results` 数组则逐条格式化为 `标题 — URL`（含摘要与来源 provider），按结果边界截断，硬上限 20 000 字符。抓取：优先提取 `content` / `markdown` / `html` / `text` 字段文本，硬上限 40 000 字符。两者均防御性降级：字段缺失时返回截断后的原始 JSON，避免"空白返回"。
**理由**：本地无运行中的服务端、OpenAPI 文档未覆盖新端点，响应形状无法在实现前逐字段确认；字段名基于 OmniRoute 源码约定（`searchResultSchema` 的 title/url/snippet、content），防御式提取可隔离未知变化。

### D6: 错误契约

- 无 key → `"OmniRoute 未配置 API key。请运行 /login omniroute 或设置 OMNIROUTE_API_KEY"`。
- 非 2xx → `"OmniRoute <path> failed: <status>"` + 可解析的响应体错误信息。
- 网络失败 → `"无法连接 OmniRoute (<baseUrl>): <原因>"`。
- abort → 返回取消提示，不抛错。

## 风险 / 权衡

- **[响应形状未经真实验证]** 本地无 OmniRoute 实例，`POST /v1/search` / `POST /v1/web/fetch` 的响应 JSON 结构未确认 → 防御式字段提取 + 原始 JSON 兜底；tasks 中列入"连接真实服务端验证响应形状"的可选验收项。
- **[截断切断引用]** 超长结果可能切断 citation → 搜索按结果条目边界截断而非裸字符，硬上限兜底并显式提示截断。
- **[配额/成本]** 工具会真实调用已配置的搜索/抓取 provider，产生用量 → 工具描述中明示"调用 OmniRoute 已配置 provider"；权限门控留待后续。
- **[模型缺失]** agent 使用非 omniroute 模型时 `ctx.model` 无 baseUrl → baseUrl 回退链（env → 默认值）保证请求仍可达。
- **[getApiKeyForProvider 未配置时返回 undefined]** 不会触发登录弹窗（返回 `Promise<string | undefined>`），符合规范"无 key 给指引"场景。

## 迁移计划

纯增量：新增 `src/tools/*`，`src/index.ts` 追加两行注册调用。部署 = 重载扩展（`/reload` 或重启 pi）。回滚 = 移除注册调用，无状态迁移、无数据变更。

## 未决问题

- `POST /v1/search` 与 `POST /v1/web/fetch` 的精确响应 JSON 形状（待连接真实服务端确认；实现采用防御式提取）。
- `format: "screenshot"` 的返回形态（二进制/URL/JSON）未确认 —— 实现时若不可提取则降级为原始 JSON 返回。

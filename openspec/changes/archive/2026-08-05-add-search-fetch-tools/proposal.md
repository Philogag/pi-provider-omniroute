## 为什么

OmniRoute（v3.9+）提供了两个 agent 级 Web 能力端点：`POST /v1/search`（统一搜索，支持 Tavily / Brave / Exa / Serper 等提供商）与 `POST /v1/web/fetch`（URL 内容抓取，支持 Firecrawl / Jina Reader / Tavily Extract / TinyFish）。当前扩展只注册了 chat provider，agent 无法搜索网页或读取页面内容。把这些端点封装为 `pi.registerTool()` 工具，agent 即可通过同一 OmniRoute Bearer key 获得原生 Web 搜索与抓取能力，provider 抽象、缓存、配额感知回退均由服务端处理。

## 变更内容

- 新增 `src/tools/` 模块，注册两个 function tool：
  - `omniroute_web_search`：封装 `POST /v1/search`，参数镜像 `v1SearchSchema`（query 必填，provider / max_results / search_type / offset / country / language / time_range / content / filters / synthesis / provider_options / strict_filters 可选），返回格式化搜索结果。
  - `omniroute_web_fetch`：封装 `POST /v1/web/fetch`，参数镜像 `v1WebFetchSchema`（url 必填，provider / format / depth / wait_for_selector / include_metadata 可选），返回抓取到的页面内容。
- 扩展入口 `src/index.ts` 在启动时注册这两个工具。
- 认证复用现有 omniroute provider 凭据（stored credential / `OMNIROUTE_API_KEY` env），通过 `ctx.modelRegistry.getApiKeyForProvider("omniroute")` 解析；baseUrl 优先取当前模型 / env `OMNIROUTE_BASE_URL` / 默认值。
- 错误处理：未配置 key 时返回指引用户 `/login omniroute` 的提示；服务端非 2xx 时透传状态码与服务端错误信息。

## 功能 (Capabilities)

### 新增功能
- `web-search-tool`: agent 可通过 `omniroute_web_search` 工具发起 Web / News 搜索并获取带来源引用的结果列表。
- `web-fetch-tool`: agent 可通过 `omniroute_web_fetch` 工具抓取指定 URL 的内容（markdown/html/links/screenshot 等格式）。

### 修改功能
<!-- 无 -- 现有规范 api-token-login 的行为不变 -->

## 影响

- 代码：新增 `src/tools/search.ts`、`src/tools/web-fetch.ts`（及共享 HTTP 辅助），`src/index.ts` 注册入口。
- 测试：新增 `test/tools-*.test.ts`（mock fetch，不依赖本地 OmniRoute 实例）。
- 依赖：无新增（`@sinclair/typebox` 已在 dependencies 中）。
- 系统：需要 OmniRoute ≥ v3.9 且配置了至少一个 search/web-fetch provider；未配置时工具返回明确的错误提示。

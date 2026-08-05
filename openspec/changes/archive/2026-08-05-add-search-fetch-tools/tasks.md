## 1. 共享 HTTP 与凭据辅助（src/tools/http.ts）

- [x] 1.1 实现并单测 `resolveBaseUrl(ctx)`：当前模型 baseUrl（omniroute provider）→ env `OMNIROUTE_BASE_URL` → 默认 `http://localhost:20128/api/v1`（test/tools-http.test.ts，含非 omniroute 模型回退与 env 清理）
- [x] 1.2 实现并单测 `resolveApiKey(ctx)`：`ctx.modelRegistry.getApiKeyForProvider("omniroute")`，无 key 返回 `undefined` 而非抛错
- [x] 1.3 实现并单测 `omnirouteRequest(path, body, opts)`：尾斜杠剥离、Bearer + JSON 头、2xx JSON 解析、非 2xx 结构化错误（含服务端错误体）、网络失败 `Cannot reach OmniRoute at <baseUrl>`、超时 `timed out after <ms>`（AbortSignal.any 组合，旧 Node 手动 timer 回退）、用户 abort → `cancelled: true`（不抛未捕获异常）

## 2. 搜索工具（src/tools/search.ts）

- [x] 2.1 实现并单测参数 schema（TypeBox 镜像 `v1SearchSchema`，嵌套对象亦 `additionalProperties: false`）与 `buildSearchBody(params)`：补齐 `max_results: 5` / `search_type: "web"` / `offset: 0` / `strict_filters: false`，`timeoutMs` 剔除不出现在请求体
- [x] 2.2 实现并单测 `formatSearchResults(json, query)`：`results[]` 按"标题 / URL / snippet"格式化，**按结果条目边界**截断（硬上限 20 000 字符 + `[truncated: N of M results omitted]` 提示），缺失字段不抛错，无 `results` 时降级为截断原始 JSON
- [x] 2.3 实现 `omniroute_web_search` 工具定义（`defineTool`）：`prepareArguments` trim query；execute 防御校验（空 query 拒绝、无 key 返回 `/login omniroute` 指引，均不发请求）；经 `omnirouteRequest("/search", ...)` 调用并映射 `OmnirouteResult` → 文本
- [x] 2.4 编写 execute 集成测试（mock fetch + 假 ctx）：最小参数请求体、空/纯空白 query 拒绝（断言 fetch 未调用）、无 key 不发请求、成功格式化、429 透传、`timeoutMs` 不进请求体

## 3. 抓取工具（src/tools/web-fetch.ts）

- [x] 3.1 实现并单测参数 schema（TypeBox 镜像 `v1WebFetchSchema`）与 `buildFetchBody(params)`：补齐 `format: "markdown"` / `depth: 0` / `include_metadata: false`，`timeoutMs` 剔除
- [x] 3.2 实现并单测 `extractFetchContent(json)`：按 `content`(string) → `content.markdown/text` → `markdown` → `html` → `text` 顺序提取，硬上限 40 000 字符 + 截断提示，无可提取字段时降级为截断原始 JSON
- [x] 3.3 实现 `omniroute_web_fetch` 工具定义（`defineTool`）：execute 内 `new URL()` + http(s) 协议校验（非法 URL / 非 http(s) 拒绝且不发请求）、无 key 指引、经 `omnirouteRequest("/web/fetch", ...)` 调用
- [x] 3.4 编写 execute 集成测试（mock fetch + 假 ctx）：非法 URL 与非法 provider 拒绝（断言 fetch 未调用）、成功返回正文、默认值补齐、401 透传、无 key 不发请求

## 4. 注册与集成验证

- [x] 4.1 `src/index.ts` 扩展工厂内注册 `omniroute_web_search` 与 `omniroute_web_fetch`（try/catch + warn，不阻断 provider 注册）
- [x] 4.2 `test/lazy-fetch.test.ts` 的 `mockPi()` 增加 `registerTool` 桩，并断言扩展工厂注册两个工具不抛错
- [x] 4.3 运行 `npm test` 与 `npm run typecheck` 全部通过（既有 auth/url/lazy-fetch + 三个新测试文件）
- [x] 4.4 更新 `docs/roadmap.md`：标记 Web 搜索/抓取工具已实现（端点 `/api/v1/search`、`/api/v1/web/fetch` 与工具名）
- [ ] 4.5 （可选）若本地 OmniRoute（≥ v3.9）可用：连接真实服务端验证 `POST /v1/search` 与 `POST /v1/web/fetch` 的响应 JSON 形状，必要时回填 `formatSearchResults` / `extractFetchContent` 的字段提取（若有偏差仅回写 delta spec）

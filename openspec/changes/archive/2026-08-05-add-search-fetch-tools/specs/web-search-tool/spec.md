## 新增需求

### 需求:注册 `omniroute_web_search` 工具

扩展在启动时必须通过 `pi.registerTool()` 注册名为 `omniroute_web_search` 的工具，工具执行时向 `${baseUrl}/search` 发起 `POST` 请求（baseUrl 为 omniroute provider 的 baseUrl，如 `http://localhost:20128/api/v1`）。工具描述必须说明其用途为"通过 OmniRoute 执行 Web / News 搜索"。

#### 场景:扩展启动后工具可用
- **当** 扩展加载完成
- **那么** `omniroute_web_search` 工具必须已注册，且 pi 的 `getAllTools()` 中可找到该工具

#### 场景:请求路径正确
- **当** 工具以 baseUrl `http://localhost:20128/api/v1` 执行搜索
- **那么** 发出的请求必须是 `POST http://localhost:20128/api/v1/search`，`Content-Type: application/json`

### 需求:搜索参数 schema 镜像 v1SearchSchema

工具参数必须使用 TypeBox 定义：`query` 为必填字符串（去空白后 1–500 字符）；`provider` 为可选枚举（serper-search、brave-search、perplexity-search、exa-search、tavily-search、firecrawl、google-pse-search、linkup-search、ollama-search、searchapi-search、youcom-search、searxng-search、zai-search、duckduckgo-free）；`max_results` 可选整数 1–100 默认 5；`search_type` 可选枚举（web、news）默认 web；`offset` 可选整数 ≥0 默认 0；`country`、`language`、`time_range`、`content`、`filters`、`synthesis`、`provider_options`、`strict_filters` 均按 v1SearchSchema 定义为可选字段。

#### 场景:最小参数请求
- **当** 仅提供 `query: "pi agent"` 执行搜索
- **那么** 请求体必须为 `{ query: "pi agent", max_results: 5, search_type: "web", offset: 0, strict_filters: false }`（服务端默认值由工具端显式补齐）

#### 场景:空 query 被拒绝
- **当** 提供 `query: "   "`（仅空白）执行搜索
- **那么** 工具必须返回参数校验错误，不得发出 HTTP 请求

### 需求:搜索使用 omniroute 凭据认证

工具执行时必须通过 `ctx.modelRegistry.getApiKeyForProvider("omniroute")` 解析 API key，并在请求头携带 `Authorization: Bearer <key>`。baseUrl 解析顺序为：当前模型 baseUrl（当模型属于 omniroute provider）→ env `OMNIROUTE_BASE_URL` → 默认值 `http://localhost:20128/api/v1`。当解析不到 API key 时，工具必须返回错误信息并提示用户执行 `/login omniroute` 或设置 `OMNIROUTE_API_KEY`，不得发出请求。

#### 场景:已配置 key 时携带 Bearer
- **当** omniroute provider 已配置 API key，执行搜索
- **那么** 请求头必须包含 `Authorization: Bearer <key>`

#### 场景:未配置 key 时给出指引
- **当** 既无 stored credential 也无 `OMNIROUTE_API_KEY`，执行搜索
- **那么** 工具必须返回包含"登录"指引的错误文本，且不得发起任何 HTTP 请求

### 需求:搜索成功返回格式化结果

当服务端返回 2xx 时，工具必须解析 JSON 响应，提取搜索结果（标题、URL、摘要等），以结构化的纯文本返回给 agent，每条结果包含标题与来源 URL。

#### 场景:返回结果列表
- **当** `POST /v1/search` 返回 200 且响应含 3 条搜索结果
- **那么** 工具返回文本必须包含全部 3 条结果的标题与 URL，且不包含原始 JSON 之外的结构

#### 场景:结果超长时截断
- **当** 服务端返回的结果正文超过预设上限（如 20 000 字符）
- **那么** 工具返回文本必须被截断至上限，并附加说明截断发生的提示

### 需求:搜索错误透传与降级

当服务端返回非 2xx 状态码时，工具必须返回包含 HTTP 状态码的文本；当网络层失败（连接拒绝、超时、DNS 错误）时，工具必须返回可读的错误文本并说明 omniroute 服务不可达。工具执行期间必须响应 abort signal，中断时停止请求并返回取消结果。

#### 场景:服务端返回 429
- **当** `POST /v1/search` 返回 429
- **那么** 工具返回文本必须包含 `429` 状态码

#### 场景:服务不可达
- **当** 请求因连接拒绝而失败
- **那么** 工具必须返回包含"无法连接"/"不可达"语义的错误文本，不得抛出未捕获异常

## 修改需求
<!-- 无修改 -->

## 移除需求
<!-- 无移除 -->

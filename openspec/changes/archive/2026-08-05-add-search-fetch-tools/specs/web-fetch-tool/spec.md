## 新增需求

### 需求:注册 `omniroute_web_fetch` 工具

扩展在启动时必须通过 `pi.registerTool()` 注册名为 `omniroute_web_fetch` 的工具，工具执行时向 `${baseUrl}/web/fetch` 发起 `POST` 请求。工具描述必须说明其用途为"通过 OmniRoute 抓取/提取指定 URL 的页面内容"。

#### 场景:扩展启动后工具可用
- **当** 扩展加载完成
- **那么** `omniroute_web_fetch` 工具必须已注册，且 pi 的 `getAllTools()` 中可找到该工具

#### 场景:请求路径正确
- **当** 工具以 baseUrl `http://localhost:20128/api/v1` 执行抓取
- **那么** 发出的请求必须是 `POST http://localhost:20128/api/v1/web/fetch`，`Content-Type: application/json`

### 需求:抓取参数 schema 镜像 v1WebFetchSchema

工具参数必须使用 TypeBox 定义：`url` 为必填字符串且必须是有效的 http/https URL；`provider` 为可选枚举（firecrawl、jina-reader、tavily-search、tinyfish）；`format` 为可选枚举（markdown、html、links、screenshot）默认 markdown；`depth` 为可选 0|1|2 默认 0；`wait_for_selector` 为可选字符串（≤256 字符）；`include_metadata` 为可选布尔默认 false。

#### 场景:最小参数请求
- **当** 仅提供 `url: "https://example.com"` 执行抓取
- **那么** 请求体必须为 `{ url: "https://example.com", format: "markdown", depth: 0, include_metadata: false }`

#### 场景:非法 URL 被拒绝
- **当** 提供 `url: "not-a-url"` 执行抓取
- **那么** 工具必须返回参数校验错误，不得发出 HTTP 请求

#### 场景:非法 provider 被拒绝
- **当** 提供 `provider: "unknown-provider"` 执行抓取
- **那么** 工具必须返回参数校验错误，不得发出 HTTP 请求

### 需求:抓取使用 omniroute 凭据认证

工具执行时必须通过 `ctx.modelRegistry.getApiKeyForProvider("omniroute")` 解析 API key，并在请求头携带 `Authorization: Bearer <key>`。baseUrl 解析顺序与 `omniroute_web_search` 一致（当前模型 → env `OMNIROUTE_BASE_URL` → 默认值）。当解析不到 API key 时，工具必须返回错误信息并提示用户执行 `/login omniroute` 或设置 `OMNIROUTE_API_KEY`，不得发出请求。

#### 场景:已配置 key 时携带 Bearer
- **当** omniroute provider 已配置 API key，执行抓取
- **那么** 请求头必须包含 `Authorization: Bearer <key>`

#### 场景:未配置 key 时给出指引
- **当** 既无 stored credential 也无 `OMNIROUTE_API_KEY`，执行抓取
- **那么** 工具必须返回包含"登录"指引的错误文本，且不得发起任何 HTTP 请求

### 需求:抓取成功返回页面内容

当服务端返回 2xx 时，工具必须解析 JSON 响应，优先提取正文内容字段（markdown/html/text）返回给 agent；当返回内容为空或响应缺少内容字段时，必须返回可读的提示文本而非空白。

#### 场景:返回抓取正文
- **当** `POST /v1/web/fetch` 返回 200 且响应含 markdown 正文
- **那么** 工具返回文本必须包含该正文内容

#### 场景:正文超长时截断
- **当** 返回正文超过预设上限（如 40 000 字符）
- **那么** 工具返回文本必须被截断至上限，并附加说明截断发生的提示

### 需求:抓取错误透传与降级

当服务端返回非 2xx 状态码时，工具必须返回包含 HTTP 状态码的文本；当网络层失败时，工具必须返回可读的错误文本并说明 omniroute 服务不可达。工具执行期间必须响应 abort signal，中断时停止请求并返回取消结果。

#### 场景:服务端返回 401
- **当** `POST /v1/web/fetch` 返回 401
- **那么** 工具返回文本必须包含 `401` 状态码

#### 场景:服务不可达
- **当** 请求因连接拒绝而失败
- **那么** 工具必须返回包含"无法连接"/"不可达"语义的错误文本，不得抛出未捕获异常

## 修改需求
<!-- 无修改 -->

## 移除需求
<!-- 无移除 -->

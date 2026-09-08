## Purpose

定义 `/omniroute-settings` 在未配置 API key（未登录）时即可使用的契约：新用户从零接入 OmniRoute 的流程是先在设置菜单里配置 Base URL（及可选的 web-fetch / search provider 默认值），再执行 `/login omniroute`；设置菜单不得因缺少 API key 而拒绝打开，搜索 provider 目录拉取在无 key 时必须优雅降级而非阻塞或卡死。

## 新增需求
### 需求:设置菜单无需 API key 即可打开

系统必须在 TUI 模式下响应 `/omniroute-settings` 并呈现一级设置菜单，无论是否已配置 API key；菜单不得因缺少 API key 而提前退出或提示错误。菜单中 "Base URL" 编辑项与 "Web Fetch provider" 选择项必须在未登录时可用：用户应能在登录前修改并持久化 Base URL 与默认 provider 配置。系统不得把缺少 API key 视为使用设置菜单的前置条件。

#### 场景:未登录时打开设置菜单并配置 Base URL

- **当** 用户尚未配置 API key（未登录）时在 TUI 模式输入 `/omniroute-settings`
- **那么** 系统呈现一级设置菜单且不提示 API key 错误，用户可激活 Base URL 编辑项并提交新值，配置被持久化且返回顶层菜单

#### 场景:未登录时选择 Web Fetch provider

- **当** 用户未登录且在设置菜单中激活 "Web Fetch provider" 项
- **那么** 系统呈现静态 provider 选择面板（auto/firecrawl/jina-reader/tavily-search/tinyfish），用户的选择被持久化

#### 场景:登录前 baseUrl 变更后的模型刷新不打断设置流程

- **当** 用户未登录时在设置菜单提交新的 Base URL
- **那么** 系统 best-effort 触发模型刷新；刷新失败或缺 key 不得报错、不得中断设置菜单流程（模型在登录后的会话中刷新）

### 需求:未配置 key 时搜索 provider 目录拉取的降级

系统在未配置 API key 时激活 "Search provider" 项，必须尝试拉取 provider 目录，但请求不得携带伪造的认证头（不得发送如 `Bearer undefined` 的字面量）。拉取成功（如开放网关）时按响应呈现选项；端点返回 401/5xx/网络异常时按既有目录回退契约呈现内置静态列表与提示。系统不得因缺少 API key 停留在无限加载状态。

#### 场景:无 key 且网关开放时目录正常加载

- **当** 用户未登录、目标网关对 `GET ${baseUrl}/search` 不要求认证，用户激活 "Search provider" 项
- **那么** 系统发出的目录请求不含 `Authorization` 头，且按网关返回的 `data` 呈现 provider 选项

#### 场景:无 key 且网关要求认证时静态回退

- **当** 用户未登录、目标网关对 `GET ${baseUrl}/search` 返回 401，用户激活 "Search provider" 项
- **那么** 系统呈现内置静态 provider 列表并在面板中提示 "OmniRoute search catalog unreachable, using built-in list"

#### 场景:无 key 时不得无限加载

- **当** 用户未登录且目录拉取未产生结果
- **那么** 系统最终呈现静态回退列表或允许用户返回顶层菜单，不得停留在 "Loading search providers…" 的永久加载界面

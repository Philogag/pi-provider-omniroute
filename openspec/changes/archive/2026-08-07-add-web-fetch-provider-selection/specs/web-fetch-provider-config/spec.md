# Web Fetch Provider Config

## 新增需求

### 需求:`/omniroute-settings` 顶层菜单包含 Web Fetch provider 项
`/omniroute-settings` 顶层设置菜单必须至少包含两个可激活项："Search provider" 与 "Web Fetch provider"；"Web Fetch provider" 行必须显示当前 web-fetch provider 配置值预览（provider id / "Auto" / "未配置"）；菜单支持上下键导航、Enter 激活、Esc 关闭；顶层菜单必须渲染外边框以凸显设置工作区。

#### 场景:顶层菜单显示 Web Fetch provider 项
- **当** 用户在 TUI 模式下输入 `/omniroute-settings`
- **那么** 顶层菜单必须呈现 "Web Fetch provider" 项，行尾显示当前 web-fetch provider 配置值预览（例如 `Web Fetch provider: firecrawl` / `Web Fetch provider: Auto` / `Web Fetch provider: 未配置`）

#### 场景:顶层菜单渲染外边框
- **当** 顶层菜单在 TUI 中呈现
- **那么** 菜单内容必须被外边框包围（顶行 `┌─...─┐`、底行 `└─...┘`、内容行 `│` 前缀），边框宽度匹配菜单内容宽度

#### 场景:用户激活 Web Fetch provider 项
- **当** 顶层菜单中 "Web Fetch provider" 项被激活（Enter）
- **那么** 扩展必须切换到 web-fetch provider 二级配置面板，呈现 provider 选择列表

#### 场景:用户在顶层菜单按 Esc
- **当** 顶层菜单获得 Esc 输入
- **那么** 扩展必须关闭菜单，不修改任何配置

### 需求:Web Fetch provider 二级选择面板的选项与选择行为
web-fetch provider 面板必须为设置列表，列表首项固定为 `auto`（label "Auto (follow server default)"），其后按静态 `FETCH_PROVIDERS` 顺序（firecrawl、jina-reader、tavily-search、tinyfish）呈现 provider 选项；面板必须渲染外边框；面板行内只显示 label 列，不得显示 value 列；当前启用的 provider（`auto` 视为未配置即启用态）必须在行首显示 `✓` 标记；用户选择某 provider 或 `auto` 后，扩展必须立即将选择写入 pi 全局配置文件，并返回顶层菜单（更新值预览）。

#### 场景:二级面板渲染外边框
- **当** web-fetch provider 面板在 TUI 中呈现
- **那么** 面板内容必须被外边框包围（顶行 `┌─...─┐`、底行 `└─...┘`、内容行 `│` 前缀）

#### 场景:二级面板显示静态 provider 列表
- **当** web-fetch provider 面板呈现选项行
- **那么** 首项必须为 `auto`（label "Auto (follow server default)"），其后依次为 firecrawl、jina-reader、tavily-search、tinyfish，共 5 行

#### 场景:二级面板不显示 value 列
- **当** web-fetch provider 面板呈现 provider 选项行
- **那么** 每行只包含 label 文本，行尾不得出现 `currentValue` 值（如 `auto` / provider id 不得作为行尾第二列显示）

#### 场景:当前启用项显示勾符号
- **当** web-fetch provider 面板呈现时当前配置为 `firecrawl`
- **那么** `firecrawl` 行首必须显示 `✓` 标记，其余行不得显示

#### 场景:未配置时 auto 项显示勾符号
- **当** web-fetch provider 面板呈现时当前配置未配置（或为 `auto`）
- **那么** `auto` 项（label "Auto (follow server default)"）行首必须显示 `✓` 标记，其余行不得显示

#### 场景:用户在二级面板选择具体 provider
- **当** 用户将 web-fetch provider 面板中 `jina-reader` 项激活（Enter）
- **那么** 扩展必须将 `omniroute.json` 的 `fetch.provider` 字段写为 `"jina-reader"`，并返回顶层菜单（"Web Fetch provider" 行预览更新为 `jina-reader`）

#### 场景:用户在二级面板选择 auto
- **当** 用户将 web-fetch provider 面板中 `auto` 项激活（Enter）
- **那么** 扩展必须将 `omniroute.json` 的 `fetch.provider` 字段写为 `undefined`（或完全移除 `fetch` 键），并返回顶层菜单（"Web Fetch provider" 行预览更新为 `Auto`）

#### 场景:用户在二级面板按 Esc
- **当** web-fetch provider 面板获得 Esc 输入
- **那么** 扩展必须返回顶层菜单，不修改 `omniroute.json`

### 需求:Web Fetch provider 配置持久化到 pi 全局 `omniroute.json`
扩展必须将 web-fetch provider 选择持久化到独立文件 `${PI_AGENT_DIR || ~/.pi/agent}/omniroute.json`。文件根对象字段路径为 `fetch.provider`（值类型 `string`；`undefined` 或缺失 / 等于 `"auto"` 语义等价）。写入必须保留根对象中其他字段（含既有 `search` 分支）；文件不存在时写入必须自动创建；写入失败时扩展必须仅 `console.warn` 不抛错。读取必须容错：根对象非对象 / `fetch` 非对象 / `fetch.provider` 类型不符 / JSON 损坏时按无配置（auto）处理并 `console.warn` 一次。

#### 场景:写入选定 fetch provider
- **当** web-fetch provider 面板选定 `firecrawl`
- **那么** `omniroute.json` 必须包含 `{ fetch: { provider: "firecrawl" } }`；根对象其他字段（如既有 `search`）保持不变

#### 场景:写入 auto（清除 fetch provider）
- **当** web-fetch provider 面板选定 `auto`
- **那么** `omniroute.json` 根对象中 `fetch.provider` 必须为 `undefined`（`fetch` 键可整体移除），其他根字段保持不变

#### 场景:读取损坏的 fetch 配置
- **当** `omniroute.json` 根对象存在但 `fetch` 字段值是字符串 / 数字 / 数组 / `null`（非普通对象），或 `fetch.provider` 类型不符，或 JSON 损坏
- **那么** 扩展必须将当前 web-fetch provider 视为无配置（auto），仅 `console.warn` 一次，不抛错

#### 场景:写入失败不阻塞 UI
- **当** `omniroute.json` 写入因权限 / 磁盘错误失败
- **那么** 扩展必须仅 `console.warn` 记录错误，不抛出异常；用户仍可继续操作菜单

### 需求:`session_start` 时读取 Web Fetch provider 配置
扩展必须在 `session_start` 事件触发时，读取 `omniroute.json` 的 `fetch.provider` 字段并加载为当前生效的 `currentFetchProvider`；未找到字段 / 字段缺失 / 类型不符 / JSON 损坏 / 文件不存在时，必须将 `currentFetchProvider` 视为 `undefined`（等价 `auto`）；必须同时加载 `search.provider` 为 `currentConfigProvider`（两者互不影响）；不感知分支（不挂 `session_tree` 钩子）；不读取 `auth.json` 的任何字段。

#### 场景:session_start 加载已存在的 fetch provider
- **当** `omniroute.json` 存在且根对象 `fetch.provider === "firecrawl"`
- **那么** 扩展必须将 `currentFetchProvider` 设为 `"firecrawl"`，并在此后所有 web-fetch 工具调用中按合并优先级使用

#### 场景:session_start 无 fetch provider 配置
- **当** `omniroute.json` 不存在 / 根对象不是对象 / `fetch` 缺失 / `fetch.provider` 缺失或类型不符 / JSON 损坏
- **那么** 扩展必须将 `currentFetchProvider` 视为 `undefined`（等价 `auto`，工具请求不携带 `provider`）；同时 `search.provider` 的加载不受影响

### 需求:web-fetch 工具 execute 阶段三态合并 provider
`omniroute_web_fetch` 工具 `execute` 阶段必须按"显式入参 > 已配置 > 省略"三态合并 `provider` 字段：若 `params.provider` 已显式传入，则使用 `params.provider`；否则若 `currentFetchProvider` 不为 `undefined` 且不为字符串 `"auto"`，则使用 `currentFetchProvider`；否则请求体中不携带 `provider` 字段。TypeBox schema 层的入参校验保持不变（仍按静态 4 项字面量校验）。

#### 场景:显式入参覆盖配置
- **当** 工具调用 `params.provider === "tinyfish"`，且当前 `currentFetchProvider === "firecrawl"`
- **那么** 请求体中的 `provider` 字段必须为 `"tinyfish"`（显式入参优先）

#### 场景:配置为具体 provider 时注入
- **当** 工具调用 `params.provider === undefined`，且当前 `currentFetchProvider === "jina-reader"`
- **那么** 请求体中的 `provider` 字段必须为 `"jina-reader"`

#### 场景:配置为 auto 时省略
- **当** 工具调用 `params.provider === undefined`，且当前 `currentFetchProvider === "auto"`（或 `undefined`）
- **那么** 请求体中不得包含 `provider` 字段

#### 场景:配置不影响 search 工具
- **当** `omniroute.json` 中 `fetch.provider === "firecrawl"` 而 `search.provider` 未配置
- **那么** `omniroute_web_search` 请求体必须不携带 `provider`（fetch 配置不得泄漏到 search 工具）

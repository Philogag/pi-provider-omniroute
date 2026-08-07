# Web Search Provider Config

## 需求:`/omniroute-settings` 顶层设置菜单
扩展必须在 TUI 模式下注册 `/omniroute-settings` 命令；命令处理器必须呈现一个一级菜单（顶层菜单），菜单中至少包含一个可激活项 "Search provider"，并显示其当前配置值预览（provider id / "Auto" / "未配置"）；菜单支持上下键导航、Enter 激活、Esc 关闭；顶层菜单必须渲染外边框以凸显设置工作区。

#### 场景:用户在 TUI 模式下调起命令
- **当** 用户在 TUI 模式下输入 `/omniroute-settings`
- **那么** 扩展必须呈现一级菜单，菜单首项为 "Search provider"（行尾显示当前 provider 配置值预览，例如 `Search provider: tavily-search` / `Search provider: Auto` / `Search provider: 未配置`）

#### 场景:顶层菜单渲染外边框
- **当** 顶层菜单在 TUI 中呈现
- **那么** 菜单内容必须被外边框包围（顶行 `┌─...─┐`、底行 `└─...┘`、内容行 `│` 前缀），边框宽度匹配菜单内容宽度

#### 场景:用户激活 "Search provider" 项
- **当** 顶层菜单中 "Search provider" 项被激活（Enter）
- **那么** 扩展必须切换到二级配置面板，呈现 provider 选择列表

#### 场景:用户在顶层菜单按 Esc
- **当** 顶层菜单获得 Esc 输入
- **那么** 扩展必须关闭菜单，不修改任何配置

#### 场景:在非 TUI 模式下调用命令
- **当** 用户在非 TUI 模式（如 print / RPC）下调用 `/omniroute-settings`
- **那么** 扩展必须通过 `ctx.ui.notify` 提示用户 "/omniroute-settings requires TUI mode"，不进入菜单

## 需求:provider 目录从 OmniRoute `/v1/search` 拉取
二级 provider 面板渲染时，扩展必须调用 `GET ${baseUrl}/search` 获取 provider 目录，并按响应 `data` 数组中的 `id` / `name` / `search_types` 字段构建选项列表；端点返回非 2xx 或网络异常时，扩展必须回退到内置静态 `SEARCH_PROVIDERS` 列表（14 项）作为选项源。

#### 场景:provider 目录端点返回成功
- **当** `GET /v1/search` 返回 `200` 且 body 为 `{ object: "list", data: [{ id: "tavily-search", name: "Tavily", search_types: ["web","news"] }, ...] }`
- **那么** provider 面板必须按响应顺序呈现这些 provider 选项，每个选项的内部值为 provider id

#### 场景:provider 目录端点不可达时回退静态列表
- **当** `GET /v1/search` 返回 `401` / `5xx` 或网络异常
- **那么** provider 面板必须呈现内置静态 `SEARCH_PROVIDERS` 列表的 14 个 provider id；扩展必须在 TUI 状态栏提示用户 "OmniRoute search catalog unreachable, using built-in list"

## 需求:二级 provider 选择面板的选项与选择行为
provider 面板必须为设置列表，列表首项固定为 `auto`（label "Auto (follow server default)"），其后按目录 / 回退顺序呈现 provider 选项；面板必须渲染外边框；面板行内只显示 label 列，不得显示 value 列；当前启用的 provider（`auto` 视为未配置即启用态）必须在行首显示 `✓` 标记；用户选择某 provider 或 `auto` 后，扩展必须立即将选择写入 pi 全局配置文件，并返回顶层菜单（更新值预览）。

#### 场景:二级面板渲染外边框
- **当** 二级 provider 面板在 TUI 中呈现
- **那么** 面板内容必须被外边框包围（顶行 `┌─...─┐`、底行 `└─...┘`、内容行 `│` 前缀）

#### 场景:二级面板不显示 value 列
- **当** 二级面板呈现 provider 选项行
- **那么** 每行只包含 label 文本，行尾不得出现 `currentValue` 值（如 `auto` / provider id 不得作为行尾第二列显示）

#### 场景:当前启用项显示勾符号
- **当** 二级面板呈现时当前配置为 `tavily-search`
- **那么** `tavily-search` 行首必须显示 `✓` 标记，其余行不得显示

#### 场景:未配置时 auto 项显示勾符号
- **当** 二级面板呈现时当前配置未配置（或为 `auto`）
- **那么** `auto` 项（label "Auto (follow server default)"）行首必须显示 `✓` 标记，其余行不得显示

#### 场景:用户在二级面板选择具体 provider
- **当** 用户将 provider 面板中 `tavily-search` 项的值切换为 `tavily-search`
- **那么** 扩展必须将 `omniroute.json` 的 `search.provider` 字段写为 `"tavily-search"`，并返回顶层菜单（"Search provider" 行预览更新为 `tavily-search`）

#### 场景:用户在二级面板选择 auto
- **当** 用户将 provider 面板中 `auto` 项的值切换为 `auto`
- **那么** 扩展必须将 `omniroute.json` 的 `search.provider` 字段写为 `undefined`（或完全移除 `search` 键），并返回顶层菜单（"Search provider" 行预览更新为 `Auto`）

## 需求:配置持久化到 pi 全局 `omniroute.json`
扩展必须将会话级（用户级）的 provider 选择持久化到独立文件 `${PI_AGENT_DIR || ~/.pi/agent}/omniroute.json`（与 `auth.json` 解耦）。文件根对象为 omniroute 偏好对象，字段路径为 `search.provider`（值类型 `string`；`undefined` 或缺失 / 等于 `"auto"` 语义等价）。写入操作必须保留 `omniroute.json` 根对象中的其他字段（除 `search` 之外）以便未来扩展；文件不存在时写入必须自动创建；写入失败时扩展必须仅 `console.warn` 不抛错。

#### 场景:写入选定 provider
- **当** 二级面板选定 `tavily-search`
- **那么** `omniroute.json` 必须包含 `{ search: { provider: "tavily-search" } }`；其他根字段保持不变

#### 场景:写入 auto（清除 provider）
- **当** 二级面板选定 `auto`
- **那么** `omniroute.json` 根对象中 `search.provider` 必须为 `undefined`（`search` 键可整体移除），其他根字段保持不变

#### 场景:首次写入自动创建文件
- **当** `omniroute.json` 不存在且二级面板选定 provider
- **那么** 扩展必须创建 `omniroute.json` 并写入 `{ search: { provider: "<选定 id>" } }`；不读取 `auth.json` 内容

#### 场景:写入失败不阻塞 UI
- **当** `omniroute.json` 写入因权限 / 磁盘错误失败
- **那么** 扩展必须仅 `console.warn` 记录错误，不抛出异常；用户仍可继续操作菜单

#### 场景:omniroute.json 根对象为非对象类型
- **当** `omniroute.json` 根内容是 `null` / 数组 / 字符串 / 数字（非普通对象）
- **那么** `readOmnirouteConfig` 必须返回 `{}` 并 `console.warn` 一次；搜索工具必须按"无配置"（auto）行为

#### 场景:omniroute.json 的 search 字段为非对象类型
- **当** `omniroute.json` 根对象存在但 `search` 字段值是字符串 / 数字 / 数组 / `null`（非普通对象）
- **那么** `readOmnirouteConfig` 必须返回 `{}` 并 `console.warn` 一次；搜索工具必须按"无配置"（auto）行为

## 需求:`session_start` 时读取配置
扩展必须在 `session_start` 事件触发时，读取 `omniroute.json` 的 `search.provider` 字段并加载为当前生效的 `currentConfigProvider`；未找到字段 / 字段缺失 / 类型不符 / JSON 损坏 / 文件不存在时，必须将 `currentConfigProvider` 视为 `undefined`（等价 `auto`）；不感知分支（不挂 `session_tree` 钩子）；不读取 `auth.json` 的任何字段。

#### 场景:session_start 加载已存在的 provider
- **当** `omniroute.json` 存在且根对象 `search.provider === "tavily-search"`
- **那么** 扩展必须将 `currentConfigProvider` 设为 `"tavily-search"`，并在此后所有搜索工具调用中按合并优先级使用

#### 场景:session_start 无 provider 配置
- **当** `omniroute.json` 不存在 / 根对象不是对象 / `search` 缺失 / `search.provider` 缺失或类型不符 / JSON 损坏
- **那么** 扩展必须将 `currentConfigProvider` 视为 `undefined`（等价 `auto`，工具请求不携带 `provider`）

#### 场景:session_start 不读取 auth.json
- **当** `auth.json` 含 `omniroute.search.provider` 但 `omniroute.json` 不存在
- **那么** 扩展必须将 `currentConfigProvider` 视为 `undefined`（auth.json 的 `omniroute` 键内容不参与配置加载）

## 需求:工具 execute 阶段三态合并 provider
`omniroute_web_search` 工具 `execute` 阶段必须按"显式入参 > 已配置 > 省略"三态合并 `provider` 字段：若 `params.provider` 已显式传入，则使用 `params.provider`；否则若 `currentConfigProvider` 不为 `undefined` 且不为字符串 `"auto"`，则使用 `currentConfigProvider`；否则请求体中不携带 `provider` 字段。TypeBox schema 层的入参校验保持不变（仍按 `SEARCH_PROVIDERS` 14 项静态字面量校验）。

#### 场景:显式入参覆盖配置
- **当** 工具调用 `params.provider === "exa-search"`，且当前 `currentConfigProvider === "tavily-search"`
- **那么** 请求体中的 `provider` 字段必须为 `"exa-search"`（显式入参优先）

#### 场景:配置为具体 provider 时注入
- **当** 工具调用 `params.provider === undefined`，且当前 `currentConfigProvider === "tavily-search"`
- **那么** 请求体中的 `provider` 字段必须为 `"tavily-search"`

#### 场景:配置为 auto 时省略
- **当** 工具调用 `params.provider === undefined`，且当前 `currentConfigProvider === "auto"`（或 `undefined`）
- **那么** 请求体中不得包含 `provider` 字段

#### 场景:配置为无效字符串时省略
- **当** 工具调用 `params.provider === undefined`，且当前 `currentConfigProvider === "未知-provider"`
- **那么** 请求体中不得包含 `provider` 字段（防御性：非常规 provider id 不注入，避免 4xx 透传到 OmniRoute）

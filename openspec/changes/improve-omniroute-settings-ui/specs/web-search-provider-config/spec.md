## 修改需求

### 需求:`/omniroute-settings` 顶层设置菜单
扩展必须在 TUI 模式下注册 `/omniroute-settings` 命令；命令处理器必须呈现一个一级菜单（顶层菜单），菜单中至少包含一个可激活项 "Search provider"，并显示其当前配置值预览（provider id / "Auto" / "未配置"）；菜单支持上下键导航、Enter 激活、Esc 关闭；顶层菜单必须渲染外边框以凸显设置工作区。

#### 场景:用户在 TUI 模式下调起命令
- **当** 用户在 TUI 模式下输入 `/omniroute-settings`
- **那么** 扩展必须呈现一级菜单，菜单首项为 "Search provider"（行尾显示当前 provider 配置值预览，例如 `Search provider: tavily-search` / `Search provider: Auto` / `Search provider: 未配置`）

#### 场景:顶层菜单渲染外边框
- **当** 顶层菜单在 TUI 中呈现
- **那么** 菜单内容必须被外边框包围（顶行 `┌─...─┐`、底行 `└─...─┘`、内容行 `│` 前缀），边框宽度匹配菜单内容宽度

#### 场景:用户激活 "Search provider" 项
- **当** 顶层菜单中 "Search provider" 项被激活（Enter）
- **那么** 扩展必须切换到二级配置面板，呈现 provider 选择列表

#### 场景:用户在顶层菜单按 Esc
- **当** 顶层菜单获得 Esc 输入
- **那么** 扩展必须关闭菜单，不修改任何配置

#### 场景:在非 TUI 模式下调用命令
- **当** 用户在非 TUI 模式（如 print / RPC）下调用 `/omniroute-settings`
- **那么** 扩展必须通过 `ctx.ui.notify` 提示用户 "/omniroute-settings requires TUI mode"，不进入菜单

### 需求:二级 provider 选择面板的选项与选择行为
provider 面板必须为设置列表，列表首项固定为 `auto`（label "Auto (follow server default)"），其后按目录 / 回退顺序呈现 provider 选项；面板必须渲染外边框；面板行内只显示 label 列，不得显示 value 列；当前启用的 provider（`auto` 视为未配置即启用态）必须在行首显示 `✓` 标记；用户选择某 provider 或 `auto` 后，扩展必须立即将选择写入 pi 全局配置文件，并返回顶层菜单（更新值预览）。

#### 场景:二级面板渲染外边框
- **当** 二级 provider 面板在 TUI 中呈现
- **那么** 面板内容必须被外边框包围（顶行 `┌─...─┐`、底行 `└─...─┘`、内容行 `│` 前缀）

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

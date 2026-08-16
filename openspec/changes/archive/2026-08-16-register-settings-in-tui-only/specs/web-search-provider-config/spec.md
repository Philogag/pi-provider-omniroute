# Web Search Provider Config

## Purpose

`/omniroute-settings` 顶层设置菜单的既有需求（本 delta 覆盖变更：命令注册行为收紧为 TUI-only，非 TUI 下命令不存在）。

## MODIFIED Requirements

### Requirement:`/omniroute-settings` 顶层设置菜单

扩展必须在 TUI 模式下注册 `/omniroute-settings` 命令；命令处理器必须呈现一个一级菜单（顶层菜单），菜单中至少包含一个可激活项 "Search provider"，并显示其当前配置值预览（provider id / "Auto" / "未配置"）；菜单支持上下键导航、Enter 激活、Esc 关闭；顶层菜单必须渲染外边框以凸显设置工作区。命令仅在交互式 TUI 模式注册（见能力 `settings-command-tui-gating`）；print/json/rpc 会话中命令不存在。

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

#### 场景:在非 TUI 模式下命令不存在
- **当** 用户处于非 TUI 模式（如 print / json / rpc）
- **那么** `/omniroute-settings` 命令必须不存在（调用得到 unknown command），扩展不得提示任何 TUI 错误信息

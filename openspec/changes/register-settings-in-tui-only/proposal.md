# Proposal: 仅 TUI 模式下注册 /omniroute-settings

## Why

`/omniroute-settings` 是一个终端 UI 专属命令——它依赖 `ctx.ui.custom` 覆盖层渲染两级菜单，仅 TUI 模式具备该能力。当前扩展在**所有**运行模式（tui / rpc / json / print）下都注册该命令，非 TUI 会话中用户调用后只能得到一句 `/omniroute-settings requires TUI mode` 错误通知。命令注册应当与运行环境匹配：**只在 TUI 模式下注册**，非 TUI 会话中命令不存在（unknown command），从根源上消除误导性注册与命令列表噪音。

## What Changes

- 命令注册时机从扩展加载期（`export default` 顶层）移到 `session_start` 事件：首次会话启动时按 `ExtensionContext.mode` 判定，**仅当 `mode === "tui"` 时注册** `/omniroute-settings`。
- 移除 handler 内的非 TUI 分支（`if (ctx.mode !== "tui") notify(...)`）——命令不再存在于非 TUI 模式，该分支成为死代码。handler 保留 API key 校验与 TUI 菜单渲染逻辑不变。
- 注册幂等：`session_start` 在一个会话生命周期内可能多次触发（`new` / `resume` / `fork` / `reload`），扩展必须保证同一进程内命令只注册一次（模块级 once 标记）。
- **BREAKING（行为变更）**：非 TUI 模式（rpc / json / print）下 `/omniroute-settings` 不再可用，调用将得到 unknown command，而不是原来的友好错误提示。
- 文档同步：README 命令列表标注"仅 TUI 模式可用"。

## Capabilities

### New Capabilities

- **`settings-command-tui-gating`**：`/omniroute-settings` 命令仅当运行环境为 TUI 模式时注册；非 TUI 模式下命令不存在；同一进程内注册幂等。

### Modified Capabilities

无——归档变更（2026-08-16-standardize-login-move-baseurl-to-config）已封闭，其 spec 未包含非 TUI 通知需求（该行为仅存在于代码实现中，本次变更将其改为不注册）。

## Impact

- **代码**：`src/index.ts` —— 命令注册逻辑从模块顶层移入 `session_start` handler（新增 `registerSettingsCommand()` 辅助 + once 标记）；移除 handler 中非 TUI notify 分支。
- **测试**：`test/command-register.test.ts` —— mock harness 需触发 `sessionStartHandler` 并携带 `mode`；断言从"非 TUI 时 notify"改为"非 TUI 时命令未注册"；新增 TUI 注册成功 / 幂等（重复 session_start 不重复注册）用例。
- **文档**：`README.md` / `README.zh-CN.md` 命令说明补充 TUI-only 标注。
- **依赖**：无新增；pi-coding-agent 类型（`ExtensionContext.mode: ExtensionMode`、`SessionStartEvent`）已可用。

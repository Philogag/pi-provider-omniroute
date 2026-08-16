## Purpose

确保 `/omniroute-settings` 命令仅在 TUI 模式下注册，避免非 TUI（print/json/rpc）会话中出现无法使用的命令与误导性错误提示。

## ADDED Requirements

### Requirement: /omniroute-settings 命令仅在 TUI 模式注册

扩展 SHALL 仅当运行环境为 TUI 模式时注册 `/omniroute-settings` 命令；在 print、json、rpc 模式下扩展 MUST NOT 注册该命令。命令注册时机不早于会话启动事件（此时运行模式已经确定）。

#### Scenario: TUI 会话中命令可用
- **WHEN** 会话以 TUI 模式启动
- **THEN** `/omniroute-settings` 命令被注册，用户可调起设置菜单

#### Scenario: 非 TUI 会话中命令不存在
- **WHEN** 会话以 print、json 或 rpc 模式启动
- **THEN** `/omniroute-settings` 命令未被注册，用户调用时得到 unknown command 而非任何错误通知

#### Scenario: 非 TUI 模式不再输出 TUI 错误提示
- **WHEN** 用户在非 TUI 模式会话中尝试调用 `/omniroute-settings`
- **THEN** 扩展不产生任何 TUI 相关提示（旧行为中的 `/omniroute-settings requires TUI mode` 通知不再出现）

### Requirement: 同一进程内注册幂等

`session_start` 事件在一个会话生命周期内可能触发多次（新建、恢复、分支等）；扩展 SHALL 保证同一进程实例内 `/omniroute-settings` 命令只注册一次，重复触发不得产生重复注册或覆盖副作用。

#### Scenario: 会话切换不重复注册
- **WHEN** TUI 会话内再次触发 `session_start`（如新建或切换会话）
- **THEN** 命令保持已注册状态，注册次数不增加，命令行为不变

#### Scenario: 注册前模式已确定
- **WHEN** 会话启动事件触发并携带运行模式
- **THEN** 扩展按该模式的判定结果注册或不注册命令，且在判定后不再改变（同一进程实例内）

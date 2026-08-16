# Design: 仅 TUI 模式下注册 /omniroute-settings

## Context

- `/omniroute-settings` 依赖 `ctx.ui.custom` 渲染 TUI 覆盖层菜单，该能力仅 TUI 模式具备（rpc 模式只有 select/confirm/input 对话框，无自定义覆盖层）。动机详见 proposal.md - Why。
- 现状：命令在扩展加载期（`export default` 顶层）无条件注册，handler 内 `if (ctx.mode !== "tui") { ctx.ui.notify("...requires TUI mode", "error"); return; }`。
- 已核实（pi-coding-agent 0.84.x，dist 源码）：
  - `ExtensionAPI`（扩展工厂的 `pi` 参数）**没有** mode 字段 —— 加载期无法得知运行模式。
  - `ExtensionContext.mode: ExtensionMode`（`"tui" | "rpc" | "json" | "print"`）—— `session_start` 等事件 handler 的第二参数可用。
  - `registerCommand` 写入 `extension.commands` Map；命令注册表**每次**通过 `runner.getRegisteredCommands()` 实时 re-resolve（autocomplete 每次打开 /- 菜单都重读）→ 在 `session_start` 内迟到注册会被自动补全与调用正常拾取。
  - `RegisteredCommand` 无条件（if/requires）字段 —— 宿主侧没有按模式过滤命令的内建机制。

## Goals / Non-Goals

**Goals**
- 命令只在 `ctx.mode === "tui"` 的会话中注册；非 TUI 模式下命令不存在。
- 同一进程实例内注册幂等（session_start 多次触发不重复注册）。
- 非 TUI notify 分支移除。

**Non-Goals**
- 不改变菜单渲染、API key 校验、配置写入等既有行为。
- 不修改归档变更（2026-08-16）的 spec —— 该行为变更由本变更的新 delta spec 承载。
- 不为 rpc 模式提供替代入口（需求明确仅 TUI）。

## Decisions

### D1: 在 session_start 中按 mode 注册（带 once 标记）

```ts
let settingsCommandRegistered = false;

function registerSettingsCommand(pi: ExtensionAPI): void {
  if (settingsCommandRegistered) return;
  settingsCommandRegistered = true;
  pi.registerCommand?.("omniroute-settings", { description, handler });
}
```

`pi.on?.("session_start", async (_ev, ctx) => { ...既有迁移逻辑...; if (ctx.mode === "tui") registerSettingsCommand(pi); })`。

- 为什么 session_start 而不是加载期：`ExtensionAPI` 无 mode，只有事件 ctx 携带 mode（已核实）。
- 为什么迟到注册可行：命令表实时 re-resolve（已核实）。
- 为什么 once 标记：session_start 在 new/resume/fork 时多次触发；`Map.set` 覆盖本身无害，但标记使"注册次数不增加"可观测、语义清晰。

**备选方案**
- (a) 加载期环境探测（`process.env.TERM` / `isatty`）：不可靠（shell 环境与 pi 运行模式解耦），否决。
- (b) 无条件注册 + 非 TUI 时 handler 空操作：命令仍出现在注册表（违反需求"仅 TUI 注册"），否决。
- (c) 宿主提供按模式过滤命令的机制：`RegisteredCommand` 无该字段（已核实），不可用。

### D2: 移除 handler 内非 TUI notify 分支

命令在非 TUI 模式不再存在，`if (ctx.mode !== "tui")` 分支成为死代码，删除。handler 保留 API key 校验与 `ctx.ui.custom` 菜单渲染（TUI 内原样执行）。

### D3: /reload 语义自然成立

`/reload` 重新执行扩展工厂（新模块实例），once 标记随实例重置 —— 重新按当前模式评估注册。无需额外处理。

### D4: 兼容测试替身

保持 `pi.on?.` 与 `pi.registerCommand?.` 可选调用；测试 harness（mockPi）捕获 `sessionStartHandler` 后由测试显式触发并携带 mode。

## Risks / Trade-offs

- [注册时机：用户能否在 session_start 之前调用命令？] → TUI 启动流程中 session_start 先于用户输入触发；自动补全实时 re-resolve。可接受。
- [测试替身不实现 `on`/`registerCommand`] → 保持可选调用；command-register 测试显式驱动 sessionStartHandler。既有测试同步更新（断言从"注册后非 TUI notify"改为"非 TUI 不注册"）。
- [rpc 客户端失去该命令] → 需求明确"仅当 tui"，rpc 无自定义覆盖层能力，属预期行为。

## Migration Plan

- 部署：代码 + README 同步更新，随扩展发布。
- 回滚：回退注册改动即恢复"无条件注册 + notify"行为；无数据迁移。

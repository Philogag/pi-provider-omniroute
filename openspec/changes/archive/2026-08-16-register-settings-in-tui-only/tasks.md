## 1. 仅 TUI 模式注册 /omniroute-settings（spec: settings-command-tui-gating R1/R2）

- [x] 1.1 test/command-register.test.ts：harness 增加 registerCommandCalls 计数器与 freshPi() 辅助函数（重置计数与命令注册表；改用 cache-busted 动态导入保证每次 entry() 全新模块实例）
- [x] 1.2 test/command-register.test.ts：新增 4 个测试 —— entry 不注册命令（TUI 会话前）、TUI session_start 恰好注册一次（幂等）、print/json/rpc 永不注册、handler 不再对非 TUI 通知
- [x] 1.3 test/command-register.test.ts：删除原"非 TUI 模式通知"测试；两个集成测试在调用命令前插入 `await sessionStartHandler?.({}, { mode: "tui" })`
- [x] 1.4 运行聚焦测试确认新用例失败（RED 3 fail）
- [x] 1.5 src/index.ts：新增模块级 `let settingsCommandRegistered` 一次性标记
- [x] 1.6 src/index.ts：把 registerCommand 块提取为 `registerSettingsCommand(pi)` 函数（置于 default 导出闭包内，读闭包变量）并删除 handler 内非 TUI notify 分支
- [x] 1.7 src/index.ts：session_start handler 末尾加 `if (ctx.mode === "tui") registerSettingsCommand(pi)`
- [x] 1.8 聚焦测试通过（GREEN 6/6）+ 全量 `npm test` 262/262 通过 + `npm run typecheck` 干净
- [x] 1.9 提交：`feat: register /omniroute-settings only in TUI mode (session_start gating)`（78f8e47）

## 2. README 双语标注 TUI-only（BREAKING 说明）

- [x] 2.1 README.md：/omniroute-settings 小节前加 Note（仅 TUI 模式注册；print/json/rpc 不存在，改编辑 settings.json）
- [x] 2.2 README.zh-CN.md：同步添加中文 Note
- [x] 2.3 `grep -n "omniroute-settings" README.md README.zh-CN.md` 确认无陈旧措辞
- [x] 2.4 `npm test && npm run typecheck` 冒烟通过（262/262）
- [x] 2.5 提交：`docs: note /omniroute-settings is TUI-only (EN + zh-CN)`（67e19e2）

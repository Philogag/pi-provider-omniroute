# Tasks: improve-omniroute-settings-ui

> 与 `superpower-plan.md` 一一对应（4 组 9 任务，Task 0-4）。实现顺序与步骤以 superpower-plan.md 为准（TDD 红→绿→commit）。

## Task 0: 基线确认

- [x] 0.1 `npm run typecheck && npm test` 通过（exit 0；153/153 pass）；`git diff --name-only HEAD` 为空（working tree 干净）；记录 base-ref `a1d7f50`

## Task 1: 数据层 buildSelectItems（SelectItem[] + ✓ 前缀）

- [x] 1.1 新建 `test/search-config-select-items.test.ts`：断言 (a) 首项 auto 后随 catalog.providers；(b) item 无 `currentValue`/`values` 字段；(c) 启用项 label 带 `✓ ` 前缀且仅一项有（tavily-search 激活时 / 未配置时 auto 项带 ✓）
- [x] 1.2 在 `src/tools/search-config.ts` 实现 `buildSelectItems(params: ProviderSubmenuParams): readonly SelectItem[]`（AUTO_ID/AUTO_LABEL 首项 + providers map；启用判定：`currentProvider` 未配置或 `"auto"` → auto 项，否则 `p.id === currentProvider`）；`buildProviderItems`/`ProviderItem` 保留到 Task 2 移除；typecheck + 全测通过后 commit

## Task 2: renderProviderSubmenu 官方化 + theme 通道切换

- [x] 2.1 重写 `test/search-config-submenu.test.ts`：删除 `_sl.onChange` hook 用法与 SettingsList invariant 测试；新增 (a) 顶/底边框行 + 标题；(b) 行内无 value 列（行尾无 provider id）；(c) ✓ 标记仅启用项；(d) 未配置时 auto 项带 ✓；(e) fallback 提示在边框内；(f) `_sl.onSelect` → onCommit(value)（provider 项提交 value / auto 项提交 undefined）；(g) Esc → onCancel
- [x] 2.2 重写 `renderProviderSubmenu`（src/tools/search-config.ts）：官方 Pattern 1（DynamicBorder 顶 + Text 标题 + SelectList + Text hint(keyHint) + DynamicBorder 底）；`buildSelectItems` 替代 `buildProviderItems`（删除 `ProviderItem`/`buildProviderItems`）；`ProviderSubmenuParams.theme` 类型改 `Theme`、增 `requestRender?: () => void`；`container.handleInput` 转发到 SelectList + `requestRender?.()`；暴露 `_sl` 供测试
- [x] 2.3 theme 通道切换（同 commit）：`createMenuStateMachine` 的 `getComponent(tui, theme: Theme)`；删除 `MenuStateMachineDeps.theme` 字段；`src/index.ts` 删除 `smTheme = getSettingsListTheme()`、删除 deps 的 `theme: smTheme`、`ctx.ui.custom((tui, theme, _kb, done))` 用回调 theme 替换两处 `sm.getComponent(tui, smTheme)`；`test/search-config-state-machine.test.ts` 的 `makeDeps` 删除 theme 字段；typecheck + 全测通过后 commit

## Task 3: renderTopLevelMenu 官方化 + state machine 接线

- [x] 3.1 更新 `test/search-config-toplevel.test.ts`：断言 (a) 顶/底边框行 + "OmniRoute Settings" 标题；(b) 单项 SelectList 行含 provider preview（undefined → Auto）；(c) Enter → `onActivateSearchProvider`；(d) Esc → 不激活 + `onClose` 被调用
- [x] 3.2 重写 `renderTopLevelMenu`（src/tools/search-config.ts）：官方 Pattern 1（DynamicBorder + Text 标题 + 单项 SelectList `{value:"provider", label: "Search provider: <preview>"}` + Text hint(keyHint) + DynamicBorder 底）；`TopLevelMenuParams.theme` 类型改 `Theme`、增 `onClose?`/`requestRender?`；`onSelect` → `onActivateSearchProvider`、`onCancel` → `onClose?.()`；handleInput 转发
- [x] 3.3 state machine 接线（同 commit）：top 分支 `renderTopLevelMenu` 调用处传 `onClose`（重置 cachedSubmenu + abort pendingFetch + `deps.onClose()`）、`requestRender: () => tui.requestRender()`；保持 index.ts wrapper 顶层 Esc 拦截优先（`done(undefined)`），`onClose` 仅组件级兜底，不改 wrapper 逻辑；typecheck + 全测通过后 commit

## Task 4: 验证与收尾

- [x] 4.1 `npm run typecheck` exit 0；`npm test` 全绿（153 基线 + select-items 3 新增 − 旧 submenu 6 − 旧 toplevel 4 + 重写后测试数）；`git diff --name-only HEAD~3` 仅含 `src/tools/search-config.ts`、`src/index.ts`、`test/search-config-*.test.ts`、`openspec/changes/improve-omniroute-settings-ui/*`（禁改文件 0 diff）
- [x] 4.2 勾选本文件全部复选框；`docs` commit（`docs(openspec): tick all tasks for improve-omniroute-settings-ui`）
- [x] 4.3 最终 review：`git log --oneline -5` 确认 3 实现 commit + 1 docs commit；核对每决策落实（DynamicBorder / SelectList 无 value 列 / ✓ 数据层前缀 / 官方 getSelectListTheme / deps.theme 移除）；无自定义渲染残留（grep `render: (_w` / `withBorder` / `SettingsList` 为空）

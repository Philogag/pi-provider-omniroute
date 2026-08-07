# superpower-design — improve-omniroute-settings-ui

## 设计意图

`/omniroute-settings` 设置界面当前由自定义 Component 渲染（无边框、二级面板有冗余 value 列、启用项无直观标识）。本变更将整个 settings UI **全部迁移到 pi 官方 TUI 脚手架**（`DynamicBorder` + `SelectList` + `Text` + `Container`），不自定义任何渲染逻辑：

1. 顶层菜单 + 二级面板均加官方 `DynamicBorder` 上下线（accent 色），凸显设置工作区
2. 二级面板换用官方 `SelectList`（`SelectItem {value, label, description?}` **天然无 value 列**，需求 2 直接满足）
3. 当前启用项 label 前缀 `✓ `（数据层构造，非渲染层），与 SelectList 光标 `→ ` 正交共存

**硬约束（用户明确）**：整个 settings UI 全部使用官方脚手架，不自造轮子（不写自定义 render 组件、不手画边框、不 hack SettingsList）。

## 官方脚手架 API 确认（pi-tui 0.83.0 + pi-coding-agent 当前版本）

| 组件 | 来源 | 用途 |
|---|---|---|
| `DynamicBorder` | `@earendil-works/pi-coding-agent`（index.d.ts:28 导出）| 边框线；`new DynamicBorder((s) => theme.fg("accent", s))`；render(width) 返回 `["─".repeat(max(1,width))]` 单行，**无角无竖线**（用户已确认接受"官方上下线"）|
| `SelectList` | `@earendil-works/pi-tui`（dist/components/select-list）| 单选列表；构造 `(items: SelectItem[], maxVisible, theme, layout?)`；`onSelect?` `onCancel?` `onSelectionChange?`；`handleInput(data)` 处理 ↑↓/Enter/Esc；`getSelectedItem()` |
| `SelectItem` | pi-tui | `{value: string; label: string; description?: string}` — 无 value/currentValue 字段 |
| `SelectListTheme` | pi-tui | `{selectedPrefix, selectedText, description, scrollInfo, noMatch}`（均为 text→text 函数）|
| `Text` | pi-tui | `new Text(str, paddingLeft, paddingTop)` 纯文本行（Pattern 1 用法）|
| `Container` | pi-tui | children 垂直堆叠；render(w) 串行渲染；**不转发输入**（需手动接 handleInput）|

**SelectList 渲染细节（select-list.js renderItem）**：行 = `prefix(→ / 空格) + label`；仅当 `item.description && width > 40` 时在同一行追加 `spacing + description`（muted 色）。**无独立第二列**。选中项前缀硬编码 `"→ "` / `"  "`（非 theme 可配置），选中文本套 `selectedText`。

**官方 Pattern 1（Selection Dialog）结构**（docs/tui.md:614-668，需照抄该模式）：
```
Container
├─ DynamicBorder(top, accent)
├─ Text(标题, accent+bold, padding 1,0)
├─ SelectList(items, maxVisible, theme)
├─ Text(hint, dim, 1,0)
└─ DynamicBorder(bottom, accent)
return { render: (w) => container.render(w), invalidate: () => container.invalidate(),
         handleInput: (data) => { selectList.handleInput(data); tui.requestRender(); } }
```

## 决策

### D1: 边框 — 官方 DynamicBorder 上下线（不在顶层，也不在二级自定义任何边框渲染）

- 顶层菜单与二级面板均用 `DynamicBorder`（accent 色）作为 Container 首/末 child（Pattern 1 结构）
- 标题行（"OmniRoute Settings" / "Search Provider"）用官方 `Text` 放在顶线之后第一行（用户选"边框外标题行"= 顶线纯 `─`，标题为边框内首行）
- hint 行（"↑↓ navigate • enter select • esc cancel"）用官方 `Text` 放在底线之前，边框内（用户选"fallback 提示边框内"）
- 不引入任何自定义 border/box 渲染；不用 `Box`（pi-tui Box 只有 paddingX/paddingY + bgFn，无边框线，非边框组件）
- 不用 `BorderedLoader`（那是 loading spinner，与 settings 菜单无关；catalog 拉取中的 Loading 状态后续如需沿用现有文本提示）

### D2: 二级面板列表 — 官方 SelectList 替换 SettingsList（单选即提交）

- `buildProviderItems` 重构为 `buildSelectItems(params): SelectItem[]`：
  - `{ value: AUTO_ID, label: <✓前缀 + AUTO_LABEL> }`（auto 项）
  - `catalog.providers.map(p => ({ value: p.id, label: <✓前缀 + (p.name||p.id)> }))`
- **移除** `ProviderItem.currentValue` / `values` / `id` 字段 — SelectItem 只有 value/label/description，无 value 列
- 交互语义变化（用户已确认）：SettingsList 的"Enter 循环切换值 → onChange"改为 **SelectList 单选**：Enter → `onSelect(item)` → 写入配置 → 返回顶层；Esc → `onCancel()` → 返回顶层不写入
- `params.onCommit` / `params.onCancel` 签名不变（state machine 侧零改动）：`onSelect(item) => item.value === AUTO_ID ? onCommit(undefined) : onCommit(item.value)`
- `_sl.onChange` 测试 hook 移除，改为暴露 SelectList 实例（见 T3）
- SettingsList/getSettingsListTheme 相关代码（buildProviderItems 的 values 循环不变式、auto 行 currentValue 保持逻辑）整体删除

### D3: ✓ 标记 — 数据层 label 前缀，与 SelectList 光标正交

- 启用项判定（不变式，与现有 `isCurrentAuto` 相同）：`currentProvider === undefined || === "auto"` → auto 项启用；否则 `p.id === currentProvider` 的项启用
- 启用项：label 前缀 `"✓ "`（如 `✓ Auto (follow server default)` / `✓ tavily-search`）
- 未启用项：无前缀
- SelectList 光标 `→ `（选中项）与 ✓ 共存：选中启用项显示 `→ ✓ tavily-search`，未选中启用项显示 `  ✓ tavily-search`
- ✓ 前缀宽度 = 2 显示宽度，与光标前缀 `"→ "` 同宽 → label 列对齐稳定
- 不使用 `SelectItem.description` 承载 ✓（description 只在 width>40 时显示，非选中态不渲染 ✓ 需求是常驻的）；不使用 selectedText 变色表示启用（那是光标态，非启用态）

### D4: 顶层菜单 — 官方 Text + 单项 SelectList（整个 settings UI 官方脚手架）

- 标题 `new Text(theme.fg("accent", theme.bold("OmniRoute Settings")), 1, 0)`（官方 Text，Pattern 1）
- 可激活项改用**单项 SelectList**：`items = [{ value: "search-provider", label: "▶ Search provider: <preview>" }]`（label 内嵌 ▶ + 预览，现有预览逻辑 `previewForProvider` 保留）
  - `onSelect: () => params.onActivateSearchProvider()`（单项 Enter = 激活 → state machine 切 mode="sub"）
  - `onCancel: () => 关闭菜单`（Esc → done 或 onClose 链路不变）
  - 替代方案评估：保留自定义 row Component（render "▶ Search provider"）→ 违背"全部官方脚手架"硬约束，否决；用 SelectList 单项是官方"菜单项"最小表达
- hint 用官方 `Text(theme.fg("dim", "↑↓ navigate • enter select • esc cancel"), 1, 0)`
- Container + DynamicBorder 顶/底 + 标题 + SelectList + hint（Pattern 1 结构）
- `TopLevelMenuParams` 不变（`currentProvider/theme/onActivateSearchProvider`）— 但 `theme` 类型从 `ReturnType<typeof getSettingsListTheme>` 改为 `SelectListTheme`

### D5: 主题 — SelectListTheme（官方）

- 新增 `getSelectListTheme()`（或内联构造，Pattern 1 风格）：
  - `selectedPrefix: (t) => theme.fg("accent", t)`（`→ ` accent 色）
  - `selectedText: (t) => theme.fg("accent", t)`
  - `description: (t) => theme.fg("muted", t)`（不用）
  - `scrollInfo: (t) => theme.fg("dim", t)`
  - `noMatch: (t) => theme.fg("warning", t)`
- `getSettingsListTheme` 从 `src/tools/search-config.ts` import 中移除（settings UI 不再用 SettingsList）

### D6: 状态机 / 组件缓存（沿用现有机制，零行为变化）

- `createMenuStateMachine` 的 `cachedSubmenu` 缓存机制保留 — SelectList 实例同样需要缓存（否则光标 selectedIndex 每帧重置）。`getComponent` 在 mode="sub" 且 catalogValue 已设置时返回缓存的 submenu（SelectList 实例）
- `cachedSubmenu = renderProviderSubmenu({...})` 返回的容器持有 SelectList；`handleInput` 转发（container.handleInput → children，与现状一致，加 `tui.requestRender()` 以匹配 Pattern 1）
- Loading 状态、fetchCatalogAsync（含 tui.requestRender after fetch）逻辑不变

## 测试策略

- `test/search-config-submenu.test.ts`（重写渲染与交互断言）：
  - 渲染断言改为：SelectList 行格式 `→ label` / `  label`（无 value 列 — 断言行内不出现 `currentValue`/provider id 尾列）
  - ✓ 断言：启用项 label 含 `✓ ` 前缀且唯一；未配置时 auto 项含 `✓ `
  - 交互断言：`_sl.onChange` hook 删除 → 改为驱动 SelectList 的 `handleInput`（Enter 触发 onSelect）或直接调用暴露的 onSelect 回调断言 `onCommit(provider)` / `onCommit(undefined)`；Esc → onCancel
  - 测试钩子：`(container as any)._sl` 改为暴露 SelectList 实例或 onSelect 回调（参考现状 hook 模式）
- `test/search-config-toplevel.test.ts`：渲染断言加 DynamicBorder 顶/底线行 + 标题 Text 行；行为断言（Enter 激活 → onActivateSearchProvider 调用、Esc 关闭）保留
- `test/search-config-state-machine.test.ts`：不变（state machine 接口未动；submenu 缓存 identity 测试仍有效）
- `test/search-config-persistence.test.ts` / `search-tool-merge.test.ts` / `session-start-config.test.ts`：零改动（数据层未动）
- 新增 `test/search-config-border.test.ts`：断言渲染输出含 `─` 顶/底线行且与内容同宽、标题行存在（可选，若并入 submenu/toplevel 测试则不加）

## 风险与缓解

- **[SelectList 语义变化]** SettingsList 值循环 → SelectList 单选提交：交互从"Enter 循环"变"Enter 即提交"。用户已确认（Q: 换 SelectList）。测试重写覆盖
- **[SelectList 无搜索/description 边缘]** 不配置 enableSearch（SelectList 无该选项，只有 setFilter 方法，不调用）；description 不传（避免 width>40 时的额外列视觉）— 与"去第二列"目标一致
- **[cachedSubmenu 缓存 SelectList]** 实例缓存于 state machine 闭包；invalidate 时机不变（onCommit/onCancel/onEsc/onActivateSearchProvider/loading-Esc）— 避免光标重置回归（上一变更 Critical #1 教训）
- **[容器输入转发]** Pattern 1 要求 handleInput 中显式 `tui.requestRender()`；现有 container.handleInput 转发已存在，补 requestRender 保持一致
- **[DynamicBorder 无角]** 用户已确认接受官方上下线（无 ┌┐└┘）
- **[归档 spec 增量]** 主 openspec/specs/ 为空（上次归档跳过同步）— 沿用上次决策：增量 spec 留在 change 归档，不同步

## 明确不做（非目标）

- 不改 omniroute.json 读写（resolve/write/readOmnirouteConfig）、目录拉取/回退、三态合并逻辑
- 不改 state machine 接口与缓存生命周期
- 不自定义任何渲染组件（硬约束）
- 不加新依赖
- 不动顶层预览行内容（`Search provider: <preview>` 语义保留，仅渲染载体从自定义 row 变 SelectList 单项）

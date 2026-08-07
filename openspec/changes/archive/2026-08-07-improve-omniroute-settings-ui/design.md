## 上下文

`/omniroute-settings` 是已实现的功能（上一变更 `add-web-search-provider-selection`，已归档），代码在 `src/tools/search-config.ts`：
- `renderTopLevelMenu(params)` — 顶层菜单：header（"OmniRoute Settings"）+ 一行 `▶ Search provider: <preview>` + hint 行，返回裸 `Container`（3 个子组件：header/row/hint），**无边框**
- `renderProviderSubmenu(params)` — 二级 provider 面板：`buildProviderItems()` 构造 `SettingItem[]`（首项 `auto` + 目录 providers），`new SettingsList(items, maxVisible, theme, onChange, onCancel)` 渲染，Container 内含可选 hint 行 + SettingsList，**无边框**
- pi-tui 0.83.0 组件：`Container`（children 垂直堆叠）、`SettingsList`（`label` 左列 + `currentValue` 右列 + `cursor` 前缀 + `description` 选中时显示）、`Box`（padding/bg，**无边框**）。无现成 Border 组件。
- `SettingsList` 渲染逻辑（`renderMainList`）：`prefix(cursor|"  ") + labelPadded + separator("  ") + valueText`；value 列 = `theme.value(truncate(currentValue))`；label 列宽按 `max(30, maxLabelWidth)` 对齐。

约束：不改数据层（`omniroute.json` 读写、目录拉取/回退、三态合并）；不新增依赖（pi-tui 0.83.0 现有组件即可）；153 个既有测试需保持通过（渲染相关断言随本次变更更新）。

## 目标 / 非目标

**目标：**
- `/omniroute-settings` 顶层菜单和 Search Provider 二级面板均渲染外边框，凸显设置工作区
- 二级面板移除行尾 `currentValue` 列（第二列）
- 二级面板当前启用项（`auto` 或具体 provider）行首显示 `✓` 标记
- 全部实现有测试覆盖，typecheck 0，既有测试全绿

**非目标：**
- 不改 `omniroute.json` 读写、目录拉取/回退、三态合并逻辑（纯 UI 呈现变更）
- 不加新依赖；不改 pi-tui
- 不改顶层菜单的 `currentValue` 预览行（`Search provider: tavily-search` 保持）
- 不做颜色/主题重构（theme 沿用 `getSettingsListTheme`）

## 决策

### D1: 外边框用官方 DynamicBorder（pi 标准脚手架），不自定义渲染

pi-tui 无 Border 组件；`Box` 只做 padding/bg。用户明确要求"直接使用 pi 标准的 ui 脚手架（https://pi.dev/docs/latest/extensions#custom-ui）"。选择**官方 `DynamicBorder` 组件**（从 `@earendil-works/pi-coding-agent` 导出）：
- `new DynamicBorder((s) => theme.fg("accent", s))` — render(width) 返回单行 `─`.repeat(width)，顶/底各一个，作为 Container 首/末 child（Pattern 1 Selection Dialog 结构）
- 标题行用官方 `Text`（`new Text(text, 1, 0)`）作为边框内第一行（用户选"边框外标题行"：顶线纯 `─`，标题为边框内首行）
- fallback 提示行用官方 `Text`（边框内，用户确认）
- **替代方案**：自定义 withBorder 行渲染（┌┐└┘ 完整框）→ 违背用户"用 pi 标准脚手架"指令，否决；`Box` 无边框线，否决

### D2: 去 value 列 = 二级面板整体换官方 SelectList（单选即提交）

`SelectItem {value, label, description?}` **天然没有 value/currentValue 字段**（select-list.d.ts 确认），比"SettingsList + currentValue:''" hack 更符合 pi 标准，且用户 Q3 已明确"直接使用 pi 标准的 ui 脚手架"、Q6 确认"换 SelectList"。
- `buildProviderItems` 重构为 `buildSelectItems(params): SelectItem[]`：`{value: AUTO_ID, label: AUTO_LABEL}` + `catalog.providers.map(p => ({value: p.id, label: p.name||p.id}))` — 无 currentValue/values 字段
- 移除 `ProviderItem` / `SettingItem` 类型、SettingsList 构造、`_sl.onChange` 测试 hook
- 交互语义变化（用户已确认）：SettingsList "Enter 循环切换值" → SelectList "Enter 单选即提交"：`onSelect(item) => item.value === AUTO_ID ? onCommit(undefined) : onCommit(item.value)`；`onCancel` 不变
- `SettingItem.currentValue` 是必填字段但 SelectItem 无此字段 → 不再需要空串 hack；`values` 循环不变式整体移除
- **替代方案**：SettingsList + currentValue:"" → 非官方模式 hack，用户否决（Q6）；自写列表组件 → 违背官方脚手架约束，否决

### D3: ✓ 标记放 label 前缀（数据层），不动光标

当前启用项判定：`currentProvider === undefined || === "auto"` → auto 项启用；否则 `p.id === currentProvider` 的具体项启用。在 `buildSelectItems` 中给启用项 label 加 `✓ ` 前缀（如 `✓ Auto (follow server default)` / `✓ tavily-search`）。
- SelectList 选中项前缀硬编码 `"→ "`（select-list.js renderItem），与 ✓ 共存：选中启用项显示 `→ ✓ tavily-search`；未选中启用项 `  ✓ tavily-search`。光标（交互态）与 ✓（启用态）正交
- ✓ 前缀宽度 2（含空格），与光标前缀 `"→ "` 同宽 → label 列对齐稳定
- **替代方案**：description 字段（仅选中时显示，不常驻）→ 不满足；theme.label 无 item id 上下文 → 不可行；currentValue="✓"（右列显示）→ 与去 value 列冲突，否决

### D4: 顶层菜单边框 + 单项 SelectList

- 顶层菜单同样用 DynamicBorder 顶/底 + 官方 Text 标题（"OmniRoute Settings"）+ hint 行
- 可激活项改用法：现有自定义 row/hint/header Component 改为官方 Text（`new Text("▶ Search provider: <preview>", 1, 0)`）+ Text hint；Enter 激活行为通过 SelectList 单项承载：`items = [{value:"provider", label:"▶ Search provider: <preview>"}]`，`onSelect → onActivateSearchProvider()`
- 或最小改动：保留现有 row/hint/header Component 结构，仅外层包 DynamicBorder。二选一在实现时按"官方脚手架优先"原则决定（倾向全 Text）

## 风险 / 权衡

- [SelectList 交互语义变化（Enter 即提交 vs 值循环）] → 用户已确认（Q6）；测试重写覆盖
- [SelectList 单选无"循环切换"能力] → 场景本就是单选 provider，语义更贴切；`onSelect` 即提交
- [✓ 前缀影响 label 列宽对齐] → `✓ ` 与光标 `→ ` 同宽（2），对齐稳定
- [DynamicBorder 无角无竖线] → 用户已确认接受官方上下线样式（Q5）
- [SelectList 无 enableSearch] → 本场景不需要搜索；不调用 `setFilter`
- [修改既有测试断言（submenu 行渲染 + 交互 hook）] → 重写 `test/search-config-submenu.test.ts`（`_sl.onChange` → onSelect 断言）+ 更新 `test/search-config-toplevel.test.ts`（边框行断言）
- [归档时增量 spec 与主 spec 合并] → 主 `openspec/specs/` 为空（上次归档跳过同步），沿用上次决策：不同步，增量留在 change 归档

## 迁移计划

无部署步骤（纯前端 TUI 呈现变更，无 schema/数据迁移）。回滚：`git revert` 合并 commit。

## 开放问题

- 顶层菜单是否保留现有 row/hint/header 自定义 Component 结构（仅外包 DynamicBorder），还是全 Text + 单项 SelectList？→ 倾向全官方脚手架（Text + SelectList 单项），实现时确认
- hint 文案（"↑↓ or j/k: navigate · Enter: activate · Esc: close"）是否随 SelectList 调整（SelectList 不响应 j/k 导航）？→ 实现时核对 SelectList 实际按键支持

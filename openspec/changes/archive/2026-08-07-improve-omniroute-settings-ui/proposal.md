## 为什么

`/omniroute-settings` 的设置页面（顶层菜单 + Search Provider 二级选择面板）目前视觉上缺少工作区轮廓：内容直接铺在终端上，与周围输出混在一起，无法快速辨认"这是设置界面"。此外二级选择面板每行右侧的 value 列（`currentValue`，如 `auto` / provider id）与左侧 label 列内容重复、信息意义不明，而"当前启用的是哪一项"反而没有直观标识。

## 变更内容

1. **设置工作区外边框**：`/omniroute-settings` 顶层菜单与 Search Provider 二级选择面板均渲染外边框（`┌─┐` / `│` / `└─┘`），凸显设置工作区与终端其余内容的分隔。
2. **移除二级面板 value 列**：Search Provider 二级选择面板不再渲染行尾的 `currentValue` 列（第二列），行内只保留 label 列。
3. **当前启用项勾符号**：二级选择面板中当前启用的 provider（含 `auto` 项）在行首显示 `✓` 标记；未启用项无标记。选中光标（`cursor`）样式保持独立于勾符号。

不改动数据层：`omniroute.json` 读写、provider 目录拉取/回退、三态合并逻辑全部保持不变（纯 UI 呈现变更）。

## 功能 (Capabilities)

### 新增功能
<!-- 无新 capability；这是现有 UI 的样式优化。 -->

### 修改功能
- `web-search-provider-config`: `/omniroute-settings` 顶层菜单与二级 provider 选择面板的渲染需求变更——新增外边框要求、移除 value 列、新增当前启用项 `✓` 标记。

## 影响

- `src/tools/search-config.ts`: `renderTopLevelMenu`（加边框）、`renderProviderSubmenu`（加边框 + 去 value 列 + ✓ 标记）、`buildProviderItems`（label/currentValue 构造方式调整）、`getSettingsListTheme`（value 渲染可能改为空 / label 前缀加 ✓）
- 测试: `test/search-config-submenu.test.ts`（行渲染断言需更新）、`test/search-config-toplevel.test.ts`（边框行断言）
- 依赖: 无新增（`@earendil-works/pi-tui` 0.83.0 现有组件 Container/SettingsList 即可；边框用自定义行渲染）

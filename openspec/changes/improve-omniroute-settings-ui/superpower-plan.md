---
change: improve-omniroute-settings-ui
design-doc: openspec/changes/improve-omniroute-settings-ui/superpower-design.md
base-ref: a1d7f50
---

# improve-omniroute-settings-ui 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `/omniroute-settings` 的 settings UI 全部迁移到 pi 官方 TUI 脚手架（DynamicBorder + SelectList + Text），实现外边框、去除二级面板 value 列、当前启用项 ✓ 标记。

**Architecture:** `src/tools/search-config.ts` 的 `renderProviderSubmenu`（SettingsList + 自定义 hint 组件）与 `renderTopLevelMenu`（自定义 header/row/hint 组件）重写为官方 Pattern 1 结构（Container = DynamicBorder 顶 + Text 标题 + SelectList + Text hint + DynamicBorder 底）。`buildProviderItems`（含 currentValue/values 字段）重构为 `buildSelectItems`（官方 `SelectItem[]`，无 value 列），启用项 ✓ 前缀在数据层构造。state machine 的 theme 通道从 `getSettingsListTheme()`（SettingsListTheme，无 fg）改为 UI `Theme`（供 DynamicBorder 配色），`deps.theme` 字段移除。

**Tech Stack:** Node 22, TypeScript (tsc --noEmit), node:test, `@earendil-works/pi-tui` 0.83.0（Container/SelectList/Text/DynamicBorder 经 pi-coding-agent 导出）, `@earendil-works/pi-coding-agent`（getSelectListTheme/keyHint/DynamicBorder）。

## Global Constraints

- 不得修改：`src/tools/http.ts`、`src/tools/web-fetch.ts`、`src/tools/search.ts`、`src/auth*.ts`、`test/lazy-fetch.test.ts`、`test/auth-credentials.test.ts`、`test/url.test.ts`、`test/tools-*.test.ts`
- 不得修改：`omniroute.json` 读写（resolveOmnirouteConfigPath/readOmnirouteConfig/writeOmnirouteConfig）、目录拉取/回退（fetchCatalogAsync + catalogValue + pendingFetch + staleness guard）、三态合并（search.ts 的 searchTool provider 字段）
- 不得新增依赖（pi-tui 0.83.0 + pi-coding-agent 现有导出即可）
- 不得自定义渲染：行渲染只用官方组件；hint 用 `keyHint`（官方导出）
- 测试基线：153/153 pass，typecheck exit 0
- TDD：每任务先写/改测试（红）→ 实现（绿）→ commit

## 官方 API 事实（已核实，实现直接引用）

- `DynamicBorder`（pi-coding-agent 导出）：`new DynamicBorder((s) => theme.fg("accent", s))`；`render(width)` → `["─".repeat(max(1,width))]`；**必须显式传 color 函数**（jiti 加载时全局 theme 可能 undefined）
- `SelectList`（pi-tui 导出）：`new SelectList(items: SelectItem[], maxVisible: number, theme: SelectListTheme)`；`onSelect?` / `onCancel?`；`handleInput(data)` 处理 ↑↓（wrap）/Enter/Esc（经 `getKeybindings().matches`，默认 `tui.select.confirm`="enter"、`tui.select.cancel`=["escape","ctrl+c"]）；`getSelectedItem()`
- `SelectItem`（pi-tui）：`{ value: string; label: string; description?: string }` — 无 currentValue/values 字段
- `getSelectListTheme()`（pi-coding-agent 导出，官方实现已存在）：返回 `{selectedPrefix/selectedText/description/scrollInfo/noMatch}` 全走 `theme.fg`（accent/muted）— **不自建**
- `Text`（pi-tui）：`new Text(str: string, paddingLeft?: number, paddingTop?: number)`
- `Container`（pi-tui）：`addChild`；render 串行；**不转发 handleInput**（手动接）
- `keyHint(keybinding: string, description: string): string`（pi-coding-agent 导出）— 用 `getKeybindings().getKeys()` 渲染当前绑定键（dim+muted）
- 单测匹配验证：`matchesKey("\r", "enter")` → true（modifier 0 分支 `data === "\r"`）；`matchesKey("\x1b", "escape")` → true → SelectList 交互可直接单测，无需 mock keybindings
- `Theme`（pi-coding-agent 导出，class）：`fg(color: ThemeColor, text): string`、`bold(text)`；`ThemeColor` 含 "accent"/"border"/"muted"/"dim"/"warning"
- **全局 theme 依赖（单测必须 initTheme）**：`getSelectListTheme()` 返回的闭包在 **render 时**才调 `theme.fg(...)`（全局 proxy，Symbol.for 共享）；`keyHint()` 在 **构建时**立即调 `theme.fg` → 未 `initTheme()` 抛 "Theme not initialized"。测试文件顶层必须 `import { initTheme } from "@earendil-works/pi-coding-agent"; initTheme();`（幂等；getThemesDir 指向包内 dist/modes/interactive/theme/dark.json，测试环境可读）
- **fakeTheme 必须 identity**：旧测试的 `new Proxy({}, { get: () => () => "" })` 会把 DynamicBorder/Text 内容全部吞成空串（`theme.fg("accent", s)` → `""`），边框断言 `/^─+$/` 失败。改用 `{ fg: (_c, s) => s, bold: (s) => s } as unknown as Theme` — 边框行 = 纯 `─`、标题 = 纯文本，可精确断言
- **SelectList 渲染行格式**（select-list.js renderItem）：`prefix + label`（prefix 硬编码 `"→ "` 选中 / `"  "` 未选中），**无 value 列**（SelectItem 无 currentValue，渲染只用 label/value）；`selectedText`/`description`/`scrollInfo`/`noMatch` 走 theme（全局），行尾 `truncateToWidth` 到 width
- **Text 组件**：`new Text(str, paddingX = 1, paddingY = 1)` — paddingX 默认 1（左右各 1 空格），**每行 pad 到 width**（行尾补空格）；paddingY 默认 1（上下空行）→ 传 `1, 0` 去掉上下 padding

## 文件结构

- `src/tools/search-config.ts`（唯一源码改动文件）：
  - `buildSelectItems(params): SelectItem[]`（新，替换 buildProviderItems）— 数据层
  - `renderProviderSubmenu(params)`（重写）— SelectList + DynamicBorder + Text
  - `renderTopLevelMenu(params)`（重写）— Text + 单项 SelectList + DynamicBorder + keyHint
  - `createMenuStateMachine`（适配）— theme 类型改 UI Theme、deps.theme 移除、requestRender/onClose 接线
  - `previewForProvider`（保留，不变）
  - import：移除 `SettingsList`/`getSettingsListTheme`；新增 `SelectList, type SelectItem, Text`（pi-tui）、`getSelectListTheme, keyHint, DynamicBorder, type Theme`（pi-coding-agent）
- `src/index.ts`（适配 1 处）：`smTheme = getSettingsListTheme()` 移除；`ctx.ui.custom((tui, theme, _kb, done) => ...)` 用回调 `theme`（UI Theme）替代 `smTheme` 传给 `sm.getComponent`；`createMenuStateMachine({...})` 移除 `theme: smTheme` 字段
- 测试：
  - 新建 `test/search-config-select-items.test.ts`（buildSelectItems 单测）
  - 重写 `test/search-config-submenu.test.ts`（SelectList 断言）
  - 更新 `test/search-config-toplevel.test.ts`（边框 + 单项 SelectList）
  - 更新 `test/search-config-state-machine.test.ts`（deps.theme 移除、requestRender 断言）
- `openspec/changes/improve-omniroute-settings-ui/tasks.md`（勾选进度）

## Task 0: 基线确认

**Files:** 无

- [ ] **Step 1: 确认基线**

Run: `npm run typecheck && npm test`
Expected: exit 0；`# pass 153` / `# fail 0`
- [ ] **Step 2: 确认改动面**

Run: `git diff --name-only HEAD`
Expected: 空（working tree 干净）；记录 base-ref `a1d7f50`

## Task 1: buildSelectItems（数据层：SelectItem[] + ✓ 前缀）

**Files:**
- Create: `test/search-config-select-items.test.ts`
- Modify: `src/tools/search-config.ts`（新增 `buildSelectItems` + import `type SelectItem`；`buildProviderItems`/`ProviderItem` 保留到 Task 2 移除）

**Interfaces:**
- Consumes: `ProviderSubmenuParams { currentProvider: string | undefined; catalog: SearchCatalog; ... }`、`AUTO_ID = "auto"`、`AUTO_LABEL = "Auto (follow server default)"`（src/tools/search-config.ts:154-155）
- Produces: `buildSelectItems(params: ProviderSubmenuParams): readonly SelectItem[]` — 首项 `{value: "auto", label: "Auto (follow server default)"}`，其后 `catalog.providers.map(p => ({value: p.id, label: p.name || p.id}))`；启用项 label 前缀 `"✓ "`（启用判定：`currentProvider === undefined || "auto"` → auto 项；否则 `p.id === currentProvider` 的项）

- [ ] **Step 1: 写失败测试**

```typescript
// test/search-config-select-items.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSelectItems, type ProviderSubmenuParams } from "../src/tools/search-config.ts";
import type { SearchCatalog, SearchProviderEntry } from "../src/tools/search-config.ts";

function makeCatalog(entries: Array<[string, string]>, isFallback = false): SearchCatalog {
  const providers: SearchProviderEntry[] = entries.map(([id, name]) => ({ id, name, search_types: ["web"] }));
  return { providers, isFallback };
}

const fakeTheme = new Proxy({}, { get: () => () => "" }) as never;

function makeParams(overrides: Partial<ProviderSubmenuParams> = {}): ProviderSubmenuParams {
  return {
    currentProvider: undefined,
    catalog: makeCatalog([]),
    theme: fakeTheme,
    onCommit: () => {},
    onCancel: () => {},
    ...overrides,
  };
}

test("buildSelectItems: auto first, providers after, no value/currentValue fields", () => {
  const items = buildSelectItems(makeParams({
    currentProvider: "tavily-search",
    catalog: makeCatalog([["tavily-search", "Tavily"], ["brave-search", "Brave"]]),
  }));
  assert.equal(items.length, 3);
  assert.deepEqual(items[0], { value: "auto", label: "Auto (follow server default)" });
  assert.deepEqual(items[1], { value: "tavily-search", label: "✓ Tavily" });   // active → ✓ prefix
  assert.deepEqual(items[2], { value: "brave-search", label: "Brave" });       // inactive → no prefix
  for (const item of items) {
    assert.ok(!("currentValue" in item), "SelectItem must not carry currentValue");
    assert.ok(!("values" in item), "SelectItem must not carry values");
  }
});

test("buildSelectItems: auto item gets ✓ when unconfigured or auto", () => {
  const unconfigured = buildSelectItems(makeParams({ currentProvider: undefined }));
  assert.match(unconfigured[0].label, /^✓ /, "auto item must be checked when unconfigured");
  const auto = buildSelectItems(makeParams({ currentProvider: "auto" }));
  assert.match(auto[0].label, /^✓ /, "auto item must be checked when currentProvider is 'auto'");
  const concrete = buildSelectItems(makeParams({ currentProvider: "tavily-search", catalog: makeCatalog([["tavily-search", "Tavily"]]) }));
  assert.doesNotMatch(concrete[0].label, /^✓ /, "auto item must be unchecked when a concrete provider is active");
  assert.match(concrete[1].label, /^✓ /, "active provider item must be checked");
});

test("buildSelectItems: exactly one item is checked (auto vs provider)", () => {
  const items = buildSelectItems(makeParams({
    currentProvider: "exa-search",
    catalog: makeCatalog([["exa-search", "Exa"], ["brave-search", "Brave"]]),
  }));
  const checked = items.filter((i) => i.label.startsWith("✓ "));
  assert.equal(checked.length, 1);
  assert.equal(checked[0].value, "exa-search");
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- --test-name-pattern "buildSelectItems" 2>&1 | tail -5`
Expected: FAIL — `buildSelectItems` is not exported / not defined

- [ ] **Step 3: 最小实现**

在 `src/tools/search-config.ts`（import 加 `type SelectItem`；`buildProviderItems` 之后新增）：

```typescript
export function buildSelectItems(params: ProviderSubmenuParams): readonly SelectItem[] {
  const { currentProvider, catalog } = params;
  const isCurrentAuto = currentProvider === undefined || currentProvider === "auto";
  const check = (active: boolean): string => (active ? "✓ " : "");
  const autoItem: SelectItem = {
    value: AUTO_ID,
    label: `${check(isCurrentAuto)}${AUTO_LABEL}`,
  };
  const providerItems: SelectItem[] = catalog.providers.map((p) => ({
    value: p.id,
    label: `${check(p.id === currentProvider)}${p.name || p.id}`,
  }));
  return [autoItem, ...providerItems];
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- --test-name-pattern "buildSelectItems" 2>&1 | tail -5`
Expected: PASS（`# pass 3`）

- [ ] **Step 5: 全量回归 + commit**

Run: `npm run typecheck && npm test`
Expected: typecheck 0；153/153 pass（新 3 测试 + 旧 150，render 层未动）

```bash
git add test/search-config-select-items.test.ts src/tools/search-config.ts
git commit -m "refactor: add buildSelectItems producing official SelectItem[] with ✓ marker"
```

## Task 2: renderProviderSubmenu 官方化（SelectList + DynamicBorder + Text）

**Files:**
- Modify: `test/search-config-submenu.test.ts`（重写：删 `_sl.onChange` hook 用法、SettingsList invariant 测试；新增 SelectList/边框/✓/无 value 列断言）
- Modify: `src/tools/search-config.ts`（重写 `renderProviderSubmenu`；删 `buildProviderItems`/`ProviderItem`；import 换 `SelectList, Text` + `DynamicBorder, getSelectListTheme`；`ProviderSubmenuParams.theme` 类型改 `Theme`；`ProviderSubmenuParams` 增 `requestRender?: () => void`）

**Interfaces:**
- Consumes: `buildSelectItems`（Task 1）、`AUTO_ID`、`ProviderSubmenuParams`、`getSelectListTheme()`、`Theme`（UI theme，含 `fg/bold`）
- Produces: `renderProviderSubmenu(params: ProviderSubmenuParams): Component` — 官方 Pattern 1 结构；`ProviderSubmenuParams.requestRender?: () => void`（handleInput 后调用）；测试经 `(container as any)._sl` 暴露 SelectList 实例

- [ ] **Step 1: 重写测试（红）**

```typescript
// test/search-config-submenu.test.ts（全文替换）
import { test } from "node:test";
import assert from "node:assert/strict";
import { initTheme, type Theme } from "@earendil-works/pi-coding-agent";
import { renderProviderSubmenu, type ProviderSubmenuParams } from "../src/tools/search-config.ts";
import type { SearchCatalog, SearchProviderEntry } from "../src/tools/search-config.ts";

// getSelectListTheme()/keyHint() 依赖全局 theme proxy（Symbol.for 共享）——单测必须先初始化。幂等。
initTheme();

function makeCatalog(entries: Array<[string, string]>, isFallback = false): SearchCatalog {
  const providers: SearchProviderEntry[] = entries.map(([id, name]) => ({ id, name, search_types: ["web"] }));
  return { providers, isFallback };
}

// identity fakeTheme：保留文本（Proxy 返回 "" 会把边框/标题吞成空串，无法断言）
const fakeTheme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as unknown as Theme;

function makeParams(overrides: Partial<ProviderSubmenuParams> = {}): ProviderSubmenuParams {
  return {
    currentProvider: undefined,
    catalog: makeCatalog([]),
    theme: fakeTheme,
    onCommit: () => {},
    onCancel: () => {},
    ...overrides,
  };
}

function renderOutput(params: ProviderSubmenuParams): string[] {
  const component = renderProviderSubmenu(params) as unknown as { render: (w: number) => string[] };
  return component.render(80);
}

test("renderProviderSubmenu: border top/bottom lines and title row", () => {
  const out = renderOutput(makeParams({ catalog: makeCatalog([["tavily-search", "Tavily"]]) }));
  const joined = out.join("\n");
  assert.match(out[0], /^─+$/, "first line must be the top border");
  assert.match(out[out.length - 1], /^─+$/, "last line must be the bottom border");
  assert.match(joined, /Search Provider/i, "title row must exist");
});

test("renderProviderSubmenu: rows show no value column", () => {
  const out = renderOutput(makeParams({
    currentProvider: "tavily-search",
    catalog: makeCatalog([["tavily-search", "Tavily"], ["brave-search", "Brave"]]),
  }));
  // SelectItem 无 currentValue；SelectList 渲染 = prefix + label，无第二列。
  // 行尾不得出现 provider id（value 列泄漏的典型特征）。
  const lines = out.filter((l) => /tavily-search|brave-search|Auto/i.test(l));
  for (const line of lines) {
    assert.doesNotMatch(line, /\S+\s+(tavily-search|brave-search|auto)\s*$/, `value column leaked: ${line}`);
  }
});

test("renderProviderSubmenu: ✓ marker on active provider row only", () => {
  const out = renderOutput(makeParams({
    currentProvider: "tavily-search",
    catalog: makeCatalog([["tavily-search", "Tavily"], ["brave-search", "Brave"]]),
  }));
  const joined = out.join("\n");
  assert.match(joined, /✓ Tavily/, "active provider row must show ✓ prefix");
  assert.doesNotMatch(joined, /✓ Brave/, "inactive provider row must not show ✓");
});

test("renderProviderSubmenu: ✓ marker on auto row when unconfigured", () => {
  const out = renderOutput(makeParams({ catalog: makeCatalog([["tavily-search", "Tavily"]]) }));
  assert.match(out.join("\n"), /✓ Auto \(follow server default\)/, "auto row must be checked when unconfigured");
});

test("renderProviderSubmenu: fallback hint is rendered inside the border", () => {
  const out = renderOutput(makeParams({ catalog: makeCatalog([], true) }));
  const joined = out.join("\n");
  assert.match(joined, /unreachable/i, "fallback hint must mention unreachable");
  const hintLine = out.findIndex((l) => /unreachable/i.test(l));
  assert.ok(hintLine > 0 && hintLine < out.length - 1, "hint must sit between border lines");
});

test("renderProviderSubmenu: Enter on provider row commits its value", () => {
  const calls: Array<[string, unknown?]> = [];
  const params = makeParams({
    currentProvider: undefined,
    catalog: makeCatalog([["tavily-search", "Tavily"]]),
    onCommit: (p) => calls.push(["commit", p]),
  });
  const component = renderProviderSubmenu(params) as unknown as { _sl: { onSelect?: (item: { value: string }) => void } };
  component._sl.onSelect?.({ value: "tavily-search", label: "Tavily" });
  assert.deepEqual(calls, [["commit", "tavily-search"]]);
});

test("renderProviderSubmenu: Enter on auto row commits undefined", () => {
  const calls: Array<[string, unknown?]> = [];
  const params = makeParams({
    currentProvider: "tavily-search",
    catalog: makeCatalog([["tavily-search", "Tavily"]]),
    onCommit: (p) => calls.push(["commit", p]),
  });
  const component = renderProviderSubmenu(params) as unknown as { _sl: { onSelect?: (item: { value: string }) => void } };
  component._sl.onSelect?.({ value: "auto", label: "Auto (follow server default)" });
  assert.deepEqual(calls, [["commit", undefined]]);
});

test("renderProviderSubmenu: Esc invokes onCancel", () => {
  const calls: Array<[string, unknown?]> = [];
  const params = makeParams({ onCancel: () => calls.push(["cancel"]) });
  const component = renderProviderSubmenu(params) as unknown as { handleInput: (data: string) => void };
  component.handleInput("\x1b");
  assert.deepEqual(calls, [["cancel"]]);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- test/search-config-submenu.test.ts 2>&1 | tail -8`
Expected: FAIL（当前 render 无边框/无 ✓；`_sl.onSelect` 不存在；SettingsList invariant 测试仍在）

- [ ] **Step 3: 实现**

`src/tools/search-config.ts` 修改：

```typescript
import { Container, SelectList, Text, type Component, type SelectItem } from "@earendil-works/pi-tui";
import type { TUI } from "@earendil-works/pi-tui";
import { DynamicBorder, getSelectListTheme, keyHint, type Theme } from "@earendil-works/pi-coding-agent";
```

删除 `ProviderItem` 接口与 `buildProviderItems` 函数（保留 `buildSelectItems`）。`ProviderSubmenuParams` 改为：

```typescript
export interface ProviderSubmenuParams {
  readonly currentProvider: string | undefined;
  readonly catalog: SearchCatalog;
  readonly theme: Theme;                       // UI theme (has .fg) — was SettingsListTheme
  readonly onCommit: (provider: string | undefined) => void;
  readonly onCancel: () => void;
  readonly requestRender?: () => void;         // Pattern 1: repaint after input
}
```

重写 `renderProviderSubmenu`：

```typescript
export function renderProviderSubmenu(params: ProviderSubmenuParams): Component {
  const items = buildSelectItems(params);
  const { theme } = params;
  const selectList = new SelectList(items, Math.min(items.length, 15), getSelectListTheme());
  selectList.onSelect = (item: SelectItem): void => {
    if (item.value === AUTO_ID) {
      params.onCommit(undefined);
    } else {
      params.onCommit(item.value);
    }
  };
  selectList.onCancel = params.onCancel;

  const container = new Container();
  container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
  container.addChild(new Text(theme.fg("accent", theme.bold("Search Provider")), 1, 0));
  if (params.catalog.isFallback) {
    container.addChild(new Text(theme.fg("warning", "OmniRoute search catalog unreachable, using built-in list"), 1, 0));
  }
  container.addChild(selectList as unknown as Component);
  container.addChild(new Text(theme.fg("dim", keyHint("tui.select.up", "navigate") + " · " + keyHint("tui.select.confirm", "select") + " · " + keyHint("tui.select.cancel", "back")), 1, 0));
  container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

  // A bare Container does not forward input; route keypresses to the SelectList.
  (container as unknown as { handleInput: (data: string) => void }).handleInput = (data: string): void => {
    selectList.handleInput(data);
    params.requestRender?.();
  };

  // Expose the SelectList for unit tests (see test/search-config-submenu.test.ts).
  (container as unknown as { _sl: SelectList })._sl = selectList;

  return container as unknown as Component;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- test/search-config-submenu.test.ts 2>&1 | tail -8`
Expected: PASS（`# pass 9`；`_sl.onSelect`/Esc/边框/✓/无 value 列全绿）

- [ ] **Step 5: 全量回归（theme 通道切换）+ commit**

`renderProviderSubmenu` 官方化会立刻破坏两处类型：state machine 的 `getComponent(tui, theme: ReturnType<typeof getSettingsListTheme>)`（调用处传 `params.theme` 变 `Theme`）与 index.ts 的 `smTheme = getSettingsListTheme()`（SettingsListTheme 与 UI Theme 结构不兼容，无法互赋）。必须同 commit 完成 theme 通道切换，保持每步 typecheck 全绿。

**5a. `src/tools/search-config.ts` — state machine 签名 + deps 移除 theme：**

```typescript
// createMenuStateMachine 内部：
export function createMenuStateMachine(deps: MenuStateMachineDeps): MenuStateMachine {
  // ...
  getComponent: (tui: TUI, theme: Theme): Component => {   // was ReturnType<typeof getSettingsListTheme>
    // renderProviderSubmenu / renderTopLevelMenu 调用处 theme 参数自动适配
  },
  // ...
}
```

删除 `MenuStateMachineDeps` 的 `readonly theme: ReturnType<typeof getSettingsListTheme>;` 字段（state machine 内从未读取 deps.theme，getComponent 用参数）。**renderProviderSubmenu 调用处（sub 分支）补传 `requestRender: () => tui.requestRender()`**（Pattern 1 渲染循环依赖）；import 变更：pi-tui 移除 `SettingsList`、新增 `SelectList, Text`（`type SelectItem` 已有）；pi-coding-agent 移除 `getSettingsListTheme`、新增 `getSelectListTheme, keyHint, DynamicBorder, type Theme`。

**5b. `src/index.ts` — custom 回调用 UI theme 替换 smTheme：**

```typescript
// 删除：const smTheme = getSettingsListTheme();
// 删除 createMenuStateMachine({ ... theme: smTheme, ... }) 中的 theme 字段
// ctx.ui.custom((tui, theme, _kb, done) => {   // _theme → theme（不再忽略）
//   ... 两处 sm.getComponent(tui, smTheme) → sm.getComponent(tui, theme) ...
// })
```

**5c. `test/search-config-state-machine.test.ts` — makeDeps 删除 theme 字段 + initTheme：**

```typescript
import { initTheme } from "@earendil-works/pi-coding-agent";
initTheme();  // getComponent 构建 renderTopLevelMenu/renderProviderSubmenu 时 keyHint() 需要全局 theme

function makeDeps(overrides: Partial<MenuStateMachineDeps> = {}): MenuStateMachineDeps {
  const commits: Array<[string | undefined, string]> = [];
  return {
    resolveApiKey: async () => "k",
    resolveBaseUrl: () => "http://x",
    initialCurrentProvider: undefined,
    onCommitPersist: (provider) => commits.push([provider, "persisted"]),
    onClose: () => {},
    ...overrides,
  };
}
```

（`getComponent(tui, fakeTheme)` 调用处不变 — identity fakeTheme 需从 Proxy 改为 `{ fg: (_c, s) => s, bold: (s) => s } as unknown as Theme` 以保持渲染断言可用。）

Run: `npm run typecheck && npm test`
Expected: typecheck 0；153/153（submenu 重写 9 + select-items 3 新增，旧 submenu 6 删除）

```bash
git add test/search-config-submenu.test.ts test/search-config-select-items.test.ts src/tools/search-config.ts src/index.ts
git commit -m "feat: official SelectList+DynamicBorder submenu with UI theme channel"
```

## Task 3: renderTopLevelMenu 官方化（Text + 单项 SelectList + DynamicBorder + keyHint）

**Files:**
- Modify: `test/search-config-toplevel.test.ts`（更新断言：边框/标题/单项 SelectList 行/Enter 激活/Esc 不激活）
- Modify: `src/tools/search-config.ts`（重写 `renderTopLevelMenu`；`TopLevelMenuParams.theme` 类型改 `Theme`；`TopLevelMenuParams` 增 `onClose?: () => void`）

**Interfaces:**
- Consumes: `previewForProvider(currentProvider)`（保留）、`getSelectListTheme()`、`keyHint`、`Theme`
- Produces: `renderTopLevelMenu(params: TopLevelMenuParams): Component` — 官方 Pattern 1；单项 SelectList `{value: "provider", label: "Search provider: <preview>"}`；`onSelect` → `onActivateSearchProvider()`；`onCancel` → `params.onClose?.()`

- [ ] **Step 1: 更新测试（红）**

```typescript
// test/search-config-toplevel.test.ts（全文替换）
import { test } from "node:test";
import assert from "node:assert/strict";
import { initTheme, type Theme } from "@earendil-works/pi-coding-agent";
import { renderTopLevelMenu, type TopLevelMenuParams } from "../src/tools/search-config.ts";

initTheme();  // keyHint() 构建时调用 theme.fg，需要全局 theme

const fakeTheme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as unknown as Theme;

function makeParams(overrides: Partial<TopLevelMenuParams> = {}): TopLevelMenuParams {
  return {
    currentProvider: "tavily-search",
    theme: fakeTheme,
    onActivateSearchProvider: () => {},
    ...overrides,
  };
}

test("renderTopLevelMenu: border lines, title, and provider row rendered", () => {
  const params = makeParams({ currentProvider: "tavily-search" });
  const component = renderTopLevelMenu(params) as unknown as { render: (w: number) => string[] };
  const out = component.render(80);
  const joined = out.join("\n");
  assert.match(out[0], /^─+$/, "first line must be the top border");
  assert.match(out[out.length - 1], /^─+$/, "last line must be the bottom border");
  assert.match(joined, /OmniRoute Settings/i, "title must exist");
  assert.match(joined, /Search provider:\s+tavily-search/i, "row must contain provider preview");
});

test("renderTopLevelMenu: undefined currentProvider shows 'Auto' preview", () => {
  const params = makeParams({ currentProvider: undefined });
  const component = renderTopLevelMenu(params) as unknown as { render: (w: number) => string[] };
  assert.match(component.render(80).join("\n"), /Search provider:\s+Auto/i);
});

test("renderTopLevelMenu: Enter triggers onActivateSearchProvider", () => {
  let activated = false;
  const params = makeParams({ onActivateSearchProvider: () => { activated = true; } });
  const component = renderTopLevelMenu(params) as unknown as { handleInput: (data: string) => void };
  component.handleInput("\r");
  assert.equal(activated, true);
});

test("renderTopLevelMenu: Esc does not trigger activation, invokes onClose", () => {
  let activated = false;
  let closed = 0;
  const params = makeParams({
    onActivateSearchProvider: () => { activated = true; },
    onClose: () => { closed++; },
  });
  const component = renderTopLevelMenu(params) as unknown as { handleInput: (data: string) => void };
  component.handleInput("\x1b");
  assert.equal(activated, false);
  assert.equal(closed, 1, "Esc on top-level must invoke onClose");
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- test/search-config-toplevel.test.ts 2>&1 | tail -8`
Expected: FAIL（无边框/无 onClose；Esc 断言挂）

- [ ] **Step 3: 实现**

`src/tools/search-config.ts`：

```typescript
export interface TopLevelMenuParams {
  readonly currentProvider: string | undefined;
  readonly theme: Theme;                       // UI theme — was SettingsListTheme
  readonly onActivateSearchProvider: () => void;
  readonly onClose?: () => void;               // Esc at top closes the overlay
  readonly requestRender?: () => void;         // Pattern 1: repaint after input
}
```

重写 `renderTopLevelMenu`（同 Task 2 Pattern 1 结构，单项 SelectList）：

```typescript
export function renderTopLevelMenu(params: TopLevelMenuParams): Component {
  const { currentProvider, theme, onActivateSearchProvider } = params;
  const preview = previewForProvider(currentProvider);
  const items: SelectItem[] = [{ value: "provider", label: `Search provider: ${preview}` }];
  const selectList = new SelectList(items, 1, getSelectListTheme());
  selectList.onSelect = () => onActivateSearchProvider();
  selectList.onCancel = () => params.onClose?.();

  const container = new Container();
  container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
  container.addChild(new Text(theme.fg("accent", theme.bold("OmniRoute Settings")), 1, 0));
  container.addChild(selectList as unknown as Component);
  container.addChild(new Text(theme.fg("dim", keyHint("tui.select.confirm", "activate") + " · " + keyHint("tui.select.cancel", "close")), 1, 0));
  container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

  (container as unknown as { handleInput: (data: string) => void }).handleInput = (data: string): void => {
    selectList.handleInput(data);
    params.requestRender?.();
  };
  return container as unknown as Component;
}
```

**同时接线 state machine 调用处**（`createMenuStateMachine` 的 top 分支）：

```typescript
return renderTopLevelMenu({
  currentProvider,
  theme,
  onActivateSearchProvider: () => {
    mode = "sub";
    cachedSubmenu = undefined;
    tui.requestRender();
    void fetchCatalogAsync(tui);
  },
  onClose: () => {
    cachedSubmenu = undefined;
    pendingFetch?.abort();
    mode = "top";
    deps.onClose();
  },
  requestRender: () => tui.requestRender(),
});
```

**注意（Esc 双路径）**：index.ts wrapper 的 `handleInput` 里 `if (data === "\x1b" && sm.mode() === "top") { done(undefined); return; }` 已拦截顶层 Esc（关闭 overlay）——SelectList 的 onCancel 经 `onClose` 会再触发 `deps.onClose()`。保持 wrapper 拦截优先，`onClose` 仅供组件级 Esc 兜底；不改变 wrapper 逻辑。

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- test/search-config-toplevel.test.ts 2>&1 | tail -8`
Expected: PASS（`# pass 4`）

- [ ] **Step 5: 全量回归 + commit**

Run: `npm run typecheck && npm test`
Expected: typecheck 0；153/153

```bash
git add test/search-config-toplevel.test.ts src/tools/search-config.ts
git commit -m "feat: render top-level settings menu with official scaffold + single-item SelectList"
```

## Task 4: 验证收尾

**Files:** `openspec/changes/improve-omniroute-settings-ui/tasks.md`（勾选）

**Interfaces:** 无代码改动 — Task 0-3 已完成全部功能；本任务验证 + 文档收尾。

- [ ] **Step 1: 全量验证**

Run: `npm run typecheck && npm test`
Expected: typecheck 0；`# pass 153` 或以上（基线 153 − 旧 submenu 6 − 旧 toplevel 4 + select-items 3 + submenu 重写 9 + toplevel 4 等，净增随实现确认），`# fail 0`

- [ ] **Step 2: 禁改文件复查**

Run: `git diff --name-only HEAD~3`
Expected: 仅含 `src/tools/search-config.ts`、`src/index.ts`、`test/search-config-*.test.ts`、`openspec/changes/improve-omniroute-settings-ui/*`；不含 http.ts/web-fetch.ts/search.ts/auth*/lazy-fetch.test.ts/tools-*.test.ts

- [ ] **Step 3: 勾选 tasks.md**

将 `openspec/changes/improve-omniroute-settings-ui/tasks.md` 全部复选框 `[ ]` → `[x]`（内容已按本 plan 结构重排为 4 组 9 任务：① 数据层 buildSelectItems ② 二级面板官方化 ③ 顶层菜单官方化+接线 ④ 验证收尾）

- [ ] **Step 4: docs commit**

```bash
git add openspec/changes/improve-omniroute-settings-ui/tasks.md
git commit -m "docs(openspec): tick all tasks for improve-omniroute-settings-ui"
```

- [ ] **Step 5: 最终 review**

Run: `git log --oneline -5` 确认 3 个实现 commit + 1 个 docs commit；派 reviewer 核对：每决策落实（DynamicBorder 边框 / SelectList 无 value 列 / ✓ 数据层前缀 / 顶层单项 SelectList / 官方 getSelectListTheme / deps.theme 移除）、禁改文件 0 diff、测试全绿、无自定义渲染残留（grep `render: (_w` / `withBorder` / `SettingsList` 应为空）

## Task 5: 验证收尾

**Files:** `openspec/changes/improve-omniroute-settings-ui/tasks.md`（勾选）

- [ ] **Step 1: 全量验证**

Run: `npm run typecheck && npm test`
Expected: typecheck 0；`# pass 153` 或以上（基线 153 + select-items 3 新增 ± 重写净变化），`# fail 0`

- [ ] **Step 2: 禁改文件复查**

Run: `git diff --name-only HEAD~4`
Expected: 仅含 `src/tools/search-config.ts`、`src/index.ts`、`test/search-config-*.test.ts`、`openspec/changes/improve-omniroute-settings-ui/*`；不含 http.ts/web-fetch.ts/search.ts/auth*/lazy-fetch.test.ts/tools-*.test.ts

- [ ] **Step 3: 勾选 tasks.md**

将 `openspec/changes/improve-omniroute-settings-ui/tasks.md` 全部复选框 `[ ]` → `[x]`（4 组 10 任务：withBorder 工具任务改为官方 SelectList/DynamicBorder 对应任务——已按本 plan 结构重排）

- [ ] **Step 4: docs commit**

```bash
git add openspec/changes/improve-omniroute-settings-ui/tasks.md
git commit -m "docs(openspec): tick all tasks for improve-omniroute-settings-ui"
```

- [ ] **Step 5: 最终 review**

Run: `git log --oneline -6` 确认 5 个实现 commit + 1 个 docs commit；派 reviewer 核对：每决策落实（DynamicBorder 边框 / SelectList 无 value 列 / ✓ 数据层前缀 / 顶层单项 SelectList / 官方 getSelectListTheme / deps.theme 移除）、禁改文件 0 diff、测试全绿、无自定义渲染残留（grep `render: (_w` / `withBorder` 应为空）

## 风险备注

- **SelectList 单测依赖 `getKeybindings()`**：懒加载单例 + 默认 TUI_KEYBINDINGS（confirm="enter", cancel=["escape","ctrl+c"]）→ `"\r"`/`"\x1b"` 直接匹配（已核实 matchesKey 实现）。若未来 pi-tui 改默认绑定，测试断言 Esc/Enter 需同步
- **DynamicBorder jiti theme 陷阱**：必须显式传 `(s) => theme.fg("accent", s)`，永不依赖全局 theme（dynamic-border.js 注释）
- **全局 theme 依赖（单测）**：`getSelectListTheme()`（render 时解析）与 `keyHint()`（构建时解析）都走全局 theme proxy（Symbol.for 共享）；三个测试文件（submenu/toplevel/state-machine）顶层必须 `initTheme()`，否则抛 "Theme not initialized. Call initTheme() first."
- **fakeTheme 必须 identity**：Proxy 返回 `""` 会把 DynamicBorder/Text 输出吞成空串 → 边框断言失败；用 `{ fg: (_c, s) => s, bold: (s) => s } as unknown as Theme`
- **SelectList 选中前缀 `"→ "` 硬编码**（select-list.js renderItem）：与 ✓ 前缀 `"✓ "` 同宽共存，列对齐稳定；无需配置
- **顶层 Esc 双路径**：index.ts wrapper 拦截优先（`done(undefined)`），组件级 `onClose` 兜底；保持现有 wrapper 逻辑不变，避免双重关闭
- **`deps.theme` 移除**：index.ts 在 `ctx.ui.custom` 之前构造 state machine，拿不到 UI theme → theme 必须经 `getComponent(tui, theme)` 参数传入（custom 回调内）
- **hint 文案**：不再写 "↑/↓ or j/k"（SelectList 无 j/k 导航），改用 `keyHint("tui.select.up"/"confirm"/"cancel")` 动态渲染（输出形如 "up navigate · enter select · esc/ctrl+c back"）
- **Text 组件 padding**：`new Text(str, 1, 0)` — paddingX=1 左右各 1 空格、paddingY=0 无空行；Text render 会把每行 pad 到 width（行尾空格），断言用子串匹配即可

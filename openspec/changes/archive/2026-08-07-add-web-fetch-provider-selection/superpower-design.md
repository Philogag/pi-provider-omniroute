# 设计:add-web-fetch-provider-selection

> 上游需求来自 OpenSpec（proposal.md / design.md / specs/web-fetch-provider-config/spec.md），本文档为深度技术设计，不重新定义需求。

## 背景与现状

`omniroute_web_fetch` 工具（src/tools/web-fetch.ts）当前仅透传显式 `provider` 参数（`buildFetchBody`：`if (params.provider !== undefined) body.provider = params.provider`），无默认配置机制。`FETCH_PROVIDERS = ["firecrawl","jina-reader","tavily-search","tinyfish"]` 为静态常量，`FETCH_FORMATS` 4 项。

既有 search provider 配置链路（src/tools/search-config.ts，已上线）为本变更的模板：
- `readOmnirouteConfig()` / `writeOmnirouteConfig(provider)`：操作 pi 全局 `omniroute.json` 的 `search.provider`，含 G6/G7 损坏 warn 语义
- `createMenuStateMachine(deps)`：`top/sub` 双模式 + `cachedSubmenu` 缓存 + 官方 Pattern 1 渲染（DynamicBorder + Text + SelectList + keyHint）
- `buildSelectItems(currentProvider)`：SelectItem[] + ✓ 数据层前缀
- src/index.ts：`/omniroute-settings` 命令 + `ctx.ui.custom` wrapper + `session_start` 加载 + search reader 注入（search.ts:9-19 模式）

本变更把同一配置链路扩展到 web-fetch 工具。fetch 无 `/v1/web/fetch` 目录端点（该接口是抓取接口），故 provider 列表为静态全集。

## 设计决策

### D1 数据层：扩展 read/writeOmnirouteConfig 签名（不做独立 IO 逻辑）

```
readOmnirouteConfig(): { search?: { provider?: string }; fetch?: { provider?: string } }
writeOmnirouteConfig(provider: string | undefined, key: "search" | "fetch" = "search"): void
```

- 返回类型扩展为双分支；既有 search 侧调用点改读 `.search.provider`（编译期强制同步）
- `writeOmnirouteConfig` 按 key 写对应分支，**保留根对象其他字段**（`search`/`fetch` 互不干扰，向后兼容已写出的 `search.provider`）
- 复用既有 G6/G7 损坏 warn 语义：根非对象 / 分支非对象 / `provider` 类型不符 / JSON 损坏 → 视为无配置 + `console.warn` 一次，不抛错
- `fetch` 键缺失 / `fetch.provider` 缺失 → `undefined`（auto），不破坏既有文件
- 写入失败 → `console.warn` 不抛错，UI 继续（spec: 写入失败不阻塞 UI）

[替代方案：独立 `readFetchConfig`/`writeFetchConfig` —— 重复 warn/损坏处理与文件路径解析，不选]

### D2 fetch provider 列表 = 静态 `FETCH_PROVIDERS` 4 项

- search 有 `/v1/search` 目录端点故拉取目录 + 静态回退；fetch 无目录端点，静态 4 项即全集
- 零网络依赖 → fetch 二级面板**无 Loading 态、无 pendingFetch、无 abort、无 fallback hint**
- `buildFetchSelectItems(currentFetchProvider: string | undefined): readonly SelectItem[]`：
  - 首项 auto：`{ value: AUTO_ID("auto"), label: AUTO_LABEL("Auto (follow server default)") }`
  - 随后按 `FETCH_PROVIDERS` 顺序 4 项：`{ value: id, label: id }`（fetch 无 name/description 元数据，label = id）
  - ✓ 前缀规则（与 search 不同的简化语义，见 D3）：当前配置规范化后命中某成员 → 该成员 ✓；否则 **auto 项 ✓**（无零勾选态）

[替代方案：仿 search 拉取目录 —— 端点不存在，不可行]

### D3 规范化点：`normalizeFetchProvider`（本次与 search 版的关键差异）

```
normalizeFetchProvider(raw: string | undefined): string | undefined
  // FETCH_PROVIDERS.includes(raw) ? raw : undefined
  // undefined / "auto" / 非成员 id（手写 json 如 "foo"）→ undefined
```

**唯一调用点：src/index.ts `session_start` 加载处** `currentFetchProvider = normalizeFetchProvider(config.fetch?.provider)`。

用户决策：非法 id（合法 string 但不在 `FETCH_PROVIDERS`）**视为未配置**。此决策区别于 search 版行为（显示原值 + 零勾选，为 search 版 final review 的 Important#2 deferred follow-up；本变更落实其建议的"回退 auto 行"方向）。

规范化在加载点完成保证**三处一致**：
1. 二级面板 ✓：`normalizeFetchProvider(current)` 非 undefined → 匹配项 ✓；否则 auto ✓
2. 工具合并：`currentFetchProvider` 只可能是成员 id 或 undefined → 无非法值注入请求体
3. 持久化：UI 只写成员 id 或 undefined

### D4 渲染：官方脚手架，镜像 renderProviderSubmenu

**二级面板 `renderFetchSubmenu(params: FetchSubmenuParams)`**（官方 Pattern 1）：

```
Container:
  ├─ DynamicBorder(borderColor)        // 顶线 ──
  ├─ Text("Web Fetch provider", 1, 0)  // 标题
  ├─ SelectList(items, 5, getSelectListTheme())
  │    items = buildFetchSelectItems(currentFetchProvider)
  ├─ keyHint 渲染提示行                 // "up navigate · enter select · esc/ctrl+c back"
  └─ DynamicBorder(borderColor)        // 底线 ──
```

- `FetchSubmenuParams`：`{ currentFetchProvider: string | undefined; theme: Theme; onCommit(value: string | undefined): void; onCancel(): void; requestRender?: () => void }`
- SelectList `onSelect(item)` → `params.onCommit(item.value === AUTO_ID ? undefined : item.value)`
- SelectList `onCancel()` → `params.onCancel()`
- 暴露 `_sl`（SelectList 实例）供测试直接驱动 onSelect/onCancel
- `container.handleInput` 手动转发 SelectList.handleInput + `tui.requestRender()`（Container 不转发 handleInput）
- 无 Loading/fallback 分支（静态列表）

**顶层菜单 `renderTopLevelMenu`** 改造为两行单项 SelectList：

```
Container:
  ├─ DynamicBorder 顶线
  ├─ Text("OmniRoute Settings", 1, 0)
  ├─ SelectList([
  │     { value: "search", label: "Search provider: <preview>" },
  │     { value: "fetch",   label: "Web Fetch provider: <fetchPreview>" },
  │   ], 2, getSelectListTheme())
  ├─ keyHint 提示行
  └─ DynamicBorder 底线
```

- `TopLevelMenuParams` 增 `fetchPreview: string`（未配置/auto/非法 → `"Auto"`，否则 provider id）
- SelectList `onSelect(item)` → item.value === "search" ? `onActivateSearchProvider()` : `onActivateFetchProvider()`
- 两行各自独立选中态由 SelectList 管理；选中行显示 "→ " 前缀（官方 SelectList cursor）

[替代方案：复用 renderProviderSubmenu 加参数 —— 两面板标题/数据源/回调不同，泛化收益低，不选]

### D5 状态机三分支 + 双缓存

```
type MenuMode = "top" | "sub-search" | "sub-fetch"
cachedSearchSubmenu / cachedFetchSubmenu（各自沿用现有 cachedSubmenu 的 8 路径失效：
  onCommit / onCancel / onEsc / onActivateSearchProvider / onActivateFetchProvider /
  loading-Esc abort / submenu onCommit / submenu onCancel）
```

- `onActivateFetchProvider` → mode="sub-fetch" + 重置 `cachedFetchSubmenu` + `tui.requestRender()`
- sub-fetch `getComponent(tui, theme)` 返回 `cachedFetchSubmenu ?? (cachedFetchSubmenu = renderFetchSubmenu({...}))`（缓存跨渲染保持 SelectList 光标态；commit/cancel/esc 时失效重建）
- sub-fetch `onCommit(value)` → `writeOmnirouteConfig(value, "fetch")` + `deps.onCommitPersist()`（既有 deps 字段，search 分支同用，非新增）→ 回 top + 重置缓存
- sub-fetch `onCancel()` → 回 top + 重置缓存
- fetch 分支无 Loading 态 / 无 pendingFetch

[替代方案：泛化单缓存 + mode 映射 —— 增加失效复杂度，不选]

### D6 工具三态合并（src/tools/web-fetch.ts，本次首次改动）

```
execute(params):
  effectiveProvider = params.provider !== undefined
    ? params.provider
    : (currentFetchProvider !== undefined && currentFetchProvider !== "auto"
        ? currentFetchProvider
        : undefined)
  body = buildFetchBody({ ...params, provider: effectiveProvider })
```

- `currentFetchProvider` 由 src/index.ts 工具注册时注入 reader（仿 search.ts:9-19 模式：reader 闭包读模块级 `currentFetchProvider`，session_start 时更新）
- TypeBox schema 不变：`provider` 仍为静态 4 项字面量联合，非静态 id 被 schema 拒绝（与 search G4 防御一致，无注入面）
- `buildFetchBody` / `extractFetchContent` / `FETCH_CONTENT_LIMIT` 语义不变

## 边界条件与错误处理

| 条件 | 行为 |
|---|---|
| `omniroute.json` 不存在 | 无配置，auto；`session_start` 不创建文件 |
| 根非对象 / JSON 损坏 / `fetch` 非对象 / `fetch.provider` 类型不符 | warn 一次 → auto |
| `fetch.provider` = "auto" / 缺失 | auto（工具不携带 provider） |
| `fetch.provider` = 非成员 id（"foo"） | **视为未配置**（normalizeFetchProvider → undefined；UI ✓ 在 auto；不注入请求体） |
| 写入选定成员 id | 根对象保留其他字段，写 `fetch.provider` |
| 写入 auto | `fetch.provider` 写 undefined（`fetch` 键可整体移除），其他根字段不变 |
| 写入失败（权限/磁盘） | warn 不抛，UI 继续 |
| fetch 配置存在但 search 未配置 | search 工具请求体不携带 provider（互不影响） |
| 顶层 Esc | 关闭菜单不修改配置 |
| 二级面板 Esc | 返回 top 不写配置 |

## 官方 API 事实（已验证）

- **DynamicBorder**：`new DynamicBorder(colorFn)`，render(w) → `[color("─".repeat(Math.max(1,w)))]`；jiti 加载时全局 theme 可能 undefined → **必须显式传 color fn**
- **SelectList**：`new SelectList(items, maxVisible, theme, layout?)`；onSelect(item)/onCancel()/onSelectionChange(item)；选中前缀硬编码 `"→ "`；无 value 列
- **getSelectListTheme()**：官方导出，`{selectedPrefix/selectedText: accent, description/scrollInfo/noMatch: muted}` — 不自建
- **keyHint(keybinding, desc)**：`getKeybindings().getKeys()` 动态渲染按键；**构建时立即调 theme.fg → 未 initTheme 抛错**（测试顶层需 initTheme()）
- **Text**：`new Text(str, paddingX=1, paddingY=1)`；paddingY 默认 1 → 用 `(str, 1, 0)`
- **Container**：children/addChild/invalidate；**无 handleInput**（手动转发）
- **keybindings**：TUI_KEYBINDINGS `confirm="enter"` / `cancel=["escape","ctrl+c"]` / up/down；matchesKey：enter 匹配 `"\r"`（或非 kitty 的 `"\n"`），escape 匹配 `"\x1b"` → 单测可用 `"\r"`/`"\x1b"` 驱动

## 测试策略

镜像 search 版测试命名与断言模式：

| 测试文件 | 覆盖 |
|---|---|
| `test/search-config-fetch-select-items.test.ts` | 5 行顺序（auto 首项 + FETCH_PROVIDERS 4 项）；✓ 四态：undefined→auto ✓ / "auto"→auto ✓ / 非成员 id→auto ✓ / 成员 id→匹配 ✓；无零勾选态 |
| `test/search-config-fetch-submenu.test.ts` | Pattern 1 渲染（边框 /^─+$/ 顶底线、标题 Text、SelectList、hint）；无 value 列（SelectItem 无 currentValue/values）；`_sl.onSelect` → onCommit（成员→id，auto→undefined）；`_sl.onCancel` → onCancel；handleInput 转发 |
| `test/search-config-toplevel.test.ts`（更新） | 两行 label（Search provider / Web Fetch provider + 预览）；preview：配置成员→id，未配置/auto/非法→"Auto"；onSelect 分发 search/fetch |
| `test/search-config-state-machine.test.ts`（更新） | mode 三分支；onActivateFetchProvider→sub-fetch + 缓存重置；sub-fetch getComponent 返回缓存实例；onCommit→writeOmnirouteConfig(value,"fetch") + 回 top + 缓存重建；onCancel→回 top；fetch 分支无 pendingFetch/Loading；fetchPreview 传参 |
| `test/session-start-fetch-config.test.ts` | 加载 fetch.provider→currentFetchProvider；normalizeFetchProvider（成员保留/非法→undefined/"auto"→undefined）；损坏容错 warn；search/fetch 互不影响 |
| `test/web-fetch-merge.test.ts` | 显式入参覆盖配置 / 配置注入（成员 id）/ auto 或 undefined 省略 / fetch 配置不影响 search 请求体 |

fakeTheme：identity `{fg:(_c,s)=>s, bold:(s)=>s} as unknown as Theme`；顶层相关测试先 `initTheme()`；断言用字符串匹配（identity fakeTheme 无 ANSI）。

## 风险与权衡

- **顶层两行 label 变长** → SelectList 自适应截断（沿用现有策略）；预览截断策略同 search
- **双缓存状态面** → 失效路径与现有 cachedSubmenu 完全同构，测试逐一覆盖
- **✓ 语义与 search 版不同**（fetch 无零勾选态）→ 文档化差异；本变更即 search 版 Important#2 follow-up 的方向验证，search 版可后续对齐（不在本变更范围）
- **web-fetch.ts 首次进入改动范围** → 仅 execute 合并 + reader 注入点，`buildFetchBody`/`extractFetchContent` 语义不变；merge 专项测试守护
- **测试顶层 Esc 路径** → wrapper 拦截 `"\x1b"` 后 done(undefined) 的既有逻辑不变，fetch 行不引入新 Esc 分支
- **memoized 组件冻结 theme** → 缓存实例的 theme 固定至失效重建（与 search 版 §9.3 既有设计一致）

## 迁移计划

1. 数据层扩展（D1）+ normalizeFetchProvider（D3）→ search 侧调用点同步（编译期守护）→ 测试 1
2. 状态机三分支 + 双缓存（D5）→ 测试 2
3. 顶层两行 + renderFetchSubmenu（D4）→ 测试 3/4
4. 接线：index.ts session_start + fetch reader 注入（D3/D6）→ 测试 5
5. web-fetch.ts 三态合并（D6）→ 测试 6
6. 全量验证（typecheck + 全测）→ 归档

回滚：全部增量修改，`git revert` 即可；`fetch.provider` 键不影响既有 `search.provider` 行为。

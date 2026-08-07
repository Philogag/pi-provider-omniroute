## 上下文

`omniroute_web_fetch` 工具（src/tools/web-fetch.ts）当前仅透传显式 `provider` 参数（`buildFetchBody`：`if (params.provider !== undefined) body.provider = params.provider`），无默认配置机制。`FETCH_PROVIDERS` 为静态 4 项（firecrawl / jina-reader / tavily-search / tinyfish），`FETCH_FORMATS` 4 项。该文件位于上一变更（add-web-search-provider-selection）的禁改清单，本次变更将正式修改它。

`src/tools/search-config.ts` 已实现 search provider 的完整配置链路：`readOmnirouteConfig`/`writeOmnirouteConfig`（omniroute.json 的 `search.provider`）、`session_start` 加载、`createMenuStateMachine`（top/sub 双模式 + `cachedSubmenu` 缓存 + 官方 Pattern 1 渲染）、`buildSelectItems`（SelectItem[] + ✓ 数据层前缀）。`src/index.ts` 的 `/omniroute-settings` 命令 + `ctx.ui.custom` wrapper 已就绪。

约束：无新依赖；官方 TUI 组件（DynamicBorder/Text/SelectList/keyHint）渲染；TypeBox schema 静态字面量校验不变；既有 158/158 测试保持通过。

## 目标 / 非目标

**目标：**
- 顶层设置菜单新增 "Web Fetch provider" 项，进入 fetch 二级面板
- fetch 二级面板：静态 4 项 + ✓ 标记 + 官方脚手架，与 search 子菜单视觉一致
- 选择持久化到 `omniroute.json` 的 `fetch.provider`（与 `search.provider` 并列，互不干扰）
- `session_start` 加载 `fetch.provider` 为 `currentFetchProvider`
- `omniroute_web_fetch` execute 三态合并：显式入参 > 已配置（非 undefined/非 "auto"）> 省略

**非目标：**
- 不引入 fetch provider 目录拉取（fetch 无 `/v1/web/fetch` 目录端点；静态 4 项即全部可用 provider）
- 不改 `FETCH_FORMATS` / depth / wait_for_selector 等其余参数逻辑
- 不合并 `search` 与 `fetch` 的配置结构（保持并列键，向后兼容已写出的 `search.provider`）
- 不引入自定义渲染或新依赖

## 决策

- **D1 数据层复用 `readOmnirouteConfig`/`writeOmnirouteConfig` 签名，扩展返回类型**：`readOmnirouteConfig(): { search?: { provider?: string }; fetch?: { provider?: string } }`。既有调用点（search 侧）改为读 `.search.provider`；fetch 读 `.fetch.provider`。`writeOmnirouteConfig(provider: string | undefined, key: "search" | "fetch" = "search")` 按 key 写对应分支。理由：同一文件、同一读写/损坏处理逻辑（G6/G7 warn 语义）复用，避免双份文件 IO 逻辑。[替代方案：新函数 `readFetchConfig` 独立读 —— 重复 warn/损坏处理，不选]
- **D2 fetch provider 列表 = 静态 `FETCH_PROVIDERS`（4 项）**：search 有 `/v1/search` 目录端点故拉取；fetch 无公开目录端点，静态 4 项即全集。`buildFetchSelectItems(currentFetchProvider)` 直接由常量构造 SelectItem[]（auto 首项 + 4 项，✓ 规则与 search 相同）。[替代方案：仿 search 拉取 —— 端点不存在，不可行]
- **D3 状态机扩展为三分支**：`mode: "top" | "sub-search" | "sub-fetch"`。顶层菜单用两行单项 SelectList（"Search provider" / "Web Fetch provider"），各行 onSelect 分别进入对应子面板；`cachedSubmenu` 改为 `cachedSearchSubmenu` + `cachedFetchSubmenu` 双缓存（各自按现有 8 路径失效规则）。fetch 子面板无拉取 → 无 Loading 态、无 pendingFetch。[替代方案：泛化单缓存 + mode 映射 —— 增加失效复杂度，不选]
- **D4 fetch 子面板渲染 = `renderFetchSubmenu` 官方 Pattern 1**：DynamicBorder + Text 标题 + SelectList（`getSelectListTheme()`）+ keyHint + DynamicBorder，结构与 `renderProviderSubmenu` 相同；`_sl` 暴露供测试；`onSelect` → `onCommitFetch(value)`，`onCancel` → 返回 top。[替代方案：复用 renderProviderSubmenu 加参数 —— 两面板标题/数据源/回调不同，泛化收益低，不选]
- **D5 工具三态合并仿 search.ts:157-158**：execute 中 `effectiveProvider = params.provider !== undefined ? params.provider : (currentFetchProvider 非 undefined 且非 "auto" ? currentFetchProvider : undefined)`；`body.provider = effectiveProvider`。`currentFetchProvider` 经 `src/index.ts` 在工具注册时注入 reader（与 search 的 `currentConfigProvider` 注入方式一致，见 search.ts:9-19 注释模式）。
- **D6 schema 不变**：`fetchParamsSchema.provider` 仍为静态 4 项字面量联合，非静态 id 被 TypeBox 拒绝（与 search G4 防御一致，无注入面）。

## 风险 / 权衡

- [既有 `omniroute.json` 只含 `search.provider`] → 读取容错：`fetch` 键缺失按 undefined（auto）处理，不破坏既有文件
- [顶层菜单从单项变两项，行 label 变长] → Text/SelectList 自适应宽度，预览截断策略沿用现有
- [双缓存增加状态面] → 失效路径集合与现有 `cachedSubmenu` 完全同构，测试逐一覆盖
- [web-fetch.ts 首次进入改动范围] → 仅 execute 合并逻辑 + reader 注入点，`buildFetchBody`/`extractFetchContent` 语义不变；补 merge 专项测试

## 迁移计划

1. 数据层扩展（D1）→ search 侧调用点同步更新（既有测试守护）
2. 状态机三分支 + 双缓存（D3）→ 顶层菜单两行（D3）→ fetch 子面板渲染（D4）
3. index.ts 注入 `currentFetchProvider` reader + session_start 加载
4. web-fetch.ts 三态合并（D5）
5. 全量验证 + 归档

回滚：全部为增量修改，回退 `git revert` 即可；`fetch.provider` 键不影响既有 `search.provider` 行为。

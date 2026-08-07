# Tasks: add-web-fetch-provider-selection

> 与 `superpower-plan.md` 任务一一对应（6 任务 / 6 组）。TDD 红→绿→commit，每任务独立 review gate。

## 1. 数据层：双分支配置形状 + normalizeFetchProvider + buildFetchSelectItems

- [x] 1.1 `readOmnirouteConfig(): { search?: { provider?: string }; fetch?: { provider?: string } }` 双分支读取（每分支独立容错 warn）；`writeOmnirouteConfig(provider, key: "search"|"fetch" = "search")` 按 key 写分支、保留其他根字段；更新 persistence round-trip 断言 + 4 个 fetch 分支用例；commit
- [x] 1.2 `normalizeFetchProvider(raw)`（web-fetch.ts：成员 id 通过，undefined/"auto"/非法 → undefined）+ `setFetchConfigReader(fn)` 骨架；`buildFetchSelectItems(currentFetchProvider)`（auto 首项 + FETCH_PROVIDERS 4 项，✓ 规则 = normalize 后成员匹配 else auto）；新增 test/search-config-fetch-select-items.test.ts + test/web-fetch-merge.test.ts（reader 层）；typecheck + 全测通过后 commit

## 2. 状态机三分支 + fetch 子菜单缓存

- [x] 2.1 `createMenuStateMachine` mode → `"top" | "sub-search" | "sub-fetch"`；`MenuStateMachineDeps` 增 `initialFetchProvider` + `onCommitFetchPersist`；`cachedSubmenu` 拆双缓存；`onActivateFetchProvider`；onCommit 按 mode 分发 search/fetch persist；`fetchCatalogAsync` guard 改 `"sub-search"`；`FetchSubmenuParams` 声明 + 临时 stub；更新 test/search-config-state-machine.test.ts（"sub"→"sub-search" + 4 个 fetch 用例）；commit

## 3. 渲染：官方 fetch 子面板 + 顶层两行

- [x] 3.1 `renderFetchSubmenu` 完整官方 Pattern 1（DynamicBorder + Text 标题 "Web Fetch Provider" + SelectList(getSelectListTheme) + keyHint + DynamicBorder；`_sl` 暴露；handleInput 转发）；新增 test/search-config-fetch-submenu.test.ts（8 用例：边框/5 行/无 value 列/✓ 规则/Enter 提交/Esc 取消）；commit
- [x] 3.2 `renderTopLevelMenu` 两行单项 SelectList（`{value:"search"}` / `{value:"fetch"}` + 预览）；`TopLevelMenuParams` 增 `fetchPreview: string` + `onActivateFetchProvider`；onSelect 按 value 分发；state machine top 分支传 `fetchPreview: previewForProvider(currentFetchProvider)` + onActivateFetchProvider（进 sub-fetch + 重置缓存 + requestRender）；更新 test/search-config-toplevel.test.ts（makeParams + 2 个 fetch 行用例）；commit

## 4. 接线：index.ts session_start + fetch reader + handler deps

- [x] 4.1 `src/index.ts`：`currentFetchProvider` + `setFetchConfigReader(() => currentFetchProvider)`；session_start 读 `cfg.search?.provider` + `normalizeFetchProvider(cfg.fetch?.provider)`；handler 传 `initialFetchProvider` + `onCommitFetchPersist: (p) => { currentFetchProvider = p; writeOmnirouteConfig(p, "fetch"); }`；命令描述更新；新增 test/session-start-fetch-config.test.ts（加载/非法 id 规范化/不泄漏到 search）；commit

## 5. web-fetch 工具三态合并

- [x] 5.1 `webFetchTool.execute`：`effectiveProvider = params.provider ?? normalizeFetchProvider(getFetchConfigProvider())`；`buildFetchBody({ ...params, provider: effectiveProvider })`；schema 不变；test/web-fetch-merge.test.ts 增 execute 层 5 用例（显式覆盖/配置注入/auto 省略/非法 id 省略/显式透传）；typecheck + 全测通过后 commit

## 6. 验证与收尾

- [x] 6.1 `npm run typecheck` exit 0；`npm test` 全绿（≈190：158 + 3 select-items + 4 persistence + 3 merge-reader + 4 state-machine + 8 fetch-submenu + 2 toplevel + 3 session-start-fetch + 5 execute-merge）；scope 检查（仅 10 个预期文件）；残留 grep 干净（无 SettingsList/getSettingsListTheme/buildProviderItems/smTheme）；勾选本文件全部复选框
- [x] 6.2 `docs(openspec): tick all tasks for add-web-fetch-provider-selection` 提交；`openspec-cn status` isComplete

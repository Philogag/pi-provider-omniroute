## 实现计划

> 本变更依据 `design.md` 的决策与 `specs/web-search-provider-config/spec.md` 的需求逐步落地，按 TDD 红→绿、每任务独立提交的方式推进（每任务结束 `npm run typecheck` + `npm test` 全绿后提交，commit message 体现设计意图）。
> 任务 ↔ 需求映射：Task 1 ↔ 需求(provider 目录拉取/回退)；Task 2 ↔ 需求(provider 选择面板)；Task 3 ↔ 需求(配置持久化到 omniroute.json)；Task 4 ↔ 需求(session_start 加载 + 工具三态合并)；Task 5 ↔ 需求(顶层 /omniroute-settings 菜单)；Task 6 ↔ 验证收尾。
> 任务 ↔ plan 映射：OpenSpec Task N ↔ `superpower-plan.md` Task N。OpenSpec 任务 1.1-1.5 拆为 plan 任务 1-2；OpenSpec 任务 2.1-2.2 拆为 plan 任务 3；OpenSpec 任务 3.1-3.3 拆为 plan 任务 4；OpenSpec 任务 4.1-4.5 拆为 plan 任务 5-6；OpenSpec 任务 5.1-5.4 拆为 plan 任务 7-9；OpenSpec 任务 6.1-6.3 拆为 plan 任务 10。
> apply 阶段按本表逐项勾选 `[ ]` → `[x]`。

## 1. 依赖与基础常量（package.json + search-config.ts）

- [x] 1.1 在 `package.json` 添加 `@earendil-works/pi-tui` 依赖（与 `node_modules/@earendil-works/pi-coding-agent` 内部解析到的 pi-tui 版本一致），`npm install` 验证导入解析
- [x] 1.2 新建 `src/tools/search-config.ts`：导出 `STATIC_FALLBACK_PROVIDERS: readonly string[]`（与 `src/tools/search.ts` 的 `SEARCH_PROVIDERS` 同源，14 项；`SEARCH_PROVIDERS` 重导出此常量以保持单一来源）
- [x] 1.3 实现 `fetchSearchProviders(baseUrl, apiKey, signal, timeoutMs?)`：GET `${baseUrl}/search` 带 `Authorization: Bearer <apiKey>`，返回 `{ id: string; name: string; search_types: readonly string[] }[]`；非 2xx / 网络异常 / 解析异常时抛 `SearchCatalogError`
- [x] 1.4 实现 `resolveSearchCatalog(baseUrl, apiKey, signal, timeoutMs?)`：调 1.3，捕获错误回退到 `STATIC_FALLBACK_PROVIDERS.map(id => ({ id, name: id, search_types: ["web"] as const }))`，并返回 `{ providers, isFallback: boolean }`
- [x] 1.5 新建 `test/search-config.test.ts`：mock `globalThis.fetch` 覆盖 4 场景（200 返回正确数据 / 401 抛错回退 / 5xx 抛错回退 / 网络异常回退）；断言 `isFallback` 标志

## 2. provider 二级选择面板（src/tools/search-config.ts 续）

- [x] 2.1 在 `src/tools/search-config.ts` 实现 `renderProviderSubmenu(params)`：接受 `{ currentProvider: string | undefined; providers: Array<{ id; name }>; isFallback: boolean; theme; onCommit(provider: string | undefined); onCancel() }`，返回 `Container` + `SettingsList` 组件；首项 `auto`（label "Auto (follow server default)"），其后为 `providers`；currentValue 反映 `currentProvider`；commit 回调触发 `onCommit` 并关闭面板，Esc 触发 `onCancel`
- [x] 2.2 新建 `test/search-config-submenu.test.ts`：mock `SettingsList` 构造参数，断言 (a) 首项 `auto` 存在；(b) `providers` 顺序与传入一致；(c) 切换 provider 的回调触发 `onCommit` 传入对应 id；(d) auto 切换触发 `onCommit(undefined)`；(e) Esc 触发 `onCancel`

## 3. 配置持久化到独立 `omniroute.json`（src/tools/search-config.ts 续）

- [x] 3.1 在 `src/tools/search-config.ts` 复用 `auth-credentials.ts` 的 `resolveAuthJsonPath()`；实现 `readOmnirouteConfig(): { provider?: string }`：解析顶层 `omniroute` 键的 `search.provider`（缺失 / 类型不符返回 `{}`）
- [x] 3.2 实现 `writeOmnirouteConfig(provider: string | undefined)`：read-modify-write 整个 `omniroute.json`（保留根对象中 `search` 之外的其他字段），将根对象 `search.provider` 设为 `provider`（`undefined` 时移除 `search` 键）；原子写（`omniroute.json.tmp` + rename）；文件不存在时自动创建；失败仅 `console.warn` 不抛；**不读写 `auth.json`**
- [x] 3.3 新建 `test/search-config-persistence.test.ts`：使用 `mkdtempSync` 临时目录 + `process.env.PI_AGENT_DIR` 隔离；(a) 写入 `tavily-search` 后 `readOmnirouteConfig()` 返回相同值；(b) 写 `undefined` 移除 `search` 键；(c) 写入不破坏既有 `env.OMNIROUTE_BASE_URL` 等其他字段；(d) 文件不存在时写入自动创建；(e) 写入失败（如目录只读）仅 warn 不抛

## 4. session_start 加载 + 工具三态合并（src/tools/search.ts + src/index.ts）

- [x] 4.1 在 `searchTool` 中新增模块级 `let getConfigProvider: () => string | undefined = () => undefined;` 与 `setSearchConfigReader(fn)` setter；`execute` 入口在 `query` 校验后调 `getConfigProvider()` 取得 `configProvider`，按"显式入参 > 有效具体值 > 省略"合并：若 `params.provider !== undefined` 用 `params.provider`；否则若 `configProvider` 是 `STATIC_FALLBACK_PROVIDERS` 的一员（防御性）用 `configProvider`；否则 `effectiveProvider = undefined`
- [x] 4.2 在 `buildSearchBody` 调用处使用 `effectiveProvider` 替换 `params.provider` 的透传（或新增并列通道）；保持现有 `passthrough` 循环对 `provider` 字段的处理
- [x] 4.3 追加 `test/search-tool-merge.test.ts`：4 场景（显式入参覆盖 config / config 具体值注入 / config "auto" 或 undefined 省略 / config 无效值省略）
- [x] 4.4 在 `src/index.ts` 注册 `pi.on("session_start", ...)`：调 `readOmnirouteConfig()` 写入 `currentConfigProvider` 模块级变量；同时调 `setSearchConfigReader(() => currentConfigProvider)`
- [x] 4.5 `npm run typecheck` 与全量 `npm test` 通过（既有 ≥98 用例 + 1.5/2.2/3.3/4.3 新增测试全绿）

## 5. `/omniroute-settings` 顶层菜单（src/index.ts + src/tools/search-config.ts）

- [x] 5.1 在 `src/tools/search-config.ts` 实现 `renderTopLevelMenu(params)`：接受 `{ currentProvider: string | undefined; theme; onActivateSearchProvider() }`，返回 `Container` 包含（标题 "Settings" + 一行 `Search provider: <preview>` + 提示行）；Enter 触发 `onActivateSearchProvider`，Esc 关闭
- [x] 5.2 在 `src/index.ts` 注册 `pi.registerCommand("omniroute-settings", ...)`：非 TUI 模式 `ctx.ui.notify` 提示；TUI 模式在单一 `ctx.ui.custom` 内用状态机管理 `mode: "top" | "sub"`；`mode === "top"` 渲染顶层菜单；激活 "Search provider" 后调 `resolveSearchCatalog` 后切换 `mode === "sub"` 渲染 provider 面板；`onCommit` 调 `writeOmnirouteConfig` 并切回 `mode === "top"`；`onCancel` 切回 `mode === "top"`
- [x] 5.3 调整 `src/index.ts` 使状态机在 TUI `custom` 内重渲染：根据 `mode` 切换返回的组件（顶层 Container vs provider Container），保持单 overlay
- [x] 5.4 手动冒烟（可选）：在 TUI 模式下调 `/omniroute-settings`，确认顶层菜单呈现、激活 Search provider 进入二级面板、选择写入 `omniroute.json`、回到顶层更新预览、Esc 关闭

## 6. 验证与收尾

- [x] 6.1 `npm run typecheck` 退出 0；`npm test` 全绿（含 1.5 / 2.2 / 3.3 / 4.3 / search-config-state-machine / search-config-toplevel / session-start-config / command-register 新增测试）
- [x] 6.2 通读 `src/index.ts` 确认未注册的 `session_tree` 钩子被移除、未注册的 `/omniroute-search` 旧命令被移除；`auth.json` 在新代码中只通过 `auth-credentials.ts` 路径访问（`readOmnirouteConfig` / `writeOmnirouteConfig` 不接触 `auth.json`）
- [x] 6.3 勾选本文件全部复选框；如有遗留未提交改动，单独 `docs` 提交 `docs: update tasks.md progress for add-web-search-provider-selection`

## 7. Follow-up（不阻塞归档）

> 实施期间 review loop 抓到的 parked 事项 + final review 建议，列出供后续独立变更挑选/勾选。
> 不影响本 change 归档与提合；勾选 = 进入下一个 OpenSpec 变更或独立 issue。

- [ ] 7.1 **Real-TUI 冒烟**：在真实 TTY 中调 `/omniroute-settings`，验证 top menu → Enter → submenu 上下导航 → Enter 选 provider → `omniroute.json` 写入 → 预览更新 → Esc 关闭。`SettingsList` cursor 重建问题已被缓存修复，但虚拟键盘 / 窗口尺寸 / ANSI 颜色只在真机可见。
- [ ] 7.2 **Spec G3 措辞澄清**：当前 spec G3 写"顶层菜单保持打开"——实现按 brief "verify key before opening UI"为 fail-fast（无 API key 不开 overlay）。建议在新 OpenSpec change 中明确"未配置 API key 时的 UX：fail-fast notify / disable menu / 静默 fallback"二选一。
- [ ] 7.3 **Parked minor cleanup**（可合入后续 hygiene PR）：
  - `process.env.PI_AGENT_DIR` 调试下手动清理 `/tmp` 临时目录（parked 时 use `try/finally`，现未含）
  - 未使用的环境变量（测试代码中遗留的实验性 flag）
  - 测试中 `setTimeout(10)` 等待 promise 解决——改为 await 解决后的 catalog
  - `_sl.onChange` 测试 hook 暴露——考虑加 `__test__` 注解避免在生产构建中被剥离
  - `isValidProvider` 验证者允许 `""` 空字符串——收紧为 `typeof === 'string' && length > 0`
  - hint text "↑/↓ or j/k" 与实际绑定不一致（实际只接 j/k / Arrow keys）——二选一
  - Loading Esc 处理函数不调用 `deps.onClose()`（需要连按两次 Esc）——改为跟 machine-level `onEsc` 一致
- [ ] 7.4 **追加 / 更正 commit**：`tasks.md` 本次刷新（含 §7 follow-up）需单独 `docs` 提交。

## 执行交接

变更已落地：全部 6 需求 / 27 场景（含边界场景 G1-G7）由 `test/` 下 9 个新测试文件覆盖（55 个新测试，**153/153 pass**，typecheck 0）。完整 TDD 蓝图见 `superpower-plan.md`（10 任务、7 fix waves、**16 commits since `976dcfd`**）。

执行方式：`subagent-driven-development`（`/opsx-sp-apply` / `superpowers:openspec-apply-change`）。实施期间 review loop 抓出 **8 个 plan defect** 全部修复：`Container.handleInput` 转发 × 2、`buildProviderItems` invariant、`readOmnirouteConfig` G6/G7 静默 warn、`Theme` type、state machine ctx 注入 gap、`ctx.ui.custom` 冻结 capture、SettingsList cursor reset、fetchCatalogAsync 无 requestRender。

最终全分支 review 补一刀：发现 2 Critical（submenu cursor cache + fetch 后 requestRender）+ 1 Important false positive（spec G4 明确要求静态 gate，加了注释无代码改动）+ 1 Minor（spec G3 措辞含糊，建议后续澄清）。Re-review 全绿无新增问题。

**当前进度：**
- 代码：6/6 需求勾选、9/9 测试文件、153/153 pass
- 文档：4/4 OpenSpec 产出物完成（proposal/design/specs/tasks）
- 未提交：`tasks.md`（当前文件）含 2 处文档刷新（任务勾选 + 交接段），待单独 `docs` commit
- 留待 follow-up（不阻塞）：real-TUI 冒烟、spec G3 措辞澄清、~6 个 parked minor（详见 `.superpowers/sdd/superpower-plan/progress.md`）

输入 `/opsx-archive` 归档到 `openspec/changes/archive/2026-08-06-add-web-search-provider-selection/`。

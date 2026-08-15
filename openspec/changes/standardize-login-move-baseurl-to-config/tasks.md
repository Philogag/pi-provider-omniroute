## 1. 标准登录流程（Task 1）

- [ ] 1.1 读 pi-ai 源码确认 `envApiKeyAuth` 的 login/resolve 输出形状（login 只提示 secret；resolve 不含 baseUrl/env）
- [ ] 1.2 重写 test/auth.test.ts 为失败测试：login 只提示 1 次（secret）；credential 无 env/baseUrl；resolve 优先级（存凭据 > env > undefined）；source 不泄露 key；`auth.check === undefined`
- [ ] 1.3 运行 `npm test -- test/auth.test.ts` 确认失败（旧实现双提示、带 env、有 check）
- [ ] 1.4 替换 src/auth.ts：`omnirouteApiKeyAuth = () => envApiKeyAuth("OmniRoute API key", ["OMNIROUTE_API_KEY"])`；删除 `promptBaseUrlWithRetry`/`MAX_URL_RETRIES`/check；保留 `validateAndNormalizeBaseUrl` 与 `OMNIROUTE_DEFAULT_BASE_URL`
- [ ] 1.5 运行测试确认全部 PASS 并提交（`refactor: standard login flow via envApiKeyAuth ...`）

## 2. baseUrl 配置写入/解析原语（Task 2）

- [ ] 2.1 追加失败测试（test/search-config-persistence.test.ts）：`writeOmnirouteBaseUrl` 写入 `settings.json` 的 `pi-provider-omniroute` 块（设值/undefined 删块内字段并保留其他键/保留 packages 等未知根键/块不存在时新建/round-trip/只读目录写失败仅 warn）；更新既有直接读写 omniroute.json 的用例为 settings.json 块格式
- [ ] 2.2 追加失败测试：`parseBaseUrlInput` 合法→normalized、空/纯空白→undefined（重置）、非法→error、非 http(s)→error、缺 /v1 后缀→仍合法（warn）
- [ ] 2.3 替换用例"resolveOmnirouteBaseUrl: falls back to legacy auth.json env"为"不再回退（迁移专用）"
- [ ] 2.4 运行 `npm test -- test/search-config-persistence.test.ts` 确认失败
- [ ] 2.5 实现：`resolveAgentSettingsPath()`（指向 $PI_AGENT_DIR/settings.json，rename 自 resolveOmnirouteConfigPath）、`readOmnirouteConfig`/`writeOmnirouteConfig` 改读写 `pi-provider-omniroute` 块、`writeOmnirouteBaseUrl(url: string|undefined): void`（设/删块.baseUrl，原子写 0o600 保未知键）、`BaseUrlInputResult` 类型、`parseBaseUrlInput`、`resolveOmnirouteBaseUrl` 删除 legacy 回退（config → env → 默认）
- [ ] 2.6 运行测试确认全部 PASS 并提交（`feat: baseUrl config write/parse primitives; drop legacy fallback from resolver`）

## 3. 一次性迁移（双源）+ 提交后尽力刷新（Task 3）

- [ ] 3.1 新建 test/migration-config.test.ts 失败测试：源①旧 omniroute.json（并入 baseUrl+search+fetch 不覆盖块内已有字段、成功后文件被删除、旧文件无 baseUrl 时回退源②）；源②auth.json legacy（仅 baseUrl）；块已有→no-op；env 已设→no-op；无源→undefined；幂等；迁移写入失败→旧文件保留可重试
- [ ] 3.2 test/session-start-config.test.ts 的 sessionCtx 补 `modelRegistry: { refresh: async () => {} }`
- [ ] 3.3 运行 `npm test -- test/migration-config.test.ts test/session-start-config.test.ts` 确认失败
- [ ] 3.4 实现：`migrateLegacyConfig()`（双源收集、块写入成功后才 unlinkSync 旧文件，删除失败仅 warn）；src/index.ts 的 `const baseUrl` → `let baseUrl`；新增 `refreshOmnirouteModels(ctx)`（try refresh → catch warn+notify）；session_start 迁移后刷新并重读配置
- [ ] 3.5 运行迁移 + session-start 两文件测试确认通过并提交（`feat: one-time migration of legacy omniroute.json + auth.json baseUrl into settings block + best-effort model refresh`）

## 4. settings 菜单 Base URL 编辑（Task 4）

- [ ] 4.1 新建 test/search-config-base-url-editor.test.ts 失败测试：渲染标题/预填值/提示；Enter 合法→onCommit；空输入→onCommit(undefined)；非法→错误行显示且不提交；Esc→onCancel；注入 resolver 驱动错误路径
- [ ] 4.2 更新 test/search-config-toplevel.test.ts：`baseUrlPreview`/`onActivateBaseUrl` 参数；三条目渲染；base-url 行激活；长 URL 截断（≤48 字符 + "…"）
- [ ] 4.3 追加 test/search-config-state-machine.test.ts：`onActivateBaseUrl` → sub-base-url 模式；编辑器实例缓存；commit 回顶层并调 `onCommitBaseUrl`；Esc 回顶层不提交；C1 回归（Down Down + Enter 激活 base-url，既有 Down+Enter 激活 fetch 不回归）
- [ ] 4.4 追加 test/command-register.test.ts 集成用例：顶层渲染含 `Base URL:`；导航到编辑器后空输入 Enter（重置）→ `modelRegistry.refresh` 收到 `{providers:["omniroute"],force:true}` 且 settings.json 的 `pi-provider-omniroute` 块 `baseUrl` 被删除（临时 PI_AGENT_DIR 隔离）
- [ ] 4.5 运行上述 4 个测试文件确认失败
- [ ] 4.6 实现：`renderBaseUrlEditor`（Container + Input 预填 focused + 错误行 + `_input` 暴露）；`truncatePreview`；`TopLevelMenuParams` 加 `baseUrlPreview`/`onActivateBaseUrl`，renderTopLevelMenu 第三条目；状态机 `sub-base-url` 模式 + `onCommitBaseUrl` 依赖 + 缓存失效补全；src/index.ts 命令接线（`resolveBaseUrl: () => baseUrl`、`onCommitBaseUrl` 写配置/更新 let baseUrl/尽力刷新，删除 http.ts resolveBaseUrl 导入）
- [ ] 4.7 运行 4 个测试文件确认全部 PASS（含既有 C1 回归）并提交（`feat: Base URL editor in /omniroute-settings (sub-base-url mode) with best-effort model refresh`）

## 5. 工具侧解析链统一（Task 5）

- [ ] 5.1 更新 test/tools-http.test.ts：临时 PI_AGENT_DIR 隔离（settings.json 块）+ 用例：omniroute 模型优先 / 非 omniroute 模型回退配置块 / 配置块优先于 env / 无 config 回退 env / 全无回退默认；删除旧"ignores non-omniroute model"用例
- [ ] 5.2 运行 `npm test -- test/tools-http.test.ts` 确认失败
- [ ] 5.3 实现 src/tools/http.ts：`resolveBaseUrl` 回退改为 `resolveOmnirouteBaseUrl()`（config → env → 默认）；删除 `OMNIROUTE_DEFAULT_BASE_URL` 直接引用；确认无依赖环
- [ ] 5.4 运行 tools-http/tools-search/tools-web-fetch/lazy-fetch 测试确认通过并提交（`fix: unify tool-side baseUrl fallback through resolveOmnirouteBaseUrl (config-first)`）

## 6. 文档更新 + 全量回归（Task 6）

- [ ] 6.1 更新 README.md / README.zh-CN.md：baseUrl 由 `/omniroute-settings` Base URL 条目（或 `~/.pi/agent/settings.json` 的 `pi-provider-omniroute` 块）管理，优先级 配置块→env→默认，空输入重置；login 只提示 key；旧 `omniroute.json`（迁移成功后删除）与旧 auth.json baseUrl 启动时自动一次性迁移
- [ ] 6.2 全量回归：`npm test` 全部 PASS + `npm run typecheck` 无错误
- [ ] 6.3 提交（`docs: document standard login and config-managed baseUrl`）

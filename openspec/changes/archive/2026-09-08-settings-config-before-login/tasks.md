## 1. 测试先行（无 key 行为用例）

- [x] 1.1 `test/command-register.test.ts`：新增用例——TUI 会话注册后，以 `modelRegistry.getApiKeyForProvider → undefined` 的 ctx 调用 `/omniroute-settings` handler：`ctx.ui.custom` 被调用（菜单打开）、无 error notify（"API key is not configured" 不再出现）。
- [x] 1.2 `test/search-config.test.ts`：新增用例——`resolveSearchCatalog`/`fetchSearchProviders` 以 `apiKey === undefined` 调用时：mock fetch 捕获请求**不含 `Authorization` 头**；网关返回 200 → 目录按 `data` 呈现（`isFallback:false`）。
- [x] 1.3 `test/search-config.test.ts`：新增用例——`apiKey === undefined` 且网关返回 401 → `isFallback:true`（静态回退），与既有 401 用例断言一致。
- [x] 1.4 既有用例回归：带 key 的 settings/baseUrl/catalog 用例全部保持绿（含 command-register.test.ts:174 "top menu renders Base URL row"）。

## 2. 实现

- [x] 2.1 `src/index.ts`：删除 settings handler 开头的 `resolveApiKey` 守卫（notify + return 分支）。
- [x] 2.2 `src/tools/search-config.ts`：`fetchCatalogAsync` 删除无 key 提前 return；`fetchSearchProviders`/`resolveSearchCatalog` 的 `apiKey` 参数类型放宽为 `string | undefined`，`Authorization` 头仅在 apiKey 存在时附加（`Bearer undefined` 不得出现）。

## 3. 回归与文档

- [x] 3.1 运行 `npm test` 与 `npm run typecheck`，全部通过（含新增用例）。
- [x] 3.2 `README.md` / `README.zh-CN.md`：从零配置小节改为两步流程"① `/omniroute-settings` 配置 Base URL（可同时设 web-fetch/search provider 默认值）② `/login omniroute`"，并注明设置菜单无需预先配置 API key。
- [x] 3.3 运行 `openspec-cn validate`（对 change `settings-config-before-login`）通过。

## Why

当前 `/login omniroute` 流程是自造的：它在提示 API key 之后还会额外提示 base URL，并把 `OMNIROUTE_BASE_URL` 塞进 `auth.json` 的 credential env 里。这偏离了 pi-ai 的标准 api-key 认证流程（`envApiKeyAuth`：login 只收集 key，baseUrl 属于 provider 配置而非凭据），导致 baseUrl 与凭据耦合、无法在 `/omniroute-settings` 中管理，且新增了非标准的 `check` 回调。与此同时，配置散落在自建的 `omniroute.json` 文件里（可读 `baseUrl` 但没有写入路径），而 pi 的标准全局配置 `settings.json`（`$PI_AGENT_DIR/settings.json`）才是扩展配置的规范归属地——用户只能通过环境变量或旧版 `/login` 来设置 baseUrl。

## What Changes

- 将 `src/auth.ts` 的 `omnirouteApiKeyAuth()` 替换为 pi-ai 标准 `envApiKeyAuth("OmniRoute API key", ["OMNIROUTE_API_KEY"])`：`/login` 只提示 API key，不再提示 base URL；删除自定义 `check` 回调与凭据内嵌 baseUrl 的逻辑。
- baseUrl 的唯一持久化位置改为标准全局配置 `settings.json` 中 `pi-provider-omniroute` 块的 `baseUrl` 字段（`$PI_AGENT_DIR/settings.json`，通常为 `~/.pi/agent/settings.json`），读写均保留 settings.json 的其他未知键（含 pi 自身管理的 packages/theme 等）。
- 在 `/omniroute-settings` 顶层菜单新增 "Base URL" 条目：可在 TUI 中交互式查看/修改 baseUrl，输入经 `validateAndNormalizeBaseUrl` 校验后写回配置块的 `baseUrl` 字段。
- 保留解析优先级：配置块 `baseUrl` → `OMNIROUTE_BASE_URL` 环境变量 → 默认值 `http://localhost:20128/v1`；移除 legacy 的 auth.json credential env 回退（旧 `/login` 产物）。
- **一次性迁移**：启动时把旧 `omniroute.json`（若存在，含 baseUrl 与 search/fetch provider）与旧版 `/login` 遗留的 auth.json env baseUrl 并入 `settings.json` 的 `pi-provider-omniroute` 块（仅填补缺失字段）；迁移成功后删除旧 `omniroute.json` 文件，之后不再读取任何旧配置源。

## Capabilities

### New Capabilities

- `provider-login`: 标准 api-key 登录流程——`/login omniroute` 只提示 API key；解析时 key 优先取已存凭据、否则取 `OMNIROUTE_API_KEY` 环境变量；不再提示/存储 baseUrl。
- `base-url-config`: baseUrl 由 `settings.json` 的 `pi-provider-omniroute` 块管理——支持通过 `/omniroute-settings` 顶层菜单的 "Base URL" 条目交互式修改并校验，解析优先级为配置块 → 环境变量 → 默认值。

### Modified Capabilities

（无——既有 specs `usage-cost-telemetry`、`web-fetch-provider-config`、`web-search-provider-config` 的需求不发生变化。）

## Impact

- 重写文件：`src/auth.ts`（替换为 `envApiKeyAuth`，保留/瘦身 URL 校验工具）
- 修改文件：`src/index.ts`（provider baseUrl 解析、settings 菜单新增 Base URL 条目）、`src/tools/search-config.ts`（配置读写改为 `settings.json` 的 `pi-provider-omniroute` 块、`writeOmnirouteConfig` 支持 `baseUrl` 写入、新增迁移逻辑、顶层菜单新增条目）、`src/tools/http.ts`（`resolveBaseUrl` 解析链）、`src/auth-credentials.ts`（保留作迁移读取源）
- 测试：`test/url.test.ts`、`test/lazy-fetch.test.ts`、`test/command-register.test.ts`、`test/tools-http.test.ts`、`test/auth*.test.ts` 需同步更新
- 文档：`README.md` / `README.zh-CN.md` 的配置章节更新
- 环境变量：保留 `OMNIROUTE_API_KEY`、`OMNIROUTE_BASE_URL` 作为 ambient 后备；`auth.json` 中的 legacy `OMNIROUTE_BASE_URL` env 与旧 `omniroute.json` 仅在一次性迁移路径被读取
- 无新增依赖

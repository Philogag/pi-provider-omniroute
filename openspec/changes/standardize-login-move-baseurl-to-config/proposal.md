## Why

当前 `/login omniroute` 流程是自造的：它在提示 API key 之后还会额外提示 base URL，并把 `OMNIROUTE_BASE_URL` 塞进 `auth.json` 的 credential env 里。这偏离了 pi-ai 的标准 api-key 认证流程（`envApiKeyAuth`：login 只收集 key，baseUrl 属于 provider 配置而非凭据），导致 baseUrl 与凭据耦合、无法在 `/omniroute-settings` 中管理，且新增了非标准的 `check` 回调。与此同时，`omniroute.json` 配置文件已经支持读取 `baseUrl` 字段，却没有写入路径——用户只能通过环境变量或旧版 `/login` 来设置 baseUrl。

## What Changes

- 将 `src/auth.ts` 的 `omnirouteApiKeyAuth()` 替换为 pi-ai 标准 `envApiKeyAuth("OmniRoute API key", ["OMNIROUTE_API_KEY"])`：`/login` 只提示 API key，不再提示 base URL；删除自定义 `check` 回调与凭据内嵌 baseUrl 的逻辑。
- baseUrl 的唯一持久化位置改为配置文件 `omniroute.json` 的 `baseUrl` 字段（读取逻辑已存在，本次补齐写入路径）。
- 在 `/omniroute-settings` 顶层菜单新增 "Base URL" 条目：可在 TUI 中交互式查看/修改 baseUrl，输入经 `validateAndNormalizeBaseUrl` 校验后写回 `omniroute.json`。
- 保留解析优先级：`omniroute.json baseUrl` → `OMNIROUTE_BASE_URL` 环境变量 → 默认值 `http://localhost:20128/v1`；移除 legacy 的 auth.json credential env 回退（旧 `/login` 产物）。
- **BREAKING**：旧版 `/login` 把 baseUrl 存入 `auth.json` credential env 的行为被移除；此类存量用户需在 `/omniroute-settings` 中重新设置 baseUrl，或设置 `OMNIROUTE_BASE_URL` 环境变量。

## Capabilities

### New Capabilities

- `provider-login`: 标准 api-key 登录流程——`/login omniroute` 只提示 API key；解析时 key 优先取已存凭据、否则取 `OMNIROUTE_API_KEY` 环境变量；不再提示/存储 baseUrl。
- `base-url-config`: baseUrl 由配置文件 `omniroute.json` 的 `baseUrl` 字段管理——支持通过 `/omniroute-settings` 顶层菜单的 "Base URL" 条目交互式修改并校验，解析优先级为配置文件 → 环境变量 → 默认值。

### Modified Capabilities

（无——既有 specs `usage-cost-telemetry`、`web-fetch-provider-config`、`web-search-provider-config` 的需求不发生变化。）

## Impact

- 重写文件：`src/auth.ts`（替换为 `envApiKeyAuth`，保留/瘦身 URL 校验工具）
- 修改文件：`src/index.ts`（provider baseUrl 解析、settings 菜单新增 Base URL 条目）、`src/tools/search-config.ts`（`writeOmnirouteConfig` 支持 `baseUrl` 写入；顶层菜单新增条目）、`src/tools/http.ts`（`resolveBaseUrl` 解析链）、`src/auth-credentials.ts`（可能移除 legacy 回退）
- 测试：`test/url.test.ts`、`test/lazy-fetch.test.ts`、`test/command-register.test.ts`、`test/tools-http.test.ts`、`test/auth*.test.ts` 需同步更新
- 文档：`README.md` / `README.zh-CN.md` 的配置章节更新
- 环境变量：保留 `OMNIROUTE_API_KEY`、`OMNIROUTE_BASE_URL` 作为 ambient 后备；`auth.json` 中的 legacy `OMNIROUTE_BASE_URL` env 不再被读取
- 无新增依赖

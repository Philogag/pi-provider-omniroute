## 为什么

当前 pi 扩展把 `OMNIROUTE_BASE_URL` 视为启动期常量，绕开了 pi 的标准 `/login` 流程。OmniRoute 部署在非默认地址（容器/远端）的用户需要：(1) 在扩展加载前手动设置环境变量；(2) 若要更新 baseUrl，必须重启 Pi 并修改 shell 配置。问题在于 `OMNIROUTE_BASE_URL` 不能通过 pi 的交互式账号机制表达，因此也无法被纳入 `auth.json` 持久化或 `/login` 流程。

## 变更内容

- 把 OmniRoute 改为 `createProvider()` 的完整 provider，并定义 `auth.apiKey.login` 回调
- `/login omniroute` 流程：
  1. 若 `OMNIROUTE_API_KEY` 已设置 → 直接使用（保留 Phase 1 行为）
  2. 否则用 `interaction.prompt({ type: "secret" })` 询问 API key
  3. 若 `OMNIROUTE_BASE_URL` 未设置 → 用 `interaction.prompt({ type: "text" })` 询问 baseUrl（默认填入 `http://localhost:20128/api/v1`）
  4. baseUrl 与 API key 一并写入 `auth.json` 持久化；用户可随时 `/login omniroute` 重新设置
- `resolve()` 时把存储的 baseUrl 注入到 `ModelAuth.baseUrl`，使每个请求走用户配置的端点；未存储的 baseUrl 退回到 `OMNIROUTE_BASE_URL` 环境变量或默认值
- 不再维护独立的 `OMNIROUTE_DASHBOARD_PASSWORD` / `OMNIROUTE_AUTH_TOKEN` 流程：管理端点（`ManagementSessionAuth`）不在本次变更范围，留待 Phase 2 工具化时再处理

## 功能 (Capabilities)

### 新增功能

- `api-token-login`: 通过 pi 标准 `/login` 流程注册 OmniRoute API key + 可选 baseUrl，写入 `auth.json` 持久化

### 修改功能

（无）

## 影响

- 重写文件：`src/index.ts`（改用 `createProvider()`，添加 `auth.apiKey`）
- 新增文件：`src/auth.ts`（OmniRoute 的 `ApiKeyAuth` 定义，含 login/resolve 回调）
- 新增依赖（候选）：`@earendil-works/pi-ai`（`createProvider`、`openAICompletionsApi`、`ApiKeyAuth` 等类型）
- 环境变量：保留 `OMNIROUTE_API_KEY`、`OMNIROUTE_BASE_URL` 作为 ambient 后备（用户没 `/login` 时仍可工作）；不再引入 `OMNIROUTE_DASHBOARD_PASSWORD`、`OMNIROUTE_AUTH_TOKEN`、`OMNIROUTE_REQUIRE_LOGIN`
- 行为差异：现存用户若通过 `OMNIROUTE_API_KEY` 环境变量使用，行为不变；新用户可用 `/login omniroute` 完成设置并持久化

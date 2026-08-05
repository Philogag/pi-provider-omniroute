# api-token-login 规范

## 目的
待定 - 由归档变更 support-custom-baseurl-on-login 创建。归档后请更新目的。
## 需求
### 需求:`/login omniroute` 收集 API key

当用户在 pi 会话中执行 `/login omniroute` 时，系统必须调用 `auth.apiKey.login` 回调，使用 `interaction.prompt({ type: "secret" })` 询问 OmniRoute API key；用户输入或取消后流程结束。

#### 场景:用户输入 API key
- **当** `/login omniroute` 触发，`interaction.prompt({ type: "secret", message: "Enter OmniRoute API key" })` 返回非空字符串
- **那么** 系统必须把 `{ type: "api_key", key, env: { ... } }` 返回给 pi，由 pi 写入 `~/.pi/agent/auth.json`

#### 场景:用户取消 secret prompt
- **当** `interaction.prompt` 抛出取消错误（用户按 Esc/Ctrl+C）
- **那么** 系统必须让该错误原样向上抛出；不得静默吞掉、不得写入空 key 到 `auth.json`

### 需求:`/login omniroute` 收集 baseUrl

`auth.apiKey.login` 回调在收集 API key 之后，必须使用 `interaction.prompt({ type: "text" })` 询问 OmniRoute baseUrl；默认占位为 `http://localhost:20128/api/v1`。返回的 credential 必须把规范化后的 baseUrl 写入 `credential.env.OMNIROUTE_BASE_URL`。

#### 场景:用户输入自定义 baseUrl
- **当** `interaction.prompt({ type: "text", message: "Enter OmniRoute base URL (default: ...)" })` 返回 `https://router.internal:9000/api/v1`
- **那么** 返回的 `ApiKeyCredential.env.OMNIROUTE_BASE_URL` 必须等于 `https://router.internal:9000/api/v1`

#### 场景:用户回车接受默认
- **当** text prompt 返回空字符串（用户按 Enter）
- **那么** `credential.env.OMNIROUTE_BASE_URL` 必须等于 `http://localhost:20128/api/v1`，且 `auth.json` 中不得存空字符串

#### 场景:用户输入带尾斜杠的 baseUrl
- **当** text prompt 返回 `http://localhost:20128/api/v1/`
- **那么** 写入 `credential.env.OMNIROUTE_BASE_URL` 的值必须**保留**用户原始输入；是否去掉尾斜杠交给 `resolve()` 阶段处理（不得在此步骤抛错）

#### 场景:用户输入带前后空白的 baseUrl
- **当** text prompt 返回 `  http://localhost:20128/api/v1  `
- **那么** 写入 `credential.env.OMNIROUTE_BASE_URL` 的值必须是 `http://localhost:20128/api/v1`（已 `.trim()`）

### 需求:`resolve()` 优先级为 stored credential

`auth.apiKey.resolve` 必须在每次请求认证时按以下顺序选择 baseUrl 与 API key：(1) `credential.key` 存在 → 用 `credential.key` + `credential.env.OMNIROUTE_BASE_URL`；(2) 否则查 ambient env `OMNIROUTE_API_KEY` / `OMNIROUTE_BASE_URL`；(3) 都无 → 返回 `undefined`（未配置）。

#### 场景:stored credential 优先
- **当** `credential.key = "stored-key"` 且 `credential.env.OMNIROUTE_BASE_URL = "https://remote/api/v1"`，同时 `OMNIROUTE_API_KEY = "env-key"` 已设置
- **那么** `resolve()` 必须返回 `{ auth: { apiKey: "stored-key", baseUrl: "https://remote/api/v1" }, source: "stored credential" }`，忽略 ambient env

#### 场景:仅 ambient env
- **当** `credential === undefined` 且 `OMNIROUTE_API_KEY = "env-key"`、`OMNIROUTE_BASE_URL = "http://localhost:20128/api/v1"` 已设置
- **那么** `resolve()` 必须返回 `{ auth: { apiKey: "env-key", baseUrl: "http://localhost:20128/api/v1" }, env: { OMNIROUTE_BASE_URL: "http://localhost:20128/api/v1" }, source: "OMNIROUTE_API_KEY" }`

#### 场景:无 key 时返回 undefined
- **当** 既无 stored credential，也无 `OMNIROUTE_API_KEY`
- **那么** `resolve()` 必须返回 `undefined`，让 pi 提示用户登录

#### 场景:key 存在但 baseUrl 不存在
- **当** `credential.key = "stored-key"` 且 `credential.env.OMNIROUTE_BASE_URL` 未设置
- **那么** `resolve()` 必须返回 `{ auth: { apiKey: "stored-key" } }`（无 `baseUrl` 字段）；请求走 `createProvider` 时传入的默认 baseUrl

### 需求:baseUrl 持久化与可更新

`/login omniroute` 重复执行时，pi 必须用新 credential 覆盖旧 `auth.json` 条目；扩展不得阻止覆盖。

#### 场景:重新登录更新 baseUrl
- **当** `auth.json` 已存 `{ key: "old", env: { OMNIROUTE_BASE_URL: "http://old/api/v1" } }`，用户执行 `/login omniroute` 并输入新 key 与新 baseUrl
- **那么** `auth.json` 必须仅保留新条目，旧 baseUrl 不得残留

#### 场景:重新登录保留 baseUrl
- **当** `auth.json` 已存旧条目，用户执行 `/login omniroute` 但只更新 key（baseUrl 回车用默认）
- **那么** `auth.json` 必须存新 key + 默认 baseUrl（覆盖旧 baseUrl）

### 需求:扩展启动不影响 ambient env 用户

对从未执行过 `/login omniroute` 的用户，扩展必须保持 Phase 1 行为：完全依赖 `OMNIROUTE_API_KEY` / `OMNIROUTE_BASE_URL` 环境变量，不主动要求登录。

#### 场景:仅设 OMNIROUTE_API_KEY
- **当** 仅 `OMNIROUTE_API_KEY=abc` 设置、`OMNIROUTE_BASE_URL` 与 `auth.json` omniroute 条目均无
- **那么** 扩展必须能正常注册 provider、列出模型、转发聊天请求

#### 场景:仅设两个环境变量
- **当** `OMNIROUTE_API_KEY=abc` 与 `OMNIROUTE_BASE_URL=http://remote/api/v1` 均设置，无 `auth.json` omniroute 条目
- **那么** `resolve()` 必须用 ambient env，行为与 Phase 1 完全一致

### 需求:扩展使用 `createProvider()` 形式

扩展必须通过 `createProvider({ ... })` 构造 provider 并调用 `pi.registerProvider(provider)`，**禁止**使用 `pi.registerProvider("omniroute", { ... })` legacy form（legacy form 不支持 `auth.apiKey` 回调）。

#### 场景:createProvider 调用
- **当** 扩展工厂函数执行
- **那么** 必须调用 `createProvider({ id: "omniroute", name: "OmniRoute", baseUrl, auth: { apiKey: omnirouteApiKeyAuth() }, models: [], api: openAICompletionsApi(), refreshModels })`

#### 场景:不依赖 legacy form
- **当** 扩展源码中搜索 `pi.registerProvider("omniroute", {`
- **那么** 不得匹配；该形式已被 `createProvider` 替代


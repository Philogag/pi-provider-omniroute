# Proposal: /omniroute-settings 登录前可用（移除 apiKey 守卫，支持从零配置）

## Why

`/omniroute-settings` 的 handler 开头有 apiKey 守卫：`resolveApiKey(ctx)` 拿不到 key 就 `notify("/login omniroute …")` 并 return，菜单根本无法打开。这造成从零配置的死锁：新用户没有 key → 打不开设置 → 无法把 baseUrl 从默认 `http://localhost:20128/v1` 改到自建/远端 OmniRoute 实例 → 登录/认证也就无从谈起（且登录校验依赖正确 baseUrl）。期望的从零流程是：**① `/omniroute-settings` 配置 Base URL（及可选的 web-fetch/search provider 默认值）→ ② `/login omniroute`**。此外，活动顶层 spec `web-search-provider-config` / `web-fetch-provider-config` 的顶层菜单场景都无条件要求"输入 `/omniroute-settings` 即呈现菜单"——现有守卫是实现层面的偏差。

## What Changes

- 移除 `src/index.ts` settings handler 的 apiKey 守卫（notify + return 分支删除）；`/omniroute-settings` 在 TUI 模式下无条件打开菜单（含 Base URL 编辑器、Web Fetch provider 选择）。
- 无 key 时 Search provider 子菜单不再"永久 Loading"：`fetchCatalogAsync` 不再因缺 key 提前 return，改为**不带 `Authorization` 头**请求 `${baseUrl}/search`（开放网关如默认 localhost 直接返回目录；认证网关 401/5xx/网络异常走既有静态回退 + "built-in list" 提示，满足活动 spec 的目录拉取需求）。
- 顺带修正：`fetchSearchProviders` 在无 key 时不得发送字面量 `Bearer undefined`（header 按需附加）。
- 既有语义不变：菜单渲染/持久化/Base URL 提交触发的 best-effort 模型刷新均保持；无 key 时模型刷新由 pi-ai 静默跳过阶段二，settings 流程不受影响；tools（`omniroute_web_search`/`omniroute_web_fetch`）执行时的 `/login` 提示属另一路径，不动。
- 无破坏性变更（**BREAKING**: 无）。

## Capabilities

### New Capabilities

- `settings-config-before-login`：`/omniroute-settings` 可在未配置 API key（未登录）时打开并完成 Base URL 与 web-fetch/search provider 默认值配置；登录作为独立步骤随后进行。

### Modified Capabilities

无（`web-search-provider-config` / `web-fetch-provider-config` 顶层菜单与目录回退需求本就未要求 key 前置；本变更消除的是实现偏差，不构成 spec 需求变化）。

## Impact

- **代码**：`src/index.ts`（handler 守卫删除，~8 行）；`src/tools/search-config.ts`（`fetchCatalogAsync` 无 key 早退删除、`fetchSearchProviders` header 按需附加，~6 行）。
- **测试**：`test/command-register.test.ts` 或新增用例——无 key 时 handler 仍打开菜单（custom 被调用）；无 key 时 Search provider 子菜单进入目录拉取且请求不含 `Authorization` 头；401 时静态回退 + built-in 提示（既有）。既有全部用例保持绿。
- **文档**：`README.md` / `README.zh-CN.md` 从零配置小节改为"设置 Base URL → 登录"两步。
- **依赖**：无新增。

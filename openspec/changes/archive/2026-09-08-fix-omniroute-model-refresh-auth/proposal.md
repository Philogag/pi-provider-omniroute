# Proposal: 修复模型目录刷新失败（refreshModels 缺少认证）

## Why

pi 的 `/model` 快速匹配与 `/models` 面板会触发 `ModelRuntime.refresh()`，对 omniroute provider 调用 `refreshModels` 拉取模型目录。当前实现以**无认证的裸 fetch** 请求 `${baseUrl}/models`，而 OmniRoute 网关对 `/v1/models` 强制 Bearer 认证（实测无认证返回 `401 {"error":{"code":"invalid_api_key",...}}`，带 `Authorization: Bearer` 返回 200）。因此每次刷新都必然 401，pi 把错误记入 provider `errors`，TUI 只能提示 *"Could not refresh omniroute; showing cached models."* 并回退到缓存模型。服务端新增/下线模型或调整别名后，目录无法刷新，必须重启或等待下次会话才能看到新模型。

## What Changes

- `refreshModels` 的网络拉取阶段携带认证：优先读取 pi-ai 0.84.1+ 传入的 `context.credential`（`type: "api_key"` 时取 `key`），以 `Authorization: Bearer <key>` 请求 `${baseUrl}/models`。
- 认证回退：`credential` 缺失（pi-ai 0.83 契约、单元测试桩等旧形态）时，尝试环境变量 `OMNIROUTE_API_KEY`；两者都不可用时维持现状（裸请求，错误照常冒泡）——不因"无 key"新增误导性错误。
- 请求 URL 规范化：拼接前去掉 `baseUrl` 尾部多余 `/`，避免 `baseUrl` 以 `/` 结尾时请求 `//models`。
- 既有语义不变：restore/publish/store 双契约处理、失败保留旧列表（缓存回退仍由 pi 呈现）、错误冒泡不吞错、`allowNetwork=false` 阶段不发网络请求。

## Capabilities

### New Capabilities

- `model-catalog-refresh-auth`: omniroute provider 的模型目录刷新（`refreshModels`）对 `/models` 端点的请求必须携带解析到的 API key（Bearer 认证），使需要认证的 OmniRoute 部署能成功刷新模型目录而不是回退到缓存模型。

### Modified Capabilities

无（现有顶层 specs 均不涉及模型目录刷新行为；历史 `lazy-model-fetch` spec 已归档且未提升为活动 spec，不构成增量 delta）。

## Impact

- **代码**：`src/index.ts` —— `provider.refreshModels` 网络阶段加入认证头与 URL 规范化（改动集中在 ~10 行）。
- **测试**：`test/lazy-fetch.test.ts`、`test/models-metadata.test.ts` —— mock 断言请求携带 `Authorization: Bearer <key>`；新增携带 `credential` 的 context 用例与无 credential 时环境变量回退用例；既有裸 `{signal}` 桩用例保持通过。
- **文档**：`README.md` / `README.zh-CN.md` 模型自动导入小节补充"刷新携带 API key"说明（一行）。
- **依赖**：无新增；`RefreshModelsContext` 的 `credential` 字段在 peer `pi-ai` ≥0.84.1 已提供。

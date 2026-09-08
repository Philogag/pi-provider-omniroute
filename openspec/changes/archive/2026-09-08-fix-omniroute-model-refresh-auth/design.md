## Context

动机见 `proposal.md`。影响方案选择的现状与约束：

- **根因（已实测复现）**：`refreshModels` 网络阶段执行 `fetch(\`${baseUrl}/models\`, { signal })`，无任何认证头。对实际部署 `https://route.ai.philogag.com/v1/models` 无认证 GET 返回 `401 invalid_api_key`，带 `Authorization: Bearer <key>` 返回 200。
- **pi-ai 0.84.x 刷新契约**：`ModelRuntime.refresh()` 对每个 provider 执行两阶段——阶段 1 恢复（`allowNetwork:false`，从 modelsStore 读 `stored` 并 `publish`），随后解析 credential（`resolveRefreshCredential`），阶段 2 网络刷新（`allowNetwork:true`、`credential` 已解析为 `{type:"api_key", key, env}`）。**只有 credential 解析成功才会进入阶段 2**；解析失败则静默跳过（不产生 error）。阶段 2 抛错按 `provider.id` 记入 `errors`，TUI 呈现 *"Could not refresh omniroute; showing cached models."*。
- **兼容面**：peer `pi-ai` 0.83 契约传 `{store, allowNetwork, force, signal}`（无 `credential`）；0.84.1+ 契约传 `{credential, stored, publish, allowNetwork, force, signal}`；仓库单元测试桩传裸 `{signal}`。
- **参考实现**：pi-ai 内建 provider（如 radius）网络刷新均从 `context.credential` 取 key 注入 HTTP 调用。
- **baseUrl 形态**：`resolveOmnirouteBaseUrl()` 返回 settings.json block / env / 默认值原样 trimmed 字符串，**允许尾部 `/`**；现有工具请求用 `baseUrl.replace(/\/+$/, "")` 去尾后拼路径。

## Goals / Non-Goals

**Goals:**

- 阶段 2 的 `/models` 请求携带解析到的 API key（`Authorization: Bearer`），使需认证的 OmniRoute 部署刷新成功。
- 兼容三种 context 形态：0.84.1+（`credential`）、0.83（无 `credential`）、测试桩（裸 `{signal}`）——后两者回退环境变量 `OMNIROUTE_API_KEY`，再不可得时维持裸请求。
- 请求 URL 规范化，杜绝 `//models`。
- 错误语义不变：失败冒泡、`getModels()` 保留旧列表、`allowNetwork:false` 阶段零网络请求、restore/publish/store 双契约逻辑原样保留。

**Non-Goals:**

- 不改阶段 1 恢复与 modelsStore 持久化逻辑。
- 不自行为 `/models` 加超时（pi 已在 15s 中止信号上覆盖）。
- 不实现 OAuth/token 刷新（omniroute 仅 `api_key` 认证）。
- 不在扩展层重复 pi 的 credential 解析失败语义（0.84.x 下解析失败根本不进入阶段 2）。

## Decisions

**D1：认证 key 来源 — `context.credential` 优先，环境变量回退。**
阶段 2 里 `credential.type === "api_key"` 时取 `credential.key`；缺失（0.83 契约 / 测试桩）则读 `process.env.OMNIROUTE_API_KEY`；两者皆无则发裸请求（错误照常冒泡）。
- 备选 A：调用 `provider.auth.apiKey.resolve(...)` 自行解析——需要 pi 的 `authContext` 与凭据存储，扩展层不可得，与 pi 逻辑重复。
- 备选 B：仅在有 `credential` 时认证、否则直接跳过网络请求——破坏 0.83/测试桩形态的既有可观测行为（当前它们会真实发请求并在 401 时冒泡，测试也钉住了该行为）。
- 选定 A 方案（credential→env→裸请求）在三种形态下行为最一致，且 env 兜底与 pi 的 `envApiKeyAuth(["OMNIROUTE_API_KEY"])` 同源。

**D2：请求头仅在取到 key 时附加 `Authorization: Bearer`。**
对开放 `/models` 端点（本地默认 `http://localhost:20128/v1` 这类免认证部署）无 key 裸请求维持 200；有 key 时多余 header 无害（服务端忽略即可）。

**D3：URL 规范化沿用仓库既有惯例 `baseUrl.replace(/\/+$/, "") + "/models"`。**
与 `omnirouteRequest`（`src/tools/http.ts`）保持一致，避免新增第三种拼接风格。

## Risks / Trade-offs

- [key 出现在请求头] → 仅在 HTTPS/受信本机端点使用；Node fetch 不记录请求头，无日志泄漏面。
- [401 仍可能发生：key 被吊销/失效] → 按 spec 冒泡呈现错误并保留缓存模型；用户重新 `/login omniroute` 后再次刷新即恢复。
- [env 回退与 pi 未来凭据解析不一致（如新增 env 名）] → 仅影响 0.83/桩形态；新增测试钉住"credential→env"优先级，未来变更会被测试暴露。
- [非 OmniRoute 的开放网关 baseUrl] → 无 key 时裸请求照旧；行为不回退。

## Migration Plan

- 无配置/数据迁移。发布后既有 `models-store.json` 缓存在下一次成功刷新时自然覆盖。
- 回滚：revert 本变更提交；行为回到无认证刷新（旧问题复现，但无新破坏）。

## Open Questions

无。

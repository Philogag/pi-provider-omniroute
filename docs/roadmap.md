# OmniRoute Pi Custom Provider 插件 Roadmap

> 目标：为 Pi Agent 开发一个自定义 provider 插件，将 [OmniRoute](https://github.com/diegosouzapw/OmniRoute) 作为供应商接入。
> 核心思路：基于 OpenAI 兼容端点（`openai-completions` API）接入，并在此之上逐步把 OmniRoute 内置的工具接口暴露为 Pi 的 agent tools。

## 1. 背景与目标

Pi 扩展可通过 `pi.registerProvider()` 注册自定义模型提供商，通过 `pi.registerTool()` 注册 agent 可调用的工具。OmniRoute 是一个本地优先的 AI API 代理路由器，提供：

- **OpenAI 兼容代理端点**：`/api/v1/chat/completions`（支持流式 SSE、tool calling）
- **丰富的管理 REST 接口**：providers、models、keys、combos、fallback、usage、telemetry、memory、compression 等
- **Agent Skills catalog**：`/api/agent-skills` 提供 42 个 SKILL.md（22 REST API + 20 CLI），专门供外部 agent/MCP/A2A 发现能力

本插件的目标：

1. **接入**：通过 OpenAI 兼容接口，把 OmniRoute 注册为 Pi 的 provider。
2. **自动导入模型**：启动时拉取 OmniRoute 的模型列表，自动注册为 Pi 模型。
3. **（后续）工具化**：把 OmniRoute 内置的管理/工具接口封装为 Pi agent tools。

### 参考文档

| 来源 | 内容 |
| --- | --- |
| https://pi.dev/docs/latest/custom-provider | Pi provider 插件定义（registerProvider / streamSimple / 模型定义） |
| https://pi.dev/docs/latest/extensions | Pi 扩展机制（registerTool、事件、生命周期） |
| `docs/omniroute-openapi.yaml` | OmniRoute v3.8.50 OpenAPI 全量接口定义 |

## 2. 核心技术事实

接入前必须确认的关键事实（均来自 `docs/omniroute-openapi.yaml`）：

### 2.1 端点与 baseUrl

- OmniRoute 默认本地地址：`http://localhost:20128`
- **OpenAI 兼容端点统一带 `/api/v1` 前缀**，例如：
  - `POST /api/v1/chat/completions`（Chat Completions，支持 JSON 与 SSE）
  - `GET /api/v1/models`（模型列表）
  - `POST /api/v1/embeddings`、`/api/v1/images/generations`、`/api/v1/audio/*`、`/api/v1/moderations`、`/api/v1/rerank`
  - `POST /api/v1/messages`（Anthropic 兼容）、`POST /api/v1/responses`（OpenAI Responses）
- 因此 Pi provider 的 `baseUrl` 应为 **`http://localhost:20128/api/v1`**（`openai-completions` 会自动拼接 `/chat/completions`）。这是最容易踩坑的点。

### 2.2 认证

- 代理端点与多数管理端点使用 **Bearer token**（OmniRoute 的 API key，dashboard 管理）。
- `requireLogin` 开启后，部分管理端点还需 **management session auth**（`ManagementSessionAuth`）。
- Phase 1 仅支持 Bearer API key；management session 留待后续。

### 2.3 模型列表

- `GET /api/v1/models` 返回 OpenAI 标准结构：`{ object: "list", data: [{ id, object, owned_by }] }`。
- **Model schema 极简**：只有 `id`、`object`、`owned_by`，**不含** contextWindow、maxTokens、cost。
- 导入 Pi 时必须为 cost/contextWindow/maxTokens 提供默认值（或从管理端点补充，见 Phase 2 增强）。
- 模型 ID 形如 `provider/model`（例如 `openai/gpt-4o`）。

### 2.4 遥测响应头

所有成功响应携带 `X-OmniRoute-*` 头：`X-OmniRoute-Response-Cost`、`X-OmniRoute-Tokens-In/Out`、`X-OmniRoute-Provider`、`X-OmniRoute-Latency-Ms`、`X-OmniRoute-Cache-Hit`、`X-OmniRoute-Fallback-Attempts`、`X-OmniRoute-Decision`、`X-OmniRoute-Request-Id`、`X-OmniRoute-Version`。后续可用于 cost/usage 展示（Pi 扩展的 `after_provider_response` 事件可读取）。

### 2.5 管理端点全景（后续工具化候选）

| 类别 | 端点前缀 |
| --- | --- |
| Providers | `/api/providers`、`/api/provider-nodes`、`/api/provider-models` |
| Models / Aliases | `/api/models`、`/api/models/alias`、`/api/models/catalog` |
| API Keys | `/api/keys` |
| Routing Combos | `/api/combos`、`/api/combos/metrics`、`/api/combos/test` |
| Fallback | `/api/fallback/chains` |
| Usage / Analytics | `/api/usage/*` |
| Telemetry | `/api/telemetry/summary` |
| Memory | `/api/memory/*`、`/api/settings/memory`、`/api/settings/qdrant/*` |
| Compression | `/api/settings/compression`、`/api/compression/*` |
| Settings | `/api/settings/*`、`/api/pricing/models` |
| Agent Skills | `/api/agent-skills`（catalog / raw SKILL.md / coverage） |

## 3. 阶段划分

### Phase 1（当前目标）：OpenAI 兼容接入 + 自动导入模型

只做两件事：以 OpenAI 兼容接口把 OmniRoute 接成 Pi provider，并自动导入模型。**不做**任何管理工具封装。

#### 任务清单

- **T1.1 扩展骨架**
  - 创建项目本地扩展 `.pi/extensions/omniroute/`（多文件扩展，含 `index.ts`）。
  - 依赖：`@earendil-works/pi-coding-agent`、`typebox`。
  - 导出 `async` 默认工厂函数（async 保证模型在启动完成前注册完毕，`pi --list-models` 可见）。

- **T1.2 注册 provider**
  ```typescript
  pi.registerProvider("omniroute", {
    name: "OmniRoute",
    baseUrl: "http://localhost:20128/api/v1",   // 注意 /api/v1 前缀
    apiKey: "$OMNIROUTE_API_KEY",                // 环境变量插值
    api: "openai-completions",
    models: [...],                               // 见 T1.3
  });
  ```
  - 若 OmniRoute 要求显式 `Authorization: Bearer` 且 `openai-completions` 未正确处理，设 `authHeader: true` 兜底。
  - baseUrl 与 API key 建议支持环境变量覆盖（如 `$OMNIROUTE_BASE_URL`），便于非默认端口。

- **T1.3 自动导入模型**
  - 在工厂函数内 `fetch("${baseUrl}/models")`，解析 `payload.data`。
  - 映射为 `ProviderModelConfig`：
    - `id` / `name`：来自模型列表（name 缺省用 id）。
    - `reasoning: false`（OmniRoute 模型定义不含该信息，先保守关闭；需要思考的模型后续通过 `thinkingLevelMap`/`compat` 按模型覆盖）。
    - `input: ["text"]`（多模态后续补充）。
    - `cost`：默认全 0（OmniRoute 自身在 `X-OmniRoute-Response-Cost` 头提供成本，展示方案见 Phase 4）。
    - `contextWindow` / `maxTokens`：默认值（如 128000 / 4096）。
  - 失败处理：OmniRoute 未启动或认证失败时，**跳过模型注册并告警**，而不是让 Pi 启动失败；可注册 provider 但不注册 models（此时 Pi 仍可能尝试？——需验证，若必须 models 则直接跳过 provider 注册）。

- **T1.4 验证（验收）**
  - `pi --list-models` 能看到 OmniRoute 下的模型。
  - 普通对话（非流式）正常返回。
  - 流式对话正常（SSE）。
  - OpenAI 工具调用可用（`tools` / `tool_choice` / `parallel_tool_calls` 透传，供 Pi 内置工具使用）。
  - 环境变量缺失 / OmniRoute 未启动时的降级行为符合预期。

### Phase 2：核心管理工具（agent tools）

把最常用的管理接口封装为 Pi tools（`pi.registerTool()`），让 agent 能直接操作 OmniRoute：

- providers：列出 / 测试 / 添加 / 删除连接
- models：列表、别名管理、catalog
- keys：API key 管理
- usage：分析、call-logs、budget、cache-health
- combos：路由组合的查看与测试
- fallback：fallback chain 查看与管理
- telemetry：summary 查看

工具命名建议 `omniroute_<area>_<action>`（如 `omniroute_providers_list`），参数用 typebox 定义，统一封装 HTTP 调用与 Bearer 认证、统一错误返回。

### Web 搜索/抓取工具（已实现，add-search-fetch-tools）

- `omniroute_web_search`：封装 `POST /api/v1/search`，参数镜像 `v1SearchSchema`。
- `omniroute_web_fetch`：封装 `POST /api/v1/web/fetch`，参数镜像 `v1WebFetchSchema`。
- 认证复用 omniroute provider 凭据；支持 `timeoutMs` 参数（默认 30s）。

### Phase 3：扩展工具

- memory（增删查、engine-status、summarize、reindex、qdrant 设置）
- compression（设置、预览、language-packs、rules）
- settings / pricing
- cli-tools、embedded services（仅 localhost）
- ocr、图片/音频生成等非 chat 能力

### Phase 4：增强与演进

- **成本/用量展示**：通过 `after_provider_response` 读取 `X-OmniRoute-*` 头，把 cost/延迟/缓存命中写入消息 usage 或 UI。
- **Agent Skills 动态发现**：利用 `/api/agent-skills` catalog 自动发现工具并动态注册，随 OmniRoute 版本演进自动覆盖新能力。
- **模型元数据增强**：从管理端点（`/api/models/catalog`、`/api/pricing/models`）补充 contextWindow/maxTokens/cost，替换 Phase 1 默认值；按模型设置 `reasoning`、`thinkingLevelMap`、`compat`。
- **认证增强**：支持 management session auth（`requireLogin` 场景）；必要时 OAuth（`oauth` 配置）。
- **Anthropic/Responses 兼容**：如需要，注册 `api: "anthropic-messages"` / `"openai-responses"` 变体。

## 4. 验收标准汇总

| 阶段 | 通过标准 |
| --- | --- |
| Phase 1 | `pi --list-models` 可见模型；普通/流式对话与工具调用可用；无 OmniRoute 时可降级不崩溃 |
| Phase 2 | agent 可通过 `omniroute_*` 工具完成 providers/keys/usage/combos/fallback 的典型查询与管理 |
| Phase 3 | memory/compression 等扩展能力可通过工具调用 |
| Phase 4 | cost 展示、skills 动态发现、模型元数据完整化 |

## 5. 风险与决策点

1. **baseUrl 前缀**：必须为 `.../api/v1`，否则 `openai-completions` 拼接后 404。Phase 1 首要验证项。
2. **模型元数据缺失**：`/api/v1/models` 无 context/cost 信息，默认值可能导致大模型被截断或成本统计为 0。→ 后续用管理端点补齐。
3. **管理端点认证**：`requireLogin` 下部分端点需 management session auth，仅 Bearer key 可能 401。→ 决策：Phase 2 工具是否需要 / 如何获得管理会话。
4. **版本演进**：openapi.yaml 固定 v3.8.50；Agent Skills 动态发现可缓解版本漂移。
5. **工具数量**：管理端点众多，需命名规范与分组，避免工具列表臃肿。
6. **模型 ID 前缀**：`provider/model` 形式可能在 Pi 中与 provider 名重复（如 OmniRoute 下模型 `openai/gpt-4o` 与原生 openai provider 冲突）→ 需决策是否对模型 ID 做去重/改写。

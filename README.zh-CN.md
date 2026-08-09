# pi-provider-omniroute

> **English**: [README](README.md) · **简体中文**：[中文文档](README.zh-CN.md)

> 为 [Pi Agent](https://pi.dev) 提供的 OmniRoute OpenAI 兼容 provider 扩展，内置网页搜索与抓取工具。

`pi-provider-omniroute` 把 [OmniRoute](https://github.com/diegosouzapw/OmniRoute) 注册为 Pi Agent 的自定义模型供应商，并把 OmniRoute 自带的网页搜索与抓取端点封装为 Pi 原生 agent 工具。

OmniRoute 是本地优先的 AI API 代理路由器，Pi 是终端编程 agent。本扩展把两者连起来：让 Pi 指向你本地运行的 OmniRoute 实例，即可使用任何被路由的模型进行对话，并直接调用搜索/抓取工具，无需额外配置。

## 功能特性

- **Provider**
  - **OpenAI 兼容 chat provider** —— 在 `omniroute` provider 名下注册 OmniRoute，支持流式 chat completions 与 tool calling。
  - **标准凭据存储** —— API key 走 Pi 自带的 `/login` 凭据存储（无自定义登录流程），key 处理遵循 Pi 自身的安全模型。
  - **静态模型列表** —— 启动时调用一次 `GET /v1/models` 生成静态模型列表；OmniRoute 不可达时降级为空列表并告警，不影响 Pi 启动。
  - **可配置 base URL** —— 服务端地址按 `omniroute.json` → `$OMNIROUTE_BASE_URL` → `http://localhost:20128/v1` 解析，也可在 `/omniroute-settings` 中交互编辑。
- **Settings**
  - **`/omniroute-settings` TUI 菜单** —— 三级交互菜单：为 **Search provider**（从实时目录拉取，含静态兜底）或 **Web Fetch provider**（firecrawl / jina-reader / tavily-search / tinyfish）选择默认值，或编辑 **Base URL**，每项显示当前生效值。
  - **持久化配置** —— 选择写入 pi 全局 `omniroute.json`（`search.provider` / `fetch.provider` / 根级 `baseUrl`），每次会话启动自动加载。
- **Tool**
  - **`omniroute_web_search` 工具** —— 封装 `POST /v1/search`，支持 14 个搜索引擎、2 种搜索类型、7 个时间范围、国家/语言过滤与可选的全文抽取。
  - **`omniroute_web_fetch` 工具** —— 封装 `POST /v1/web/fetch`，支持 4 个抓取后端（Firecrawl、Jina Reader、Tavily Extract、TinyFish），4 种输出格式、0–2 层递归与 CSS 选择器等待。
  - **可配置默认 provider** —— 两个工具执行时按"显式入参 > 已配置 > 省略"合并 `provider` 字段，在 `/omniroute-settings` 固定默认值，无需改变模型的调用方式。
  - **TypeBox 校验入参** —— 工具入参由 Pi 做静态校验。
  - **成本遥测** —— 将 OmniRoute `X-OmniRoute-*` 遥测的真实美元成本写入 Pi 的用量/成本统计，完整遥测附加到每条消息的 `diagnostics`。

## 环境要求

- Node.js ≥ 20（用于 `--experimental-strip-types`）
- 一份 Pi 可达的 [OmniRoute](https://github.com/diegosouzapw/OmniRoute) 实例
- [Pi Agent](https://pi.dev) ≥ 0.83

## 安装

使用 Pi 内置的安装器直接从 Git 仓库安装：

```bash
pi install git:github.com/Philogag/pi-provider-omniroute
```

下次启动 Pi 时会自动加载本扩展，无需额外配置。后续升级只需重新执行同一条命令。

## 配置

### 1. 选择 base URL

默认值 `http://localhost:20128/v1`。OmniRoute 的 OpenAI 兼容端点都在该前缀下，`openai-completions` 会自动追加 `/chat/completions`。

如 OmniRoute 部署在别处，可任选其一：

- 设置环境变量 `OMNIROUTE_BASE_URL=https://your-host/v1`，**或**
- 在 Pi 中执行 `/login` 并粘贴 OmniRoute API key，**或**
- 在 `/omniroute-settings` 的 Base URL 项中交互编辑（写入 `omniroute.json`）。

### 2. 提供 API key

- 在 Pi 中执行 `/login` 并粘贴 OmniRoute API key。

API key 会写入 Pi 的 `auth.json`（路径：`$PI_AGENT_DIR/auth.json` 或 `~/.pi/agent/auth.json`）。

### 快速验证

```bash
pi --list-models | grep omniroute
```

你应能看到当前 OmniRoute 实例下所有模型，挂在 `omniroute/` 命名空间下。

## 使用

安装并登录后，OmniRoute 的模型就会出现在 Pi 的模型选择器中。对话、流式输出与 tool calling 与其他 Pi provider 行为一致 —— Pi 会透明地处理 OpenAI 兼容线协议。

### 可用工具

本扩展注册了两个 agent 工具。由模型决定调用时机，你也可以手动触发。

| 工具 | 封装端点 | 说明 |
| --- | --- | --- |
| `omniroute_web_search` | `POST /v1/search` | 14 个搜索引擎、`web`/`news`、时间范围、国家、语言、可选全文抽取。 |
| `omniroute_web_fetch` | `POST /v1/web/fetch` | 4 个抓取后端、`markdown`/`html`/`links`/`screenshot`、0–2 层递归、选择器等待。 |

两个工具共同点：

- 复用 omniroute provider 的已存储凭据（Pi `/login` 写入的 key）。
- 默认 30 秒超时，可通过 `timeoutMs`（1–120000）按调用覆盖。
- 返回纯文本主体，最多 40000 字符，避免撑爆上下文窗口。

### 示例：搜索

```text
> 搜索 TypeScript 5.9 最新发布说明。
```

模型会调用 `omniroute_web_search`，传入 `query`、`max_results` 与可选的 `provider`。

### 示例：抓取网页

```text
> 抓取 https://example.com 并总结内容。
```

模型会调用 `omniroute_web_fetch`，传入 `url`，`format` 默认 `markdown`。

### 默认 provider 配置

两个工具在模型未显式传入 `provider` 时，请求体不带该字段。如需为每次调用固定默认 provider，可打开内置设置菜单：

```text
/omniroute-settings
```

菜单为两级交互式（顶层 → provider 子面板），当前启用的 provider 行首标 `✓`。选择会持久化到 pi 全局配置文件 `$PI_AGENT_DIR/omniroute.json`（或 `~/.pi/agent/omniroute.json`）：

```json
{
  "search": { "provider": "tavily-search" },
  "fetch": { "provider": "jina-reader" }
}
```

执行时各工具按 **显式入参 > 已配置 > 省略** 解析 provider——例如以上配置下，`omniroute_web_search` 未传 `provider` 时用 `tavily-search`，`omniroute_web_fetch` 未传时用 `jina-reader`。在菜单中选择 `auto` 可清除已存 provider，回退到服务端默认。

### 成本遥测

OmniRoute 在每个流式响应体的尾部以 SSE 注释行（`: x-omniroute-*`）下发单次请求的成本数据。扩展拦截字节流、解析这些行，并接入 Pi 的计费体系：

- **Pi 用量统计显示真实成本** —— `X-OmniRoute-Response-Cost`（定长小数 USD 金额，如 `0.0000190400`）覆盖每条消息的 `usage.cost.total`，Pi 的成本/用量汇总反映 OmniRoute 的实际计费而非模型的静态价格；token 数仍采用 Pi 的解析值。
- **缓存命中按 $0 计费** —— 当 `X-OmniRoute-Cache-Hit` 为 `true` 时，OmniRoute 上报的 `Response-Cost` 为 `0`；扩展原样采用，被缓存的轮次成本显示为 `0`。
- **完整遥测写入 `diagnostics`** —— 每条消息携带 `omniroute-telemetry` 诊断，包含 `model`、`provider`、`tokensIn`、`tokensOut`、`cacheHit`、`responseCost`、`latencyMs`，可随时查看任意轮次的路由细节。

捕获是尽力而为且字节透传：若遥测缺失（旧版 OmniRoute、非 OmniRoute 响应），流原样透传，Pi 回退到静态定价。

## 开发

```bash
# 类型检查
npm run typecheck

# 运行测试（Node 内置 test runner，无额外依赖）
npm test
```

测试套件基于 Node `--experimental-strip-types`，覆盖 auth 流程、URL 校验、模型列表拉取、settings 持久化、成本遥测与两个工具。无需联网。

### 目录结构

```text
src/
  index.ts              # 扩展入口：registerProvider + registerTool
  auth.ts               # URL 校验辅助（默认 base URL + 规范化）
  auth-credentials.ts   # 从 auth.json 解析已存储凭据
  tools/
    http.ts             # HTTP 工具、凭据解析、错误约定
    search.ts           # omniroute_web_search
    web-fetch.ts        # omniroute_web_fetch
    search-config.ts    # /omniroute-settings 菜单状态机 + omniroute.json 持久化
test/                   # 与 src/ 镜像
docs/
  roadmap.md            # 长期规划（阶段 1–4）
  omniroute-openapi.yaml # 内部使用的 OmniRoute v3.8.50 OpenAPI 规范
openspec/               # 规范驱动的变更追踪
```

## 路线图

本扩展按阶段推进，详见 [`docs/roadmap.md`](docs/roadmap.md)。

- **阶段 1 ✅** OpenAI 兼容 provider + 静态模型列表 + 成本遥测。
- **阶段 2 🚧** 封装核心管理端点为工具：`omniroute_providers_*`、`omniroute_models_*`、`omniroute_keys_*`、`omniroute_usage_*`、`omniroute_combos_*`、`omniroute_fallback_*`、`omniroute_telemetry_*`。搜索/抓取已随 `add-search-fetch-tools` 发布。
- **阶段 3** 内存、压缩、设置/定价、CLI/嵌入式服务。
- **阶段 4** 通过 `X-OmniRoute-*` 响应头展示成本/用量；通过 `/api/agent-skills` 动态发现能力；从 `/api/models/catalog` 与 `/api/pricing/models` 补齐模型元数据。

## 已知限制

- **模型元数据极简。** OmniRoute `/v1/models` 只返回 `id`、`object`、`owned_by`。本扩展为每个模型填充 `contextWindow: 128000`、`maxTokens: 4096`、`cost: 0`。长上下文模型可能被截断；价格未展示。阶段 4 会修复。
- **不支持自动识别 reasoning 模型。** 所有导入模型都设为 `reasoning: false`。若把 reasoning 模型路由到 OmniRoute，链式思考提示质量会下降，待按模型补充元数据后解决。
- **仅支持 Bearer 认证。** OmniRoute 的 `requireLogin` 模式（management session auth）暂未支持。
- **未注册 Anthropic/Responses API 变体。** 只注册了 `openai-completions`。如需 Anthropic 格式或 OpenAI Responses 透传，请在 fork 中额外注册 provider。

## 许可证

MIT。详见 [`LICENSE`](LICENSE)。

## 致谢

- [OmniRoute](https://github.com/diegosouzapw/OmniRoute) —— diegosouzapw 开发的代理，本扩展的目标后端。
- [Pi Agent](https://pi.dev) —— earendil-works 开发的宿主 agent 运行时。

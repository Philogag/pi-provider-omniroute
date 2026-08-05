# pi-provider-omniroute

> 为 [Pi Agent](https://pi.dev) 提供的 OmniRoute OpenAI 兼容 provider 扩展，内置网页搜索与抓取工具。

`pi-provider-omniroute` 把 [OmniRoute](https://github.com/diegosouzapw/OmniRoute) 注册为 Pi Agent 的自定义模型供应商，并把 OmniRoute 自带的网页搜索与抓取端点封装为 Pi 原生 agent 工具。

OmniRoute 是本地优先的 AI API 代理路由器，Pi 是终端编程 agent。本扩展把两者连起来：让 Pi 指向你本地运行的 OmniRoute 实例，即可使用任何被路由的模型进行对话，并直接调用搜索/抓取工具，无需额外配置。

## 功能特性

- **OpenAI 兼容 chat provider** —— 在 `omniroute` provider 名下注册 OmniRoute，支持流式 chat completions 与 tool calling。
- **自动导入模型** —— 启动时调用 `GET /v1/models`，把每个被路由的模型（如 `openai/gpt-4o`）注册为 Pi 模型。
- **懒加载模型列表** —— 模型按需拉取，扩展启动时不再强制联网；OmniRoute 离线也能正常启动 Pi。
- **`omniroute_web_search` 工具** —— 封装 `POST /v1/search`，支持 14 个搜索引擎、2 种搜索类型、7 个时间范围、国家/语言过滤与可选的全文抽取。
- **`omniroute_web_fetch` 工具** —— 封装 `POST /v1/web/fetch`，支持 4 个抓取后端（Firecrawl、Jina Reader、Tavily Extract、TinyFish），4 种输出格式、0–2 层递归与 CSS 选择器等待。
- **交互式登录** —— `/login` 时依次提示输入 API key 与 base URL，URL 非法可重试一次，默认值 `http://localhost:20128/v1`。
- **环境变量兜底** —— 若跳过 `/login`，会读取 `OMNIROUTE_API_KEY` 与 `OMNIROUTE_BASE_URL`。
- **TypeBox 校验入参** —— 工具入参由 Pi 做静态校验。

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
- 在 Pi 中执行 `/login`，按提示输入新 URL（输入非法可重试一次）。

### 2. 提供 API key

二选一：

- 在 Pi 中执行 `/login` 并粘贴 OmniRoute API key；**或**
- 设置环境变量 `OMNIROUTE_API_KEY`。

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

- 复用 omniroute provider 的凭据（`OMNIROUTE_API_KEY` 或已存储的 key）。
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

## 开发

```bash
# 类型检查
npm run typecheck

# 运行测试（Node 内置 test runner，无额外依赖）
npm test
```

测试套件基于 Node `--experimental-strip-types`，覆盖 auth 流程、URL 校验、模型懒加载与两个工具。无需联网。

### 目录结构

```text
src/
  index.ts              # 扩展入口：registerProvider + registerTool
  auth.ts               # URL 校验 + 交互式 /login 流程
  auth-credentials.ts   # 从 auth.json 解析已存储凭据
  tools/
    http.ts             # HTTP 工具、凭据解析、错误约定
    search.ts           # omniroute_web_search
    web-fetch.ts        # omniroute_web_fetch
test/                   # 与 src/ 镜像
docs/
  roadmap.md            # 长期规划（阶段 1–4）
  omniroute-openapi.yaml # 内部使用的 OmniRoute v3.8.50 OpenAPI 规范
openspec/               # 规范驱动的变更追踪
```

## 路线图

本扩展按阶段推进，详见 [`docs/roadmap.md`](docs/roadmap.md)。

- **阶段 1 ✅** OpenAI 兼容 provider + 自动导入模型 + 懒加载。
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

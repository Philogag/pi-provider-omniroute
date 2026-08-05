# Init OmniRoute Pi Extension

## 为什么

Pi Agent 需要接入 OmniRoute（本地 AI API 代理路由器），将其注册为 provider 并自动导入可用模型，使 agent 能通过 OmniRoute 调用各种 LLM。Phase 1 专注于 OpenAI 兼容接入，不做管理工具封装。

## 变更内容

- 初始化项目为 pi extension：扩展入口 `src/index.ts`，配置引用入口
- 实现 `pi.registerProvider()` 注册 OmniRoute 为 OpenAI 兼容 provider
- 实现自动模型导入：从 OmniRoute `/api/v1/models` 获取模型列表并注册
- 优雅降级：OmniRoute 未启动或认证失败时不阻止 Pi 启动
- 添加 TypeScript 依赖：`@earendil-works/pi-coding-agent`、`@sinclair/typebox`

## 功能 (Capabilities)

### 新增功能

- `openai-compat-provider`: OmniRoute OpenAI 兼容 provider 注册与模型自动导入

### 修改功能

- （无）

## 影响

- 新增目录：`src/`
- 新增文件：`src/index.ts`（扩展入口）
- 修改文件：`package.json`（添加依赖）
- 技术约束：`baseUrl: http://localhost:20128/api/v1`（`/api/v1` 前缀必须）

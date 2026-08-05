# OmniRoute Pi Extension Design

## 上下文

Pi Agent 支持通过 `registerProvider()` 接入自定义 LLM provider。本项目为 OmniRoute（本地 AI API 代理路由器）创建 Pi 扩展，将其以 OpenAI 兼容模式注册为 provider，并自动导入可用模型。

**当前状态**：项目仅有 roadmap，无任何实现代码。
**约束**：
- baseUrl 必须是 `http://localhost:20128/api/v1`（`/api/v1` 前缀由 OmniRoute 架构决定）
- OmniRoute `/api/v1/models` 仅返回 `id`、`object`、`owned_by`，无 contextWindow/cost/maxTokens
- 使用 `@earendil-works/pi-coding-agent` + `typebox`

## 目标 / 非目标

**目标：**
- 正确注册 OmniRoute 为 Pi provider（`api: "openai-completions"`）
- 启动时自动从 OmniRoute 拉取模型列表并注册
- 环境变量缺失或 OmniRoute 未启动时优雅降级

**非目标：**
- 管理工具封装（Phase 2）
- 模型元数据增强（Phase 4）
- 成本/用量展示（Phase 4）

## 决策

### D1: 项目本地扩展 vs 全局扩展

选择项目本地扩展（直接以项目根目录作为 extension）而非在子目录中创建扩展：
- 便于随项目版本管理扩展代码
- 团队共享时无需额外安装步骤
- Pi 支持通过 `--extension` 或配置指定本地扩展路径

### D2: async 工厂函数

```typescript
export default async (pi: Pi) => { ... }
```

使用 async 工厂函数确保模型注册（可能涉及网络请求）在 Pi 启动流程完成前执行完毕，`pi --list-models` 可见。

### D3: 优雅降级策略

当 OmniRoute 不可用时（网络错误/认证失败），跳过模型注册但仍注册 provider（或完全不注册），避免阻止 Pi 启动：
- 如果 fetch 失败，打印 warning，继续执行
- Provider 注册本身不需要模型列表

### D4: 模型默认值

由于 OmniRoute models API 不返回元数据：
- `reasoning: false`（保守关闭，思考能力需后续按模型配置）
- `input: ["text"]`（多模态暂不支持）
- `cost: 0`
- `contextWindow: 128000`、`maxTokens: 4096`

### D5: 环境变量覆盖

支持通过环境变量覆盖默认配置：
- `$OMNIROUTE_API_KEY`（必须）
- `$OMNIROUTE_BASE_URL`（可选，默认 `http://localhost:20128/api/v1`）

## 风险 / 权衡

| 风险 | 缓解措施 |
| --- | --- |
| baseUrl 缺少 `/api/v1` 导致 404 | 文档明确标注，默认值即为正确值 |
| 模型元数据缺失导致大模型截断 | Phase 4 从管理端点补齐；当前用保守默认值 |
| OmniRoute 未启动时 provider 无意义 | 优雅降级，用户主动调用时才感知问题 |

## 迁移计划

无迁移——Phase 1 为全新功能。

## 待解决问题

1. Pi 本地扩展的加载机制是否需要额外配置（如 `pi.json` 中的路径声明）？
2. `authHeader: true` 兜底是否必要？需实际验证 `openai-completions` 是否自动处理 Bearer 认证。

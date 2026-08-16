## Context

现状（动机详见 proposal.md - Why）：

- `src/auth.ts` 的 `omnirouteApiKeyAuth()` 是自造流程：login 同时提示 API key 与 baseUrl，并把 `OMNIROUTE_BASE_URL` 写入 `auth.json` 的 credential env；还带一个非标准的 `check` 回调。
- pi-ai 0.84.2 已导出标准 `envApiKeyAuth(name, envVars)`（`@earendil-works/pi-ai` 主入口）：login 只提示 key，resolve 按"已存凭据 key → 首个命中的环境变量"解析，无 baseUrl 概念。
- `omniroute.json` 已能读取 `baseUrl`（`readOmnirouteConfig` → `resolveOmnirouteBaseUrl`），但 `writeOmnirouteConfig` 只写 `search`/`fetch`，无 baseUrl 写入路径。
- `/omniroute-settings` 顶层菜单（`renderTopLevelMenu`）目前有两项（Search provider / Web Fetch provider），由 `createMenuStateMachine` 状态机驱动；pi-tui 提供 `Input` 单行文本输入组件（onSubmit/onEscape/setValue/getValue）。
- 扩展入口 `src/index.ts` 在模块加载期以 `const baseUrl = resolveOmnirouteBaseUrl()` 捕获 baseUrl，`refreshModels` 与 `toOmnirouteModel` 闭包使用它；工具侧 `src/tools/http.ts` 的 `resolveBaseUrl(ctx)` 优先取 `ctx.model.baseUrl`（omniroute 模型）。
- 已安装 pi-ai 为 0.84.2（package.json 声明 ^0.83.0）。

## Goals / Non-Goals

**Goals:**
- `/login omniroute` 与 pi-ai 标准 api-key 流程一致：只收集 API key，不提示 baseUrl，无自定义 `check`。
- `omniroute.json` 的 `baseUrl` 字段成为 baseUrl 的唯一持久化点，且可经 `/omniroute-settings` 交互式修改/校验。
- 存量 auth.json legacy baseUrl 启动时一次性迁移到配置文件，之后不再读取。
- 修改 baseUrl 后尽力刷新模型，保证同一会话内模型端点一致。

**Non-Goals:**
- 不改动 `search`/`fetch` provider 配置的既有行为与 UI 交互。
- 不引入 `OMNIROUTE_DASHBOARD_PASSWORD` 等管理端点认证（Phase 2 范围）。
- 不做 baseUrl 的多实例/多 profile 管理。
- 不改变 `validateAndNormalizeBaseUrl` 的校验规则与默认值 `http://localhost:20128/v1`。

## Decisions

### D1: 用标准 `envApiKeyAuth` 替换自造 auth

`src/auth.ts` 中 `omnirouteApiKeyAuth()` 的实现替换为：

```ts
import { envApiKeyAuth } from "@earendil-works/pi-ai";
export const omnirouteApiKeyAuth = () =>
  envApiKeyAuth("OmniRoute API key", ["OMNIROUTE_API_KEY"]);
```

- login 只提示 key（`interaction.prompt({ type: "secret" })`），凭据只含 key，不再内嵌 `env: { OMNIROUTE_BASE_URL }`。
- 删除自定义 `check` 回调（标准实现无此方法；Models 缺省会通过 resolve 判断可用性）。
- 保留 `validateAndNormalizeBaseUrl` 与 `OMNIROUTE_DEFAULT_BASE_URL`（供配置写入路径与解析回退使用）。

备选：保留自造实现只删 baseUrl 提示。放弃理由：`check`、凭据 env 注入等仍偏离标准，且与上游 `envApiKeyAuth` 产生重复维护；直接用官方 helper 语义最干净。

### D2: baseUrl 持久化收敛到 `omniroute.json`，启动时一次性迁移 legacy

- 新增 `writeOmnirouteBaseUrl(url: string | undefined)`（放 `src/tools/search-config.ts`）：沿用现有读-改-写模式（保留未知键、tmp+rename 原子写、`0o600` 权限），`undefined` 表示删除 `baseUrl` 字段（重置语义）。
- `resolveOmnirouteBaseUrl()` 改为：`omniroute.json baseUrl` → `OMNIROUTE_BASE_URL` env → 默认值。**移除** `resolveStoredBaseUrl()`（auth.json env）作为常驻回退。
- 一次性迁移：`src/index.ts` 的 `session_start` 回调中，若配置文件无 `baseUrl`、env 未设置、且 legacy `resolveStoredBaseUrl()` 有值 → 调 `writeOmnirouteBaseUrl(value)` 写入并更新内存 baseUrl。迁移只发生一次（写入后配置字段存在，后续不再触发）。
- `src/auth-credentials.ts` 保留 `readCredential`/`resolveStoredBaseUrl` 仅作迁移读取源；若实现后确认无其他引用，可将其折叠进 search-config.ts 或删除（迁移读取内联）。

备选：直接删除 legacy 读取（proposal 初稿的 BREAKING 方案）。放弃理由：经用户确认选一次性迁移——存量用户无感，且配置仍成为唯一持久化点，不违背"移到配置文件"的目标。

### D3: provider baseUrl 变为可变的模块级状态

`src/index.ts` 中：

- `const baseUrl = resolveOmnirouteBaseUrl()` → `let baseUrl`（或引入 `currentBaseUrl` 存取函数），`refreshModels` / `toOmnirouteModel` / `provider.baseUrl` 闭包继续引用同一变量。
- settings 命令的 `onCommitBaseUrl` 回调（见 D4）负责：校验 → 更新 `let baseUrl` → `writeOmnirouteBaseUrl`。
- 提交后尽力刷新模型：`await ctx.modelRegistry.refresh({ providers: ["omniroute"], force: true })` 包 try/catch；失败或不可用时 `ctx.ui.notify("Base URL 已更新，模型将在下次会话刷新", "info")`。刷新成功后 `refreshModels` 会从新 baseUrl 拉取 `/models` 并重建模型列表（新模型对象携带新 baseUrl，工具侧 `resolveBaseUrl` 因此自动一致）。
- 顶层菜单 "Base URL" 行的预览值从 `let baseUrl` 读取，提交后立即刷新。

备选：修改后要求重启。放弃理由：经用户确认选尽力刷新；同一会话内模型端点不一致（工具请求优先模型自带 baseUrl）会造成隐性错误，尽力刷新可消除。

### D4: `/omniroute-settings` 顶层菜单新增 "Base URL" 条目，用 `Input` 组件编辑

- `renderTopLevelMenu` 的 `SelectItem[]` 增加第三项 `{ value: "base-url", label: "Base URL: <当前值>" }`。
- 状态机新增模式 `"sub-base-url"`；激活后渲染一个 pi-tui `Input` 组件（`setValue(当前 baseUrl)` 预填）：
  - **Enter**：取值 → 空字符串则重置（`onCommit(undefined)`）；否则 `validateAndNormalizeBaseUrl` 校验，非法时行内提示错误（重试，不清空输入），合法则 `onCommit(normalized)`。
  - **Esc**：取消，返回顶层菜单。
- `onCommit`：更新 `let baseUrl` → `writeOmnirouteBaseUrl` → 尽力刷新模型（D3）→ 返回顶层菜单（预览更新）。
- 校验/重置逻辑抽成纯函数（如 `resolveBaseUrlInput(raw: string): { ok: true; value: string | undefined } | { ok: false; error: string }`），便于单元测试；非 TUI 模式行为不变（G3 notify）。

备选：复用 `AuthInteraction.prompt` 交互式提示。放弃理由：settings 命令上下文没有 AuthInteraction，且 `Input` 组件与现有 TUI 覆盖层（`ctx.ui.custom`）一致，可保留边框/键提示风格。

## Risks / Trade-offs

- [设置的新 baseUrl 是非法 URL] → 校验失败时在输入框下方显示错误提示并留在编辑态，不写配置；合法才提交。错误文案复用 `validateAndNormalizeBaseUrl` 的 Error message。
- [尽力刷新失败（离线/接口变更），模型仍带旧 baseUrl] → 工具请求 `resolveBaseUrl` 优先 `ctx.model.baseUrl`；刷新失败时 notify 提示下次会话刷新，模型端点在本次会话内保持自洽（旧地址），避免新旧混用。
- [迁移写入失败（目录不可写）] → `writeOmnirouteBaseUrl` 沿用现有 try/catch + warn 模式，失败仅告警，内存 baseUrl 仍更新；下次启动再次尝试迁移（配置字段仍未写入）。
- [`modelRegistry.refresh` 语义在不同宿主版本可能不同（reload models.json vs 触发 provider refresh）] → 尽力而为 + notify 兜底；行为差异仅影响"本次会话内模型是否立即更新"，不影响配置正确性。
- [扩展写 settings.json 与 pi 自身写 settings.json 并发（均罕见、用户触发）] → 写前读最新内容、只改 `pi-provider-omniroute` 块、原子替换整文件；pi 的 SettingsManager 写入同样保留未知键（`persistScopedSettings` 深合并），块内容在双方写入下都能存活。
- [删除 auth-credentials.ts 可能影响其他引用] → 实现时 grep `resolveStoredBaseUrl` 确认引用面；保留该文件为迁移读取源则无风险。
- [旧 `omniroute.json` 迁移后残留] → 迁移成功（配置块写入成功）才删除；删除用 `unlinkSync` 包 try/catch，失败仅告警不影响功能。

## Migration Plan

1. 发布新版扩展。
2. 存量用户：升级后首次启动，`session_start` 一次性迁移 legacy baseUrl 到 `omniroute.json`；此后 `auth.json` env 不再参与解析。用户也可主动在 `/omniroute-settings` 修改。
3. 新用户：`/login omniroute`（只输 key）或设 `OMNIROUTE_API_KEY`；baseUrl 用默认值或在 `/omniroute-settings` 设置。
4. 回滚：若新版有问题，降级到旧版即可——旧版会重新读取 `auth.json` env（若用户尚未 `/login` 覆写凭据）或环境变量；`omniroute.json` 的 `baseUrl` 在旧版同样被读取（高优先级），因此回滚不会丢失 baseUrl。

## Open Questions

（无——影响 specs/方案/任务拆分的决策已在上述 Decisions 中解决。）

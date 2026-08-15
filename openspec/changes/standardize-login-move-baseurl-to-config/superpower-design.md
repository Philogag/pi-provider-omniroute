# superpower-design — standardize-login-move-baseurl-to-config

> 深度技术设计。需求事实源：`openspec/changes/standardize-login-move-baseurl-to-config/`（proposal.md、design.md、specs/）。本文只做实现级设计，不重新定义需求。
> 上游需求摘要（勿重写）：① `/login omniroute` 走 pi-ai 标准 api-key 流程（只提示 key，凭据不含 baseUrl）；② `settings.json` 的 `pi-provider-omniroute` 块 `baseUrl` 字段成为唯一持久化点，解析优先级 配置块 → `OMNIROUTE_BASE_URL` env → 默认值 `http://localhost:20128/v1`；③ 旧 `omniroute.json`（baseUrl+search/fetch，成功后删除）与旧版 auth.json 遗留 baseUrl 启动时一次性迁移；④ `/omniroute-settings` 顶层菜单新增 Base URL 条目（校验/写入/空输入重置）；⑤ 提交后尽力刷新模型。
> 已确认决策（用户批准）：启动一次性迁移 / 提交后尽力刷新 / 空输入=重置。

## 1. 目标与非目标

**目标**
- 消灭自造 auth 流程：login 只收集 key，删除非标准 `check` 与凭据 env 注入。
- baseUrl 生命周期完全由 `settings.json` 的 `pi-provider-omniroute` 块驱动：读（已有）、写、重置、迁移、UI 编辑闭环。
- 修改 baseUrl 后同一会话内模型端点保持一致（尽力刷新）。
- 所有行为可被单元测试覆盖，不依赖真实网络。

**非目标**
- 不改 `search`/`fetch` provider 的既有 UI 与持久化行为。
- 不做管理端点认证（Phase 2）。
- 不引入多 profile / 多实例 baseUrl。
- 不改变 `validateAndNormalizeBaseUrl` 校验规则与默认值。

## 2. 总体数据流：baseUrl 生命周期

```
模块加载       resolveOmnirouteBaseUrl()  →  let baseUrl   （config → env → default，不再读 legacy）
   │
session_start  迁移：config 无 baseUrl 且 env 未设且 legacy 有值
   │            → writeOmnirouteBaseUrl(legacy) → baseUrl = legacy → 尽力刷新模型
   │
/omniroute-settings
   │  顶层菜单 "Base URL: <baseUrl>" 预览
   ▼
  sub-base-url 模式：Input 预填 baseUrl
   ├─ Enter + 合法 URL  → writeOmnirouteBaseUrl(url) → baseUrl = url → 尽力刷新 → 回顶层
   ├─ Enter + 空输入     → writeOmnirouteBaseUrl(undefined) → baseUrl = resolveOmnirouteBaseUrl() → 回顶层
   ├─ Enter + 非法 URL  → 编辑态显示错误，不写配置
   └─ Esc             → 丢弃输入，回顶层

工具调用       resolveBaseUrl(ctx)：omniroute 模型 baseUrl → resolveOmnirouteBaseUrl()（config → env → default）
```

## 3. 详细技术设计

### 3.1 标准登录流程（D1）

`src/auth.ts`：

```ts
import { envApiKeyAuth } from "@earendil-works/pi-ai";

export const omnirouteApiKeyAuth = () =>
  envApiKeyAuth("OmniRoute API key", ["OMNIROUTE_API_KEY"]);
```

- 删除：`promptBaseUrlWithRetry`、`MAX_URL_RETRIES`、login 中 baseUrl 提示、凭据 `env: { OMNIROUTE_BASE_URL }`、自定义 `check`。
- 保留：`OMNIROUTE_DEFAULT_BASE_URL`、`validateAndNormalizeBaseUrl`（被 3.2 的配置写入路径复用）。
- 验证：pi-ai 0.84.2 的 `envApiKeyAuth` 从主入口导出（`export * from "./auth/helpers.ts"`），resolve 语义 = 已存凭据 key 优先，否则首个命中的 env var。`login` 内部已有 `interaction.signal.throwIfAborted()` 防护。

`src/index.ts` provider 定义中 `auth: { apiKey: omnirouteApiKeyAuth() }` 调用方式不变（返回的 `ApiKeyAuth` 无 `check`，Models 缺省走 resolve 判断可用性）。

### 3.2 baseUrl 解析链统一与配置块写入（D2）

`src/tools/search-config.ts`（配置读写目标改为标准 `settings.json`：`$PI_AGENT_DIR/settings.json`）：

```ts
export function writeOmnirouteBaseUrl(url: string | undefined): void
```

- 复用现有读-改-写模式，目标文件改为 `settings.json`：`readFileSync` 完整读入 settings.json → 保留所有未知键（含 pi 自身管理的 packages/theme/subagents 等）→ 在 `root["pi-provider-omniroute"]` 块内设/删 `baseUrl` → `mkdirSync` + `writeFileSync(tmp, 0o600)` + `renameSync` 原子替换。
- `readOmnirouteConfig()` 同样改为读 `settings.json` 的 `pi-provider-omniroute` 块（baseUrl/search/fetch；块不存在则返回空配置）。
- `undefined` = 删除字段（重置语义）；字符串 = 原样写入（调用方负责已校验）。
- 失败仅 `console.warn`（与 `writeOmnirouteConfig` 一致）。

`resolveOmnirouteBaseUrl()` 改为：

```ts
return (
  readOmnirouteConfig().baseUrl ??
  process.env.OMNIROUTE_BASE_URL ??
  OMNIROUTE_DEFAULT_BASE_URL
);
```

- 移除 `resolveStoredBaseUrl()` 回退项与旧 `omniroute.json` 文件读取（legacy 只在迁移路径读取）。

新增纯函数（可单测）：

```ts
export type BaseUrlInputResult =
  | { ok: true; value: string | undefined }   // undefined = 重置
  | { ok: false; error: string };

export function parseBaseUrlInput(raw: string): BaseUrlInputResult
```

- `trim() === ""` → `{ ok: true, value: undefined }`（与 `validateAndNormalizeBaseUrl("") → 默认值` 语义一致，重置回退到 env/默认）。
- 否则 `validateAndNormalizeBaseUrl(raw)`：成功 → `{ ok: true, value: normalized }`；抛错 → `{ ok: false, error: err.message }`（如 `Invalid base URL: "..."`）。`/v1` 缺失警告（console.warn）保留，仍视为合法。

### 3.3 一次性迁移（D3）

`src/tools/search-config.ts`：

```ts
/** 返回迁移后的 baseUrl（已写入配置块）；未发生迁移返回 undefined。 */
export function migrateLegacyConfig(): string | undefined
```

- 条件：`readOmnirouteConfig().baseUrl === undefined` 且 `process.env.OMNIROUTE_BASE_URL` 未设置。
- 源收集（按序，仅填补缺失字段）：① 旧 `omniroute.json`（`$PI_AGENT_DIR/omniroute.json`，若存在——其 `baseUrl`/`search`/`fetch` 并入配置块，仅当块内对应字段缺失；迁移成功后 `unlinkSync` 删除该文件，删除失败仅 warn）；② 旧版 `/login` 遗留 `resolveStoredBaseUrl()`（auth.json env，仅 baseUrl，且仅当①未提供 baseUrl）。
- 动作：写入配置块 → 返回迁移后的 baseUrl（优先①的 baseUrl，否则②）。
- 幂等：写入后配置字段存在，后续启动条件不满足，自然只迁移一次；写入失败不删旧文件，下次启动重试。

`src/index.ts` session_start：

```ts
pi.on?.("session_start", async (_ev, ctx) => {
  const migrated = migrateLegacyConfig();
  if (migrated !== undefined) {
    baseUrl = migrated;
    await refreshOmnirouteModels(ctx);   // 尽力而为（见 3.5）
  }
  const cfg = readOmnirouteConfig();
  currentConfigProvider = cfg.search?.provider;
  currentFetchProvider = normalizeFetchProvider(cfg.fetch?.provider);
});
```

- 已验证：`SessionStartEvent` handler 第二参 `ctx: ExtensionContext` 含 `modelRegistry` 与 `ui`，可触发刷新/通知。
- 时序风险：provider 的 `refreshModels` 可能在 session_start 之前/并行执行（用加载期 baseUrl 拉过模型）。迁移后尽力刷新兜底，保证模型列表最终落在新地址。

### 3.4 settings 菜单 Base URL 编辑（D4）

`src/index.ts` settings 命令改造：

1. 菜单依赖绑定：`resolveBaseUrl: () => baseUrl`（模块级 `let`，settings 管理的就是配置文件管理的值；不再用 `resolveBaseUrl(ctx)` 以避免当前模型非 omniroute 时漏掉配置文件）。
2. 顶层条目：`renderTopLevelMenu` 的 items 增加 `{ value: "base-url", label: \`Base URL: ${baseUrl}\` }`（长 URL 截断展示，建议 ≤48 字符，尾部省略）。
3. 状态机新增模式 `"sub-base-url"`：
   - 激活：`mode = "sub-base-url"`，失效化顶层缓存与 editor 缓存。
   - 渲染 `renderBaseUrlEditor(tui, theme, { current, onCommit, onCancel, requestRender })`：Container + DynamicBorder + 标题 "Base URL" + 提示行（如 "Enter OmniRoute base URL (empty = default)"）+ pi-tui `Input`（`setValue(current)` 预填、`focused = true`）+ 条件错误提示行（`theme.fg("warning", ...)`）+ 键提示（`enter=save · esc=back`）。
   - 事件：
     - `input.onSubmit = (raw) => { const r = parseBaseUrlInput(raw); if (r.ok) onCommit(r.value); else { error = r.error; requestRender(); } }`（错误态保留输入、聚焦继续编辑）。
     - `input.onEscape = onCancel`；容器 handleInput 路由到 Input（与现有 submenu 容器同模式）。
   - 实例缓存：editor 组件按模式缓存（同 submenu 缓存理由——`Input` 光标在实例状态中，重复渲染会重置光标）。
4. `onCommitBaseUrl(value: string | undefined)`：
   ```ts
   writeOmnirouteBaseUrl(value);
   baseUrl = value ?? resolveOmnirouteBaseUrl();   // 重置后重算（env/默认）
   void refreshOmnirouteModels(ctx);
   mode = "top";  // 预览随 baseUrl 更新
   ```
5. `createMenuStateMachine` 依赖项扩展：新增 `initialBaseUrl`、`onCommitBaseUrl`、`resolveBaseUrlInput`（默认 `parseBaseUrlInput`，便于测试注入）。

`src/tools/search-config.ts` 新增 `renderBaseUrlEditor` + 状态机分支（`getComponent` 中 `mode === "sub-base-url"`）。

### 3.5 提交后尽力刷新（D5）

`src/index.ts`：

```ts
async function refreshOmnirouteModels(ctx: ExtensionContext): Promise<void> {
  try {
    await ctx.modelRegistry.refresh({ providers: ["omniroute"], force: true });
  } catch (err) {
    console.warn("[omniroute] model refresh after baseUrl change failed:", err);
    try { ctx.ui.notify("Base URL 已更新，模型将在下次会话刷新", "info"); } catch { /* no-op */ }
  }
}
```

- 语义：`refresh({ providers: ["omniroute"], force: true })` 命中 provider 的 `refreshModels`（闭包引用模块级 `baseUrl`），新模型对象携带新 baseUrl。
- 失败路径：本次会话模型端点保持旧值自洽（工具走模型自带 baseUrl），下次会话懒加载自然用新地址；notify 提示用户。

### 3.6 工具侧解析链统一

`src/tools/http.ts`：

```ts
import { resolveOmnirouteBaseUrl } from "./search-config.ts";

export function resolveBaseUrl(ctx: ExtensionContext): string {
  if (ctx.model?.provider === "omniroute" && ctx.model.baseUrl) {
    return ctx.model.baseUrl;
  }
  return resolveOmnirouteBaseUrl();   // config → env → default
}
```

- 现状缺陷：当前模型非 omniroute 时只查 env/默认，漏掉配置块——与新 spec "配置块优先" 冲突。统一后符合 spec。
- 依赖环检查：`http.ts → search-config.ts → auth.ts`，search-config 不反向依赖 http.ts，无环。
- 行为影响：omniroute 模型在册时 `ctx.model.baseUrl` 优先不变（模型级端点覆盖）；仅回退路径更完整。

## 4. 文件级变更清单

| 文件 | 变更 |
| --- | --- |
| `src/auth.ts` | 替换为 `envApiKeyAuth`；删 `promptBaseUrlWithRetry`/`MAX_URL_RETRIES`/`check`；保留 `validateAndNormalizeBaseUrl`、`OMNIROUTE_DEFAULT_BASE_URL` |
| `src/tools/search-config.ts` | 新增 `writeOmnirouteBaseUrl`、`parseBaseUrlInput`、`migrateLegacyConfig`、`renderBaseUrlEditor`；配置读写改为 `settings.json` 的 `pi-provider-omniroute` 块（保未知键）；`resolveOmnirouteBaseUrl` 去掉 legacy 回退（含旧 omniroute.json）；状态机加 `sub-base-url` 模式与 `initialBaseUrl`/`onCommitBaseUrl` |
| `src/index.ts` | `baseUrl` 改 `let`；session_start 迁移 + 刷新；settings 命令绑定 `resolveBaseUrl: () => baseUrl`、顶层第三条目、`refreshOmnirouteModels` |
| `src/tools/http.ts` | `resolveBaseUrl` 回退改为 `resolveOmnirouteBaseUrl()` |
| `src/auth-credentials.ts` | 保留（仅迁移读取源 `resolveStoredBaseUrl`） |
| `README.md` / `README.zh-CN.md` | 配置章节：baseUrl 改由 `/omniroute-settings` 管理；login 只输 key；迁移说明 |

## 5. 边界条件与错误处理

| 条件 | 处理 |
| --- | --- |
| 输入 `not-a-url` | `parseBaseUrlInput` 返回 error；编辑态显示提示，配置不变，输入保留 |
| 输入空/纯空白 | 视为重置：删配置字段，回退 env/默认 |
| 输入缺 `/v1` 后缀 | 合法（保留 console.warn 提示） |
| 配置写入失败（目录/权限） | warn 后继续；内存 baseUrl 已更新；下次启动再迁移 |
| 迁移写入失败 | 旧 `omniroute.json` **不删除**，告警后下次启动重试 |
| 迁移成功 | 配置块写入成功 → 删除旧 `omniroute.json`（unlink 失败仅 warn） |
| 迁移时 env 已设置 | 不迁移（env 本就优先） |
| 迁移后刷新失败 | notify 提示下次会话刷新；本次会话模型端点自洽 |
| 非 TUI 模式调用 settings | 行为不变（现有 G3 notify） |
| 当前模型非 omniroute | 菜单 catalog fetch 用模块级 baseUrl（修复漏 config）；工具回退链含 config |
| Input 编辑器 Esc | 丢弃输入回顶层，不写配置 |
| 长 baseUrl 超出菜单宽度 | 预览截断（≤48 字符 + …） |

## 6. 测试策略

**重写 `test/auth.test.ts`（现 17 个用例全部针对旧流程）**
- login 只提示 1 次（secret），凭据无 `env.OMNIROUTE_BASE_URL`；取消传播；`resolve` 优先级（存凭据 > env > undefined）；`source` 字段不泄露 key；`check` 不存在（`auth.check === undefined`）。

**新增纯函数单测**
- `parseBaseUrlInput`：合法/非法/空/纯空白/`/v1` 缺失警告（不视为错误）。
- `writeOmnirouteBaseUrl`/`readOmnirouteConfig`（并入 `test/search-config-persistence.test.ts`）：设值、删值（undefined）、保留 settings.json 其他未知键（如 packages/theme）、块不存在时新建块、非法 JSON 兜底。

**迁移（并入 `test/session-start-config.test.ts` 或新文件）**
- 三条件满足（配置块无 baseUrl、env 未设、有旧源）→ 写入配置块 + 返回迁移值；配置块已有 → 不迁移；env 已设 → 不迁移；旧 `omniroute.json` 存在 → 并入（含 search/fetch）并删除文件；旧 omniroute.json 与 auth.json 遗留并存时前者优先；写入失败 → warn 不抛、旧文件保留。

**菜单状态机（`test/search-config-state-machine.test.ts` + `test/search-config-toplevel.test.ts`）**
- 顶层三行（含 Base URL 预览）；激活 → `sub-base-url`；Input onSubmit 合法/空/非法三路；Esc 返回；commit 回调携带值/undefined。

**命令级集成（`test/command-register.test.ts`）**
- `/omniroute-settings` 顶层渲染含 "Base URL"；TUI 外 notify 不变；commit 后触发 `modelRegistry.refresh`（fake registry 断言 providers/force）。

**解析链（`test/lazy-fetch.test.ts`、`test/tools-http.test.ts`、`test/models-metadata.test.ts`）**
- 更新 `resolveOmnirouteBaseUrl` 期望（去掉 auth.json 回退场景，改迁移场景）；`resolveBaseUrl` 回退链含配置文件；现有 env 用例保留。

**回归**：`npm test` + `npm run typecheck`（Node ≥22.6 + `--experimental-strip-types`，无新增依赖）。

## 7. 风险与缓解

- [尽力刷新依赖宿主 `modelRegistry.refresh` 语义] → 已确认 `ExtensionContext.modelRegistry` 存在且 `refresh` 接受 `{ providers, force }`；失败降级为 notify + 下次会话，不影响配置正确性。
- [迁移时序：provider refreshModels 先于迁移执行] → session_start 迁移后主动尽力刷新兜底。
- [Input 组件在状态机重复渲染时丢失光标] → editor 组件按模式缓存（复用 submenu 缓存模式）。
- [auth-credentials.ts 删除风险] → 保留文件仅作迁移读取源，零删除。
- [与 pi 自身并发写 settings.json（均罕见、用户触发）] → 写前读最新内容、只改本块、原子替换；pi 的 SettingsManager 写入深合并保留未知键，块在双方写入下存活。
- [旧 omniroute.json 残留] → 仅迁移成功后删除；删除失败仅 warn 不影响功能。
- [长 URL 撑破菜单] → 预览截断。

## 8. 开放问题

无阻塞项。实现期间如发现 `modelRegistry.refresh` 在特定宿主版本不触发 provider `refreshModels`，仅影响"本次会话立即更新"的体验（已设计 notify 兜底），不需要回改 specs。

# Support Custom baseUrl on Login — Design

## 上下文

Phase 1 把 `OMNIROUTE_BASE_URL` 作为启动期常量（`src/index.ts` 第 13 行），意味着 baseUrl 的所有变更必须发生在 Pi 进程启动之前、且仅通过 shell 环境变量。Pi 的标准 `createProvider({ auth: { apiKey: { login, resolve } } })` 抽象可以同时容纳：

- **API key**（`interaction.prompt({ type: "secret" })` 收集）
- **Provider-scoped env**（Cloudflare 范例：`credential.env` 携带 `CLOUDFLARE_ACCOUNT_ID` 等非 key 字段；`resolve()` 把 `env` 透传给 `ModelAuth`）
- **per-request `baseUrl`**（`ModelAuth.baseUrl` 字段，由 `resolve()` 返回时携带）

参考实现：`providers/cloudflare-auth.js` 的 `cloudflareAIGatewayAuth()` 通过多次 `interaction.prompt` 同时收集 API key、accountId、gatewayId，登录完成后 Pi 自动持久化整个 `ApiKeyCredential`（含 `key` 和 `env`）。

**当前状态**：
- `src/index.ts` 用 `pi.registerProvider("omniroute", { ... })` legacy form
- 无 `auth.apiKey` 概念；baseUrl 仅从环境变量读取
- `OMNIROUTE_API_KEY` 缺失时使用 `"local"` 占位

**约束**：
- `interaction.prompt` 一次只能询问一个值；多个值需要多次调用（按 Cloudflare 范例）
- `auth.json` 中 `ApiKeyCredential.env` 是 `ProviderEnv` 类型，键为字符串，值为字符串
- `ModelAuth.baseUrl` 是 per-request 字段，由 `resolve()` 决定；环境变量兜底也由 `resolve()` 处理

## 目标 / 非目标

**目标：**
- 用户在 Pi 交互式会话中执行 `/login omniroute`，按提示输入 API key 与可选 baseUrl
- 登录后 baseUrl 与 key 一起写入 `~/.pi/agent/auth.json`；后续会话无须重新输入
- 未登录用户仍可通过 `OMNIROUTE_API_KEY` / `OMNIROUTE_BASE_URL` 环境变量使用（保留 Phase 1 ambient 路径）
- `/login omniroute` 反复执行可更新 baseUrl 或 key（pi 标准行为：覆盖旧 credential）

**非目标：**
- `auth.json` 加密（pi 内置）
- OIDC / OAuth（与 OmniRoute 兼容但本次不集成）
- 管理端点 `ManagementSessionAuth`（`/api/auth/login` + cookie）→ 留待 Phase 2 工具化时由 `omniroute_*` 工具处理
- baseUrl 之外的更多 provider 配置（如 `authHeader`、headers）经 `/login` 暴露

## 决策

### D1: 完整 `createProvider()` 形式

```typescript
import { createProvider, openAICompletionsApi } from "@earendil-works/pi-ai";

const provider = createProvider({
  id: "omniroute",
  name: "OmniRoute",
  baseUrl: DEFAULT_BASE_URL,   // fallback；resolve() 阶段可被 credential 覆盖
  auth: { apiKey: omnirouteApiKeyAuth() },
  models: [],
  api: openAICompletionsApi(),
  refreshModels: fetchOmniRouteModels,
});

pi.registerProvider(provider);
```

> 替代方案：保留 `pi.registerProvider("omniroute", {...})` legacy form。否决：legacy form 不支持 `auth.apiKey` 回调；无法承载 `/login` 流程。

### D2: `omnirouteApiKeyAuth()` 设计

```typescript
import type { ApiKeyAuth } from "@earendil-works/pi-ai";

const DEFAULT_BASE_URL = "http://localhost:20128/api/v1";

export function omnirouteApiKeyAuth(): ApiKeyAuth {
  return {
    name: "OmniRoute API key",
    login: async (interaction) => {
      const key = await interaction.prompt({
        type: "secret",
        message: "Enter OmniRoute API key",
      });
      const baseUrl = await interaction.prompt({
        type: "text",
        message: `Enter OmniRoute base URL (default: ${DEFAULT_BASE_URL})`,
        placeholder: DEFAULT_BASE_URL,
      });
      return {
        type: "api_key",
        key,
        env: { OMNIROUTE_BASE_URL: baseUrl.trim() || DEFAULT_BASE_URL },
      };
    },
    resolve: async ({ ctx, credential }) => {
      // 1. stored credential wins
      if (credential?.key) {
        const baseUrl = credential.env?.OMNIROUTE_BASE_URL;
        return {
          auth: {
            apiKey: credential.key,
            ...(baseUrl ? { baseUrl } : {}),
          },
          env: credential.env,
          source: "stored credential",
        };
      }
      // 2. ambient env fallback (Phase 1 行为)
      const envKey = await ctx.env("OMNIROUTE_API_KEY");
      const envBase = await ctx.env("OMNIROUTE_BASE_URL");
      if (envKey) {
        return {
          auth: {
            apiKey: envKey,
            ...(envBase ? { baseUrl: envBase } : {}),
          },
          env: envBase ? { OMNIROUTE_BASE_URL: envBase } : undefined,
          source: "OMNIROUTE_API_KEY",
        };
      }
      return undefined;
    },
  };
}
```

要点：
- baseUrl 通过 `credential.env.OMNIROUTE_BASE_URL` 持久化（参照 Cloudflare 把 `accountId` 存入 `env`）
- `login` 中如果用户留空（按 Enter），`baseUrl.trim() || DEFAULT_BASE_URL` 落到默认值；不允许空字符串
- `resolve()` 优先级：stored credential > ambient env

> 替代方案：把 baseUrl 存为 `ApiKeyCredential` 的自定义字段。否决：`ApiKeyCredential` schema 仅 `key`/`env`/扩展字段；自定义字段不会被 `credential.env` 语义化读取，需自定义 `resolve` 适配器；用 `env.OMNIROUTE_BASE_URL` 是 pi 官方认可的做法（Cloudflare 范例）。

### D3: 移除 `auth` 兼容代码

删除 `src/index.ts` 现有逻辑：
- `const apiKey = process.env.OMNIROUTE_API_KEY;`（D2 的 `resolve` 内已包含）
- `apiKey: apiKey ? "local" : "$OMNIROUTE_API_KEY"`（由 `auth.apiKey.resolve` 替代）

> 替代方案：保留 ambient env 旁路。否决：env 兜底已迁移到 `resolve()`；保留 `apiKey: "$OMNIROUTE_API_KEY"` 反而干扰 pi 的 `ModelRuntime.getAuth` 状态机。

### D4: `refreshModels` 通过 `createProvider` 暴露

```typescript
const provider = createProvider({
  ...
  async refreshModels({ signal }) {
    // resolve() 决定 baseUrl；这里用 create-time DEFAULT 即可（Models 层会重新解析）
    const res = await fetch(`${DEFAULT_BASE_URL}/models`, { signal });
    ...
  },
});
```

`refreshModels` 触发于 pi 的 `pi update --models`；此时尚未确定 per-request baseUrl，使用 `DEFAULT_BASE_URL`（与 OmniRoute 部署地址同源时正确；远端部署场景下 `/models` 仍走默认本地地址——可接受，详见 D5）。

> 替代方案：每次 refresh 前都重读 `process.env.OMNIROUTE_BASE_URL`。否决：与 `resolve()` 内的优先级冲突；refresh 是 Models 元数据阶段，不应解析用户 credential。

### D5: `tryRegisterModels()` 仍使用 `DEFAULT_BASE_URL`

启动期 `tryRegisterModels(baseUrl, pi)` 保持现有实现（5 秒超时 fetch `/models`），仅依赖环境变量或默认值。`/models` 端点与 `/chat/completions` 同源——若用户通过 `/login` 设置了远端 baseUrl 而环境变量未同步，模型列表会拉取失败，但 key 验证在 `resolve()` 阶段独立进行。

权衡：用户应在 `/login` 同时设环境变量 `OMNIROUTE_BASE_URL`，或接受"模型列表不可用，但 key 验证后请求仍走用户配置的 baseUrl"行为。

> 替代方案：把 `tryRegisterModels` 也改为从 credential 读取 baseUrl。否决：增加 ModelRuntime 启动期依赖；credential 解析属 `ModelRuntime` 生命周期外，强行耦合风险高。Phase 4 模型元数据增强时再处理。

## 风险 / 权衡

| 风险 | 缓解措施 |
| --- | --- |
| `/login` 流程不直观（用户期望只输入 key） | placeholder 显示默认值，README 明确流程 |
| 旧用户从环境变量迁移到 `/login` 后行为变化 | `resolve()` 兼容 ambient env，迁移可逆；现有 config 完全保留 |
| baseUrl 通过 `env.OMNIROUTE_BASE_URL` 存储，与同名环境变量键冲突 | 文档说明：`credential.env.OMNIROUTE_BASE_URL` 由 `resolve()` 返回，**不**回写到 `process.env`；二者独立 |
| `tryRegisterModels` 走默认 baseUrl，可能与 `/login` 设置的 baseUrl 不一致 | D5 接受此权衡；启动时 warning `[omniroute] models fetch failed, retry via /login`（详见 1.x） |
| 用户误把 dashboard 密码当作 API key | 错误信息：若 `/v1/models` 返回 401，提示"Check that OMNIROUTE_API_KEY is the proxy API key (not the dashboard password)" |
| `createProvider` 与 `pi.registerProvider` 形态并存造成混淆 | 仅使用 `createProvider`；移除 legacy form |

## 迁移计划

无破坏性变更——`/login` 是新能力；对只设 `OMNIROUTE_API_KEY` / `OMNIROUTE_BASE_URL` 的用户行为完全保留。

部署步骤：
1. 用户安装/升级扩展
2. 现有 ambient env 用户：行为不变，无需任何操作
3. 新用户：在 Pi 中执行 `/login omniroute`，按提示输入 key 与 baseUrl（可回车使用默认）
4. 远端部署用户：`/login omniroute` 时输入远端 baseUrl（如 `https://router.example.com/api/v1`）

回滚：删除 `auth.apiKey` 配置，回退到 Phase 1 实现；`auth.json` 中已存储的 OmniRoute credential 在新版本中仍被 `resolve()` 读取。

## 待解决问题

1. `interaction.prompt` 暂不支持"跳过"语义（用户必须输入或回车接受默认）——如未来需要"完全省略 baseUrl" 流程，需在 prompt 后判断是否存默认值。
2. `credential.env.OMNIROUTE_BASE_URL` 是否应回写到 `process.env`？当前选择不写，避免污染进程环境。
3. `refreshModels` 与用户 `baseUrl` 不一致：未来是否需把 `refreshModels` 也接入 `resolve()`？（Phase 4 范围）

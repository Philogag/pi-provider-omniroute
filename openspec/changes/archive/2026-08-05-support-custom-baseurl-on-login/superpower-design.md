# Support Custom baseUrl on Login — Technical Design

> OpenSpec 需求的事实源位于 `proposal.md` / `design.md` / `specs/api-token-login/spec.md`；本文档基于这些需求做深度技术设计（实现要点、风险、测试、边界），不重写需求。

---

## 1. 架构概览

```
┌────────────────────────────────────────────────────────────────────┐
│                       src/index.ts (extension entry)               │
│                                                                    │
│  ┌─────────────────┐    ┌──────────────────────┐   ┌────────────┐  │
│  │ readCredential() │───▶│ tryRegisterModels()  │──▶│   pi       │  │
│  │  (sync)         │    │  uses storedBaseUrl  │   │ .register  │  │
│  └────────┬────────┘    └──────────────────────┘   │ Provider   │  │
│           │                                        └────────────┘  │
│           ▼                                                        │
│  ┌─────────────────────┐                                           │
│  │  createProvider({   │     ApiKeyAuth (src/auth.ts)             │
│  │   auth: { apiKey:  │────▶ login (interaction.prompt × 2)       │
│  │     omnirouteAuth  │     resolve (stored → env → undefined)    │
│  │   }                │                                           │
│  │  })                │                                           │
│  └─────────────────────┘                                           │
└────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
                    ┌────────────────────────┐
                    │  test/auth.test.ts     │  unit tests
                    │  test/url.test.ts      │  URL 校验 / trim
                    └────────────────────────┘
```

数据流：

1. 扩展启动时同步读 `~/.pi/agent/auth.json`（或 `process.env.PI_AGENT_DIR/auth.json`），提取 omniroute 条目的 `env.OMNIROUTE_BASE_URL`。
2. 启动期 `tryRegisterModels(storedBaseUrl, pi)` 用提取的 baseUrl（无则 `DEFAULT_BASE_URL`）拉 `/v1/models`，5 秒超时。
3. 注册 `createProvider({...})` 给 pi；其 `auth.apiKey.resolve` 在每次请求时按 stored → ambient env 顺序解析。
4. `/login omniroute` 由 pi 触发：调 `login` 回调，先 secret 收 key、再 text 收 baseUrl（带 URL 校验与最多 1 次重试）；返回的 `ApiKeyCredential` 由 pi 持久化。

---

## 2. 文件布局

```
src/
├── index.ts            # 扩展入口；readCredential + tryRegisterModels + registerProvider
├── auth.ts             # omnirouteApiKeyAuth()、DEFAULT_BASE_URL、URL 校验/规范化
├── auth-credentials.ts # 独立模块：readCredential()、resolveAuthJsonPath()、CredentialShape
test/
├── auth.test.ts        # login/resolve 单元测试
├── auth-credentials.test.ts  # readCredential 边界（缺文件 / 损坏 JSON / 无 omniroute 条目）
├── url.test.ts         # validateAndNormalizeBaseUrl / trim / 默认回退
```

`auth-credentials.ts` 单独成模块便于 mock 与测试；`auth.ts` 不直接做 IO，只暴露 `ApiKeyAuth` 定义与纯函数。

---

## 3. 实现要点

### 3.1 `omnirouteApiKeyAuth()`（src/auth.ts）

```typescript
import type { ApiKeyAuth, AuthPrompt } from "@earendil-works/pi-ai";

export const OMNIROUTE_DEFAULT_BASE_URL = "http://localhost:20128/api/v1";
const MAX_URL_RETRIES = 1;

export function validateAndNormalizeBaseUrl(input: string): string {
  const trimmed = input.trim();
  const fallback = OMNIROUTE_DEFAULT_BASE_URL;
  if (trimmed === "") return fallback;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(`Invalid base URL: ${JSON.stringify(input)}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`base URL must use http(s): got ${url.protocol}`);
  }
  if (!url.hostname) {
    throw new Error(`base URL missing hostname: ${JSON.stringify(input)}`);
  }
  return trimmed;  // 保留用户原样（含尾斜杠），不做路径裁剪
}

async function promptBaseUrlWithRetry(
  interaction: AuthInteraction,
  defaultUrl: string,
): Promise<string> {
  for (let attempt = 0; attempt <= MAX_URL_RETRIES; attempt++) {
    const raw = await interaction.prompt({
      type: "text",
      message: `Enter OmniRoute base URL (default: ${defaultUrl})`,
      placeholder: defaultUrl,
    });
    try {
      return validateAndNormalizeBaseUrl(raw);
    } catch (err) {
      if (attempt === MAX_URL_RETRIES) throw err;
    }
  }
  /* c8 ignore next 2 */
  throw new Error("unreachable");
}

export function omnirouteApiKeyAuth(): ApiKeyAuth {
  return {
    name: "OmniRoute API key",
    login: async (interaction) => {
      const key = await interaction.prompt({
        type: "secret",
        message: "Enter OmniRoute API key",
      });
      const baseUrl = await promptBaseUrlWithRetry(interaction, OMNIROUTE_DEFAULT_BASE_URL);
      return {
        type: "api_key",
        key,
        env: { OMNIROUTE_BASE_URL: baseUrl },
      };
    },
    resolve: async ({ ctx, credential }) => {
      if (credential?.key) {
        const baseUrl = credential.env?.OMNIROUTE_BASE_URL;
        return {
          auth: { apiKey: credential.key, ...(baseUrl ? { baseUrl } : {}) },
          env: credential.env,
          source: "stored credential",
        };
      }
      const envKey = await ctx.env("OMNIROUTE_API_KEY");
      const envBase = await ctx.env("OMNIROUTE_BASE_URL");
      if (envKey) {
        return {
          auth: { apiKey: envKey, ...(envBase ? { baseUrl: envBase } : {}) },
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
- `validateAndNormalizeBaseUrl` 是纯函数，导出以便单测；`trim + 协议 + hostname` 三项校验。
- 尾斜杠、`/v1` 路径**保留**用户原样——`new URL(input).pathname` 可能含 `/api/v1/`，去掉会破坏用户意图。
- `MAX_URL_RETRIES = 1`：第一次无效时再提示一次；第二次仍无效抛错，pi 终止 `/login`。
- `key === ""`（空串）当作未登录走 ambient env 分支；这与 `validateAndNormalizeBaseUrl` 的"空 = 默认"语义不同——`login` 阶段用户输空 key 时 pi 会拒绝（不是 URL 字段，secret prompt 不允许空），但运行时若 `auth.json` 被人手改成 `key: ""` 仍走 ambient 兜底。

### 3.2 `readCredential()`（src/auth-credentials.ts）

```typescript
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

interface StoredCredential {
  type?: string;
  key?: string;
  env?: Record<string, string>;
}

function resolveAuthJsonPath(): string {
  const fromEnv = process.env.PI_AGENT_DIR;
  if (fromEnv) return join(fromEnv, "auth.json");
  return join(homedir(), ".pi", "agent", "auth.json");
}

/** Read omniroute stored credential. Returns undefined if missing/invalid; never throws. */
export function readCredential(): StoredCredential | undefined {
  const path = resolveAuthJsonPath();
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    console.warn(`[omniroute] failed to read auth.json at ${path}: ${(err as Error).message}`);
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.warn(`[omniroute] auth.json at ${path} is malformed JSON: ${(err as Error).message}`);
    return undefined;
  }
  if (!parsed || typeof parsed !== "object") return undefined;
  const cred = (parsed as Record<string, unknown>)["omniroute"];
  if (!cred || typeof cred !== "object") return undefined;
  return cred as StoredCredential;
}

export function resolveStoredBaseUrl(): string | undefined {
  const cred = readCredential();
  if (!cred) return undefined;
  return cred.env?.OMNIROUTE_BASE_URL;
}
```

要点：
- **绝不抛错**——读失败 / JSON 损坏 / omniroute 条目不存在均返回 `undefined`。
- 路径解析：`PI_AGENT_DIR` > `~/.pi/agent/auth.json`。
- `resolveStoredBaseUrl()` 是 `tryRegisterModels` 的便利函数；只关心 baseUrl 不关心 key（key 在请求阶段由 `auth.apiKey.resolve` 解析）。
- 不实现 inotify；`/login` 完成后由 pi 内部 reload credential，扩展下次启动时自然生效。

### 3.3 `tryRegisterModels` 调整（src/index.ts）

```typescript
import { resolveStoredBaseUrl } from "./auth-credentials.js";

export default async function (pi: ExtensionAPI) {
  const storedBaseUrl = resolveStoredBaseUrl();
  const baseUrl = storedBaseUrl ?? process.env.OMNIROUTE_BASE_URL ?? DEFAULT_BASE_URL;

  const provider = createProvider({
    id: "omniroute",
    name: "OmniRoute",
    baseUrl,
    auth: { apiKey: omnirouteApiKeyAuth() },
    models: [],
    api: openAICompletionsApi(),
    async refreshModels({ signal }) {
      // /v1/models 走当前解析的 baseUrl（与 tryRegisterModels 同源）
      const res = await fetch(`${baseUrl}/models`, { signal });
      if (!res.ok) throw new Error(`OmniRoute /models failed: ${res.status}`);
      const { data } = await res.json() as { data: Array<{ id: string }> };
      return data.map(
        (m): ProviderModelConfig => ({ id: m.id, name: m.id, ...MODEL_DEFAULTS }),
      );
    },
  });

  pi.registerProvider(provider);

  await tryRegisterModels(baseUrl, pi);
}
```

要点：
- `baseUrl` 解析顺序：stored `auth.json` > `OMNIROUTE_BASE_URL` env > `DEFAULT_BASE_URL`。
- `createProvider` 的 `baseUrl` 字段是 fallback；当 `auth.apiKey.resolve` 返回 `baseUrl` 时请求级覆盖之。
- `tryRegisterModels(baseUrl, pi)` 沿用现有 5 秒超时 fetch；不变。
- `refreshModels` 复用同一 `baseUrl` 常量；与 `tryRegisterModels` 同源。

### 3.4 静默启动

移除 tasks 4.1 的 "未配置时输出 warning"。`auth.apiKey.resolve` 返回 `undefined` 时 pi 自身的 `--login` 提示足够；扩展不重复 warn。验证场景：

- 无 env、无 auth.json → `tryRegisterModels` warn 一次（OmniRoute 不可达），resolve 返回 `undefined`，pi 提示登录。
- 仅 `OMNIROUTE_API_KEY` → resolve 用 ambient env，正常工作。

---

## 4. 单元测试（test/）

### 4.1 `test/url.test.ts`

覆盖 `validateAndNormalizeBaseUrl`：

| 输入 | 期望输出 / 行为 |
| --- | --- |
| `""` | `OMNIROUTE_DEFAULT_BASE_URL` |
| `"   "` | `OMNIROUTE_DEFAULT_BASE_URL` |
| `"http://localhost:20128/api/v1"` | 原样返回 |
| `"https://router.example.com/api/v1"` | 原样返回 |
| `"https://router.example.com/api/v1/"` | 原样返回（保留尾斜杠） |
| `"  https://x.com  "` | `"https://x.com"` |
| `"localhost:20128"` | 抛 `Invalid base URL` |
| `"ftp://x.com"` | 抛 `must use http(s)` |
| `"http://"` | 抛 `missing hostname` |

### 4.2 `test/auth.test.ts`

mock `interaction` 对象，验证 `omnirouteApiKeyAuth()`：

- **login 成功路径**：mock 返回 `"abc"` / `"https://x.com/api/v1"` → 返回 `{ type: "api_key", key: "abc", env: { OMNIROUTE_BASE_URL: "https://x.com/api/v1" } }`。
- **login 重试**：第一次返回 `"bad"`，第二次返回 `"https://x.com/api/v1"` → 成功（验证 `MAX_URL_RETRIES = 1`）。
- **login 重试用尽**：两次都返回 `"bad"` → 抛 `Invalid base URL`。
- **login 取消**：`interaction.prompt` reject → 错误原样向上抛（不包装）。
- **login 空 baseUrl**：第二次返回 `""` → 落到 `OMNIROUTE_DEFAULT_BASE_URL`。
- **resolve stored**：`credential = { key: "s", env: { OMNIROUTE_BASE_URL: "https://s/api/v1" } }` → `{ auth: { apiKey: "s", baseUrl: "https://s/api/v1" }, source: "stored credential" }`。
- **resolve stored 仅 key**：`credential = { key: "s" }` → `{ auth: { apiKey: "s" } }`（无 baseUrl 字段）。
- **resolve ambient env**：`credential = undefined`，`OMNIROUTE_API_KEY = "e"`，`OMNIROUTE_BASE_URL = "https://e/api/v1"` → `{ auth: { apiKey: "e", baseUrl: "https://e/api/v1" }, env: { OMNIROUTE_BASE_URL: "https://e/api/v1" }, source: "OMNIROUTE_API_KEY" }`。
- **resolve ambient 仅 key**：`credential = undefined`，仅 `OMNIROUTE_API_KEY` → `env` 字段为 `undefined`。
- **resolve 无 key**：`credential = undefined`，无 env → `undefined`。
- **resolve stored 优先**：stored + env 都设置 → 用 stored；忽略 env。

mock `ctx.env(name)`：

- `ctx.env` 调两次（key + baseUrl）顺序：实现先调 `OMNIROUTE_API_KEY` 再 `OMNIROUTE_BASE_URL`；测试断言调序。
- `ctx.env` 对未知名返回 `undefined`（不抛错）。

### 4.3 `test/auth-credentials.test.ts`

mock `node:fs` 的 `readFileSync`：

- 文件不存在（ENOENT）→ 返回 `undefined`，不 warn（首次启动常见）。
- 文件存在但内容非 JSON → 返 `undefined`，warn 一次。
- 文件存在且 JSON，但无 `omniroute` 键 → 返 `undefined`。
- `omniroute` 存在但无 `env` → `cred.env?.OMNIROUTE_BASE_URL` → `undefined`。
- `omniroute.env.OMNIROUTE_BASE_URL = "https://x/api/v1"` → 返该值。
- `PI_AGENT_DIR` 设置时路径走环境变量；未设置时走 `~/.pi/agent/auth.json`。

### 4.4 测试运行

`package.json`：

```json
{
  "scripts": {
    "test": "node --test --experimental-strip-types test/",
    "typecheck": "tsc --noEmit"
  }
}
```

依赖：仅 Node ≥ 22（`--experimental-strip-types` 原生 TS 运行）。不引入 vitest / jest，保持依赖最小。

---

## 5. 边界条件与陷阱

### 5.1 `interaction.prompt` 行为未文档化

`AuthPrompt` schema（pi-ai `auth/types.d.ts`）：
- `type: "secret"` 隐藏输入；通常映射到控制台不回显或 UI 密码框。
- `type: "text"` 自由输入；可空（用户按 Enter）。
- 错误语义：cancel / abort 走 `signal` 或 reject 抛出；实现**不**捕获，由调用者处理。

陷阱：若用户 baseUrl 留空 → `validateAndNormalizeBaseUrl` 走默认；语义上等价于"我不想覆盖 baseUrl"。注意 secret prompt 空 key 通常 pi 拒绝（未验证），本扩展不主动校验 key 非空——交给 pi。

### 5.2 `auth.json` 写时序

`/login` 完成后 pi 内部异步把 credential 写到 `auth.json`。扩展启动期 `readCredential()` 仅读一次——若用户在 Pi 启动前手动编辑 `auth.json`，扩展会读到最新值；若用户在 Pi 运行期 `/login`，下次启动才生效（这是 D2 选型）。

### 5.3 `baseUrl` 路径语义

`/v1/models` 拼在用户输入的 baseUrl 之后：用户输入 `https://router.example.com/api/v1` → 请求 `https://router.example.com/api/v1/v1/models`（错误！）。**当前实现不裁剪 `/v1`，因用户可能配 `https://router.example.com`（无 v1 段），自动拼接 `/v1` 是设计选择。**

但 `createProvider` 的 `baseUrl` 字段在 `openai-completions` API 实现里会拼 `/chat/completions`，**不会**自动拼 `/v1`。验证：

- `OPENAI` 内置 `baseUrl = "https://api.openai.com/v1"` + `openai-completions` → `https://api.openai.com/v1/chat/completions`。
- 用户 `https://router.example.com/api/v1` + `openai-completions` → `https://router.example.com/api/v1/chat/completions` ✓
- 用户 `https://router.example.com` + `openai-completions` → `https://router.example.com/chat/completions`（404，OmniRoute 要求 `/api/v1/chat/completions`）。

**所以默认 baseUrl 必须含 `/api/v1`**；用户改 baseUrl 时若漏掉 `/api/v1`，请求 404。`refreshModels` / `tryRegisterModels` 拼 `/models` 同理。设计选择：**在 `validateAndNormalizeBaseUrl` 末尾加一次警告**（非错误）：若 baseUrl 不以 `/v1` 或 `/v1/` 结尾，输出 `console.warn('[omniroute] base URL does not end with /v1 — chat calls may 404')`。不强制追加 `/v1`，避免破坏用户有意为之的代理布局。

### 5.4 `createProvider` 类型推断

`createProvider({...})` 是泛型 `createProvider<TApi>(...)`；`openai-completions` 须作为 `api` 字段的字符串字面量。验证：

```typescript
import { openAICompletionsApi } from "@earendil-works/pi-ai";
// openAICompletionsApi() 返回值需满足 Api 类型；typeof check 如下：
const api = openAICompletionsApi();
provider = createProvider({ api, ... });  // 编译期推断 TApi
```

若 `openAICompletionsApi` 不存在（API 路径变更），降级为 `api: "openai-completions" as const`。`tsc --noEmit` 在 CI 阶段发现。

### 5.5 `ProviderModelConfig` 类型

Phase 1 用的 `Omit<ProviderModelConfig, "id" | "name">` 来自 `@earendil-works/pi-coding-agent`；`createProvider` 来自 `@earendil-works/pi-ai`。两者导出同名但不同类型——`refreshModels` 回调签名在 `createProvider` 上下文里返回 `ProviderModelConfig[]`（来自 pi-ai）。Phase 1 import 路径保持不变即可。

### 5.6 `tryRegisterModels` 重复注册

Phase 1 实现：在 `pi.registerProvider` 之后**再**调 `tryRegisterModels`；后者在 `try` 成功后**再**调 `pi.registerProvider` 替换 models 列表。

D3 调整后：`pi.registerProvider(provider)` 用的是完整 `createProvider` 对象（不是 legacy form）。再调 `pi.registerProvider(provider, { models })` 替换 models 仍合法（pi 接受 `Partial<ProviderConfig>` 覆盖）；但需验证：legacy form 行为是覆盖 `models` 字段；`createProvider` 形式是否同样？——`pi.registerProvider(provider, partial)` API 在扩展上下文里**未文档化**接受 partial 覆盖；建议改为：在 `tryRegisterModels` 内部用 `pi.registerProvider(provider.id, { models })` 重新注册（legacy form 用于覆盖 models）。

**降级方案**：删除 `tryRegisterModels` 的"成功后再注册"分支，改为 `await tryRegisterModels()` 仅打日志；让 `pi update --models` 走 `refreshModels` 触发模型发现。Phase 1 既有行为可能因此改变——需要在 tasks 阶段评估。

### 5.7 `OMNIROUTE_BASE_URL` 与 credential env 同名冲突

`credential.env.OMNIROUTE_BASE_URL`（持久化）与 `process.env.OMNIROUTE_BASE_URL`（ambient）同名但语义不同。设计：

- `credential.env.OMNIROUTE_BASE_URL` **不**回写到 `process.env`（避免污染进程环境）。
- `auth.apiKey.resolve` 内部先看 stored（`credential.env.OMNIROUTE_BASE_URL`），未命中再看 ambient（`ctx.env("OMNIROUTE_BASE_URL")`）。
- 文档明确：用户选择 `/login` 后，ambient env 失去作用——这是设计意图而非 bug。

---

## 6. 风险与缓解

| 风险 | 概率 | 缓解 |
| --- | --- | --- |
| `interaction.prompt` 行为在不同 pi 客户端（TUI / RPC / Web）表现差异 | 中 | URL 校验做服务端兜底；不依赖客户端特殊能力 |
| `auth.json` 写延迟导致启动后立即 `readCredential()` 读到旧值 | 低 | `readCredential()` 仅用于 startup 阶段，credential 变更由 pi 内部重载 |
| 用户输入 baseUrl 拼错导致聊天 404 | 中 | `validateAndNormalizeBaseUrl` 强制 http(s) + hostname；额外 warning 提示缺 `/v1` |
| `createProvider` / `openAICompletionsApi` import 路径错误 | 低 | `tsc --noEmit` 在 CI 阻断；fallback 到 `api: "openai-completions" as const` |
| 单元测试覆盖不到 `interaction` 真实行为 | 中 | mock 充分；`@earendil-works/pi-ai` 自身有 provider-level 测试做契约保障 |
| 5.6 `tryRegisterModels` 重复注册失效 | 中 | 在 `superpower-plan` 阶段显式选择降级方案（删除二次注册或修复 `pi.registerProvider` 调用） |
| `readCredential` 同步 IO 阻塞启动 | 低 | `auth.json` 通常 < 10KB；同步读 < 1ms；不引入 async fs |

---

## 7. 与 OpenSpec 需求的对应

| 需求 (spec.md) | 实现位置 |
| --- | --- |
| `/login omniroute` 收集 API key | `auth.ts` `login` 回调第一段 |
| `/login omniroute` 收集 baseUrl | `auth.ts` `login` 回调第二段 + `validateAndNormalizeBaseUrl` |
| `resolve()` 优先级为 stored credential | `auth.ts` `resolve` 回调 |
| baseUrl 持久化与可更新 | 由 pi 内部 `CredentialStore.modify` 处理；扩展无侵入代码 |
| 扩展启动不影响 ambient env 用户 | `auth-credentials.ts` `readCredential` 不抛错；`auth.ts` `resolve` 兜底 |
| 扩展使用 `createProvider()` 形式 | `index.ts` `createProvider({...})` + `pi.registerProvider(provider)` |

OpenSpec 需求未变；本文档仅在实现层面做了细化（URL 校验、错误处理、测试拆分、模块边界），未引入新功能或放宽约束。

---

## 8. 待办（移交 `superpower-plan`）

- 决定 5.6 降级方案（删除二次注册 vs 修复 `pi.registerProvider` partial 覆盖）
- 决定 5.3 `/v1` 警告文案与触发条件（warning vs info）
- 验证 `interaction.prompt({ type: "secret" })` 在空 key 时的行为（pi 是否拒绝）
- 确认 `@earendil-works/pi-ai` 0.83.0 是否导出 `openAICompletionsApi`（已查 dist/api/openai-completions.lazy.d.ts 存在；待 plan 阶段确认 export 路径）

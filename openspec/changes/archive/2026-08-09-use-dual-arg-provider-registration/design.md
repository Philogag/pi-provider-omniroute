# use-dual-arg-provider-registration — Design

## Context（上下文）

扩展当前用**单参数** `pi.registerProvider(provider: Provider<"openai-completions">)` 注册，该形式在 pi 走 `registerNativeProvider`，**omp 完全不支持**（无 `registerNativeProvider`，单参数对象注册实测崩溃 `_.streamSimple` undefined）。本次改造为双参数 `pi.registerProvider("omniroute", config)`，pi 与 omp 均实现该签名。

**双参数契约差异（已从源码核实）**：

| 字段 | pi（provider-composer.d.ts:14 ProviderConfigInput） | omp（extensions/types.ts:1394 ProviderConfig） |
|---|---|---|
| `baseUrl?` | ✓ 静态 | ✓ 静态 |
| `apiKey?` | string；undefined→stored credential；`${ENV}` 引用 | string；undefined→?（需实测）；env 引用行为未核实 |
| `api?` | 必填（当有 streamSimple） | 必填（当有 streamSimple） |
| `streamSimple?` | 返回 AssistantMessageEventStream | 同 pi |
| `headers?` | ✓ | ✓ |
| `authHeader?` | boolean（Bearer） | boolean（Bearer） |
| `models?` | `{id,name,api?,baseUrl?,reasoning,thinkingLevelMap?,input,cost,contextWindow,maxTokens,headers?,compat?}` | `{id,name,api?,reasoning,thinking?,input,cost,premiumMultiplier?,contextWindow,maxTokens,headers?,compat?}` |
| 动态模型 | `refreshModels(context)` | `fetchDynamicModels(apiKey)`（SQLite 24h 缓存，与 models 互斥） |
| oauth? | ExtensionOAuthConfig | 兼容（login 返回 OAuthCredentials\|string） |

**当前实现的迁移映射**（src/index.ts）：
- `provider.id/name/baseUrl` → `config.baseUrl`（静态）+ name 字段（pi 有 name，omp ProviderConfig 无 name——忽略，omp 用注册名）
- `auth: { apiKey: omnirouteApiKeyAuth() }`（自定义 login：提示 key+baseUrl 持久化到 credential.env；resolve：credential→env→undefined）→ **简化**：`apiKey` 省略（undefined → stored credential）——双参数无 auth 对象能力，接受 baseUrl 动态覆盖丢失（baseUrl 改为启动时静态解析：omniroute.json ?? env ?? default）
- `getModels/refreshModels({signal})` → **静态 models 列表**：启动时 fetch `${baseUrl}/models` 一次，`toOmnirouteModel` 映射为 ProviderModelConfig[]（不含 omp 的 thinking/premiumMultiplier，不含 pi 的 thinkingLevelMap——两宿主均有 reasoning/input/cost/contextWindow/maxTokens）
- `stream/streamSimple` 双实现 → **仅 streamSimple**（双参数只有它；pi composeModelProvider 在 `model.api === extension.api` 时用 extension.streamSimple 接管，内置 api 名 "openai-completions" 亦被接管）；遥测包装 `withOmnirouteFetch` + `wrapStreamWithCost` **原样保留**
- `provider.getModels` 引用 → 移除（models 静态化）

## Goals / Non-Goals（目标 / 非目标）

**Goals**：
- 注册形式双参数化，pi 与 omp 均可加载、注册、调用
- 遥测诊断能力（usage-cost-telemetry）行为不变
- 静态 models 列表内容与当前 refreshModels 拉取结果等价（id/name/reasoning/input/cost/contextWindow/maxTokens）
- 标准 Pi 上注册后行为回归（含 /login 存储的 key 仍可用）

**Non-Goals**：
- 保留自定义 baseUrl login 提示（baseUrl 静态化）
- 按宿主分派动态 models（refreshModels vs fetchDynamicModels 双签名）——统一静态列表
- 新增 omp 专属能力（thinking/premiumMultiplier 等字段）
- omp 安装冒烟（用户侧人工验证，见任务）

## Decisions（决策）

### D1 — 双参数注册（自定义 api 名）
`pi.registerProvider("omniroute", { baseUrl, api: "omniroute", streamSimple, models })`。
- **关键约束（已从两侧源码核实）**：omp 的 `assertCustomApiName`（api-registry.ts:44）**禁止用内置 API 名注册自定义 API**（"openai-completions" 会被拒）；pi 的 `Api = KnownApi | (string & {})`（types.d.ts:15）允许任意自定义名。因此 `api` **必须用自定义名 "omniroute"**，models 每项 `api` 同值（pi streamWith 在 `model.api === extension.api` 时用 extension.streamSimple 接管；omp `getCustomApi(model.api)` 命中注册）。
- 备选：a) 内置名 "openai-completions"——**否决**：omp 直接拒绝；b) 双路径宿主探测——否决：omp 压缩后 registerNativeProvider 恒 undefined 不可靠；c) api 名不一致——否决：pi 不接管 streamSimple，遥测丢失
- **理由**：双参数是两宿主唯一交集，代码单一；自定义 api 名两宿主均自洽

### D2 — apiKey 裸名
`apiKey`：**省略**（config 中无此字段）。
- **关键约束（已从两侧源码核实）**：pi 的 apiKey 解析（provider-composer.js resolveConfigValueOrThrow）认 `${ENV}` 花括号引用，**裸名当字面量 key**；omp 的 `resolveConfigValue`（resolve-config-value.ts:21）对**裸名**先 `$envExact(env)` 再字面量，`${}` 花括号当字面量——两宿主语法互斥，**唯一交集是 `apiKey: undefined`**（stored credential，两宿主均支持 `/login`；pi composeApiKeyAuth 在 rawKey undefined 时走 stored credential resolve/check）
- 备选：保留 omnirouteApiKeyAuth 自定义 login——**否决**：双参数无 auth 对象字段，pi 的 composeApiKeyAuth 只用 `extension?.apiKey ?? config?.apiKey` 字符串
- **理由**：两宿主最小交集；/login 标准流程仍可存 key（pi stored credential）
- **风险**：baseUrl 不再随 login 持久化（R2，已由 omniroute.json + settings 菜单缓解）；omp 的 stored credential 机制未验证（R4）

### D3 — 静态 models
启动时 `await fetch(\`${baseUrl}/models\`)` 拉取 → 失败时降级（空列表 + console.warn，不阻断注册）→ `toOmnirouteModel` 映射为静态数组。
- 备选：refreshModels(context)（pi-only）+ fetchDynamicModels(apiKey)（omp-only）双签名分派——**否决**：两签名行为/缓存语义不对称（omp 24h SQLite 缓存），且 /models 仅启动拉一次与当前 refreshModels 行为等价
- **理由**：两宿主同契约；模型列表静态化后与当前行为等价（当前 refreshModels 也仅显式调用时拉取）
- **风险**：启动多一次网络请求（失败降级）；扩展加载变 async（omp 支持 async ExtensionFactory）

### D4 — 仅 streamSimple
删除 `stream` 字段，仅保留 `streamSimple`（含遥测包装）。
- 备选：同时提供两者（pi 支持）——**否决**：omp 无 stream 字段概念，双参数下 pi 也只用 streamSimple 接管
- **理由**：最小契约

### D5 — 测试 mock 双参数注册
新增测试：mock pi 的 `registerProvider(name, config)` 捕获调用，断言 `name === "omniroute"`、`config.api === "omniroute"`、`config.streamSimple` 存在且调用返回流、`config.models` 数组字段完整（reasoning/input/cost/contextWindow/maxTokens）、遥测包装生效（fetch mock 返回含遥测 SSE）、config 无 `apiKey` 字段。
- 现有 auth/tools 测试回归

## Risks / Trade-offs（风险与权衡）

- **[R1] 遥测回归** → 缓解：streamSimple 包装原样保留 + 现有 usage-telemetry 测试回归
- **[R2] baseUrl 动态覆盖丢失**（原 auth.resolve 可返回 auth.baseUrl 覆盖 model.baseUrl）→ 缓解：baseUrl 启动时静态解析（resolveStoredBaseUrl 仍读 stored；行为差异：login 后改 baseUrl 不再影响已加载 provider，需重启）
- **[R3] /models 拉取失败** → 缓解：降级空列表 + warn，注册不阻断（与当前 refreshModels throw 行为不同——当前无 key 时 /models 401 会 throw；新行为静默降级更友好）
- **[R4] omp stored credential 未验证** → 缓解：omp 实测（人工验证步骤）；若 omp 无 stored 机制则依赖 env 引用或显式 apiKey
- **[R5] models 静态化后 /models 变化需重启** → 接受（与当前 refreshModels 启动拉一次等价）

## Migration Plan（迁移计划）

1. 修改 `src/index.ts` 注册块：provider 对象 → ProviderConfigInput（D1-D4）
2. 修改 `src/auth.ts`：评估 omnirouteApiKeyAuth 是否仍被引用（/login 路径由 pi 内置处理则移除或保留导出）；resolveStoredBaseUrl 保留
3. 新增/更新测试（D5）
4. 回归：npm test + typecheck + 手动 pi 冒烟（/login + 聊天 + 遥测诊断）
5. omp 安装冒烟（用户侧人工验证）

## Open Questions（开放问题）

- omp 对 `apiKey: "${ENV}"` 引用的解析行为？（实测）
- omp 是否有 stored credential（/login 持久化）机制？（实测）
- 移除 `omnirouteApiKeyAuth` 后 `test/auth.test.ts` 的既有断言如何处理（该测试 mock 了 auth 对象方法）

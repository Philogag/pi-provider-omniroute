# use-dual-arg-provider-registration — Superpower Design

## 目标

将扩展注册从单参数 `pi.registerProvider(provider)` 改造为双参数 `pi.registerProvider("omniroute", config)`，使扩展同时兼容 pi 与 oh-my-pi（omp）两种宿主。双参数是两宿主唯一交集（omp 无 `registerNativeProvider`，单参数实测崩溃）。保留遥测诊断（usage-cost-telemetry）能力不变。

## 架构（4+1 层）

### 1. 注册层（src/index.ts 注册块重写）

```ts
// 现：pi.registerProvider(provider)  ← 单参数对象（含 auth/getModels/refreshModels/stream/streamSimple）
// 新：pi.registerProvider("omniroute", {
//   baseUrl: resolveBaseUrlStatic(),        // omniroute.json → env → default（见层 2）
//   api: "omniroute",                        // 自定义 api 名（见 D-API）
//   streamSimple: (model, ctx, opts) => wrapStreamWithCost(   // 遥测包装原样保留
//     streamSimple(model, ctx, { ...opts, fetch: withOmnirouteFetch(fetch, t => { telemetry = t; }) }),
//     () => telemetry,
//   ),
//   models: await loadStaticModels(baseUrl), // 启动时 /models 一次（见层 3）
// })
```

删除字段：`auth`（对象）、`getModels`、`refreshModels`、`stream`（仅保留 streamSimple）。
保留字段：`baseUrl`、`streamSimple`（遥测包装不变）。
新增字段：`api`（自定义名 "omniroute"）、`models`（静态数组）。

### 2. 配置层（omniroute.json baseUrl 持久化）

**决策（用户确认）**：login 流程无法拦截（pi 内置），baseUrl 存到扩展自己的配置文件。

- `readOmnirouteConfig` 返回类型扩展：`{ baseUrl?: string; search?: { provider?: string }; fetch?: { provider?: string } }`
- `writeOmnirouteConfig(partial)` 支持写入 `baseUrl`
- 新增 `resolveOmnirouteBaseUrl()`：`omniroute.json.baseUrl` → `process.env.OMNIROUTE_BASE_URL` → `OMNIROUTE_DEFAULT_BASE_URL`
- `/omniroute-settings` 顶层菜单新增 **baseUrl 设置项**（Text 输入，validateAndNormalizeBaseUrl 校验后写入 omniroute.json）
- `resolveStoredBaseUrl()`（auth-credentials.ts 读 auth.json env）**废弃**——不再从 credential 读 baseUrl（双参数 credential 只存 key）

### 3. 模型层（静态 models）

- 启动时 `await fetch(\`${baseUrl}/models\`)` 拉一次，映射为静态 `ProviderModelConfig[]`
- 映射：`toOmnirouteModel(m, baseUrl)` 复用（id/name/reasoning/input/cost/contextWindow/maxTokens + `api: "omniroute"`）
- **失败降级**：空列表 + `console.warn`，注册不阻断（不抛）
- 删除 `getModels` 闭包 + `refreshModels({signal})`

### 4. 状态机层（/omniroute-settings 扩展）

- `createMenuStateMachine` 状态：`"top" | "sub-search" | "sub-fetch" | "sub-base-url"`（新增 sub-base-url）
- `renderBaseUrlSubmenu`：官方 Pattern 1（DynamicBorder + Text 标题 + 单项 SelectList（当前值）+ keyHint）——与 sub-search/sub-fetch 同构；SelectItem `{ value: baseUrl, label: 当前值 }`
- 顶层菜单项：`▶ Search provider` / `▶ Web Fetch provider` / `▶ Base URL`（三行）
- `onCommitBaseUrlPersist(value)`：校验（validateAndNormalizeBaseUrl）+ 写 omniroute.json
- 顶层 baseUrl 预览：`baseUrl` 当前值（截断显示）

### 5. 测试层

新增/修改：
- `test/register-dual-arg.test.ts`（新）：mock `pi.registerProvider(name, config)`，断言 name==="omniroute"、config.api==="omniroute"、config.models 字段完整（reasoning/input/cost/contextWindow/maxTokens）、models 失败降级（空数组 + warn 不抛）
- `test/search-config.test.ts`（增）：baseUrl 读写 round-trip、损坏形状 warn、`resolveOmnirouteBaseUrl` 优先级（omniroute.json → env → default）
- `test/search-config-toplevel.test.ts`（增）：顶层含 Base URL 行、Enter 分发到 sub-base-url
- `test/search-config-state-machine.test.ts`（增）：sub-base-url 模式、onCommitBaseUrlPersist 调用、缓存失效
- `test/auth-credentials.test.ts`（改）：`resolveStoredBaseUrl` 删除后移除相关断言
- 既有遥测/streamSimple 测试回归（mock fetch 注入不变）

## 关键决策

### D-API — 自定义 api 名 "omniroute"
- **发现**：omp `assertCustomApiName`（api-registry.ts:44）**禁止内置名注册自定义 API**（"openai-completions" 会被拒）；pi `Api = KnownApi | (string & {})` 允许任意自定义名
- 选 `api: "omniroute"`：omp `registerCustomApi("omniroute", ...)` 通过 ✓；pi `streamWith` 在 `model.api === extension.api` 时用 extension.streamSimple 接管 ✓
- models 每项 `api: "omniroute"`（与 config.api 一致，pi 匹配 + omp getCustomApi 命中）
- 否决：内置名（omp 拒）、api 名不一致（pi 不接管 → 遥测丢失）

### D-APIKEY — apiKey 字段
- **发现**：语法不兼容——pi 用 `${ENV}` 花括号引用（resolveConfigValueOrThrow）；omp `resolveConfigValue` 对**裸名**先 `$envExact(env)` 再字面量（`${OMNIROUTE_API_KEY}` 会被 omp 当字面量 key 用，错误！）
- **决策**：`apiKey: "OMNIROUTE_API_KEY"`（裸名）——omp 语义：先查 env `OMNIROUTE_API_KEY`，存在即用；pi 语义：裸名非 `${}` 格式，`getConfigValueEnvVarNames` 提取不到 env 名 → 当字面量 key？**需实现期实测确认**（见开放问题 O1）；若 pi 不认裸名，备选 `apiKey: undefined`（stored credential，两宿主均支持 /login）
- 删除 `omnirouteApiKeyAuth()` 自定义 auth 对象（pi 双参数无 auth 字段；omp 无）

### D-BASEURL — baseUrl 静态化 + 配置文件持久化
- 决策（用户确认）：baseUrl 静态解析：`omniroute.json.baseUrl` → env → default
- `/omniroute-settings` 顶层菜单加 Base URL 项（Text 输入，校验后写 omniroute.json）
- `resolveStoredBaseUrl`（auth.json env）废弃

### D-MODELS — 静态 models + 失败降级
- 启动拉一次 `/models`；失败空列表 + warn 不抛（现 refreshModels 失败 throw——新行为更友好）
- 删除 getModels/refreshModels 动态路径

### D-TEST — mock 双参数注册
- 新测试 mock `registerProvider(name, config)` 捕获断言
- 不模拟 omp 二进制（omp 冒烟为人工验证任务）

## 风险

- **[R1] apiKey 语法两宿主不兼容**（pi `${ENV}` vs omp 裸名）→ 缓解：O1 实测确定最终值（裸名或 undefined）；omp 人工冒烟验证
- **[R2] baseUrl 静态化**：login 不再持久化 baseUrl → 缓解：omniroute.json + settings 菜单提供同等能力（用户确认）
- **[R3] 启动 /models 请求**：无 key 时 401 → 缓解：失败降级空列表 + warn，不阻断注册（与现 throw 行为不同，更友好）
- **[R4] omp stored credential / `${ENV}` 行为未实测** → 缓解：O1 实测 + 任务含 omp 冒烟
- **[R5] 状态机扩展**：sub-base-url 新增破坏既有缓存逻辑 → 缓解：cachedSearchSubmenu/cachedFetchSubmenu 模式复用 + cachedBaseUrlSubmenu；失效路径完整

## 开放问题（已解决）

- **O1 ✅**：两宿主 apiKey 语法互斥（pi 认 `${}` 引用、裸名当字面量；omp 裸名先查 env、`${}` 当字面量）→ 交集 = `apiKey: undefined`（stored credential，已实现并验证 pi composeApiKeyAuth 在 rawKey undefined 时走 stored credential）
- **O2 ✅**：pi-tui 有 `Input` 组件（new Input()/setValue/onSubmit/onEscape/getValue/handleInput），Base URL 项用它（已实现）
- **O3 ✅**：resolveStoredBaseUrl 删除，auth-credentials.test.ts 移除对应 2 断言（已实现）

# use-dual-arg-provider-registration — Proposal

## 为什么（Why）

当前扩展用**单参数** `pi.registerProvider(provider: Provider)` 注册 OmniRoute provider。该形式只有 pi 支持（内部走 `registerNativeProvider`），**omp 只实现双参数** `registerProvider(providerName: string, config: ProviderConfigInput)` 且**没有** `registerNativeProvider`——单参数对象注册在 omp 上直接崩溃（`undefined is not an object (evaluating '_.streamSimple')`，实测 min-ext 系列）。

要同时兼容 pi 与 omp，必须改为双参数注册：`pi.registerProvider("omniroute", { baseUrl, apiKey, api, streamSimple, models, ... })`。

## 做什么（What）

1. **注册形式**：`src/index.ts` 从 `pi.registerProvider(provider)`（单参数 Provider 对象，含 `auth`/`getModels`/`refreshModels`/`stream`/`streamSimple` 字段）改为 `pi.registerProvider("omniroute", providerConfig)`，其中 `providerConfig: ProviderConfigInput` 字段：
   - `baseUrl`（解析后的静态值）、`api`（`"openai-completions"`）、`streamSimple`（保留遥测包装）、`models`（静态或动态）
   - **`apiKey` 处理**：pi 双参数 `apiKey?: string` 支持 `undefined`（走 stored credential）或 env 名引用；omp 同样 `apiKey?: string`。两者都无 `auth: { apiKey: ApiKeyAuth }` 对象形式——**`omnirouteApiKeyAuth()` 的自定义 login/resolve（含 baseUrl 持久化）无法直接迁移**，需评估：a) 保留自定义 auth 是否可行（检查 pi 是否允许 extension 提供 auth 以外的机制）；b) 或降级为 apiKey 字符串 + env，接受 baseUrl 动态解析能力变化
2. **模型提供**：从 `getModels` + `refreshModels({signal})`（pi 单参数形式）改为 `models: ProviderModelConfig[]`（静态，可含 `reasoning`/`thinking`/`input`/`cost`/`contextWindow`/`maxTokens`/`compat`/`headers`）；pi 双参数额外支持 `refreshModels(context)`，omp 额外支持 `fetchDynamicModels(apiKey)`——**两函数签名不同且互斥**，需决策（静态 models 列表最稳，但牺牲 /models 动态刷新；或按宿主分派）
3. **遥测保持**：`streamSimple` 内的 `withOmnirouteFetch` + `wrapStreamWithCost` 包装**必须原样保留**（usage-cost-telemetry 是已交付能力）
4. **行为等价**：在标准 Pi 上注册后的 provider 行为（model 列表、streamSimple 调用、遥测诊断）与当前单参数版本一致；在 omp 上可安装、注册、调用

## Capabilities（能力）

- 修改 `omp-compat`（扩展在两种宿主上可加载工作——注册表单是 omp 加载失败的最后一段）
- 无新增 capability

## Impact（影响）

- `src/index.ts`（注册块重写）
- `src/auth.ts`（可能：`omnirouteApiKeyAuth` 迁移/降级）
- 测试：`test/auth.test.ts` 等（auth 行为变化）、新增注册形式测试
- **禁改文件约束重评估**：`test/tools-*.test.ts` 等既有约束可能需调整
- 无新依赖

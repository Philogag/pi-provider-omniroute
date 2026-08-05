## 上下文

`src/index.ts` 目前在两个时机调用 `fetch('${baseUrl}/models')`：

1. **`refreshModels({ signal })`** — pi 在 `pi update --models` 时调用，标准且必要。
2. **`tryRegisterModels(baseUrl, onModels)`** — 在 `pi.registerProvider(provider)` 后立即 `await`，带 5 秒 `AbortController` 超时；失败时 `console.warn(...)` 静默兜底，不抛出。

第二条的问题：
- **启动期阻塞 / 噪声**：即便用户本次会话根本不用 omniroute，扩展加载时也会发起一次网络请求；不可达时还要等 5 秒才能进入下一行。
- **重复拉取**：pi 的 ModelRuntime 在用户首次需要模型列表时（切换 provider、调用 `/models`）会再次触发 `refreshModels()`，导致同一次会话内对 `/models` 的多次调用。
- **静默失败掩盖问题**：通过 `console.warn` 兜底，错误从未进入 pi 的标准错误通道，用户感知不到根因。

`@earendil-works/pi-ai` 的 `Provider` 接口已经定义了按需拉取的契约：
- `getModels()` 返回当前缓存的 `Model[]`
- 当 pi 决定"需要最新模型列表"时（例如 ModelRuntime 启动、用户调用 `refreshModels()`），会调用 `refreshModels({ signal })`

由于 pi 在 ModelRuntime 真正用到 provider 之前不需要模型列表，扩展**没有**义务在 `registerProvider` 之后立刻预热缓存。

## 目标 / 非目标

**目标：**
- 扩展加载时**不**主动调用 `/models`；模型列表仅在 pi ModelRuntime 真正需要时通过 `refreshModels` 按需拉取
- 保留 `refreshModels({ signal })` 作为唯一的模型拉取入口，行为不变
- 首次拉取失败时，错误通过 pi 标准错误通道冒泡（不再静默 `console.warn`）
- 现有 `/login omniroute` 流程、auth 流程、ambient env 兜底均不受影响

**非目标：**
- 不修改 `refreshModels` 的内部实现（fetch 路径、解析逻辑保持原样）
- 不修改 provider 协议层（OmniRoute 的 OpenAI 兼容 API 不变）
- 不引入新的缓存失效策略（依赖 pi 的 ModelRuntime 自身调度）
- 不为 `/models` 拉取添加本地持久化缓存（保持内存数组即可）

## 决策

### D1: 移除 `tryRegisterModels` 的自动调用

将 `src/index.ts` 中：

```typescript
pi.registerProvider(provider);
await tryRegisterModels(baseUrl, (fresh) => { models = fresh; });
```

改为：

```typescript
pi.registerProvider(provider);
```

理由：`refreshModels` 已经是 pi ModelRuntime 的标准入口。当 pi 真正需要模型列表时（首次枚举 provider、调用 `refreshModels`、调用 `/models` 命令），会触发 `refreshModels({ signal })`。启动期没有理由提前拉取。

> 替代方案 A：保留 `tryRegisterModels` 但改为 fire-and-forget（不 `await`）。否决：仍然产生不必要的网络请求与日志噪声，违背"按需"目标。
>
> 替代方案 B：把 `tryRegisterModels` 改为 `refreshModels` 的实现，provider 暴露唯一的 `refreshModels`。否决：`refreshModels` 已经实现了相同的拉取逻辑，重复实现违反 DRY；直接删除即可。

### D2: `getModels()` 保持简单

```typescript
let models: OmnirouteModel[] = [];

const provider: Provider<"openai-completions"> = {
  ...
  getModels: () => models,
  refreshModels: async ({ signal }) => { ... },
  ...
};
```

`getModels()` 始终返回当前 `models` 数组。pi 看到空数组时，会按需调用 `refreshModels` 填充；调用后再读 `getModels` 即可拿到结果。

> 替代方案：`getModels` 返回 `undefined` 当 `models.length === 0`。否决：破坏 pi 对 `Model[]` 类型的契约（`getModels: () => Model[]`），且不会让 pi 行为变化——pi 仍会自己调度 `refreshModels`。

### D3: 失败错误冒泡，不静默

移除 `tryRegisterModels` 中的 `console.warn(...)` 兜底。如果未来 `refreshModels` 失败（用户主动触发），错误会通过 pi 的 `Promise.reject` 通道冒泡，由 pi 渲染给用户。

> 替代方案：保留 `console.warn` 作为可选的 `refreshModels` 容错。否决：与"按需"目标冲突——拉取失败应该被用户感知，而不是被日志吞掉。

### D4: 现有 `refreshModels` 不变

`refreshModels({ signal })` 内部 `fetch('${baseUrl}/models')` 的实现保持原样：
- 仍然使用 `createProvider` 时记录的 `baseUrl`（来自 `resolveStoredBaseUrl() ?? process.env.OMNIROUTE_BASE_URL ?? DEFAULT`）
- 仍然将 `data[]` 映射为 `OmnirouteModel[]`
- 仍然在 `!res.ok` 时 `throw new Error(...)`

只是**调用时机**从"扩展加载"推迟到"pi ModelRuntime 需要时"。

## 风险 / 权衡

| 风险 | 缓解措施 |
| --- | --- |
| 首次切换到 omniroute 模型时多一次 `/models` 往返 | 用户感知：列表加载有短暂等待；后续命中内存缓存。这是按需的代价 |
| `refreshModels` 失败时不再有 `console.warn` 兜底 | pi 的标准错误 UI 会渲染错误；用户能看到根因（不可达 / 401） |
| 旧用户依赖"启动期自动拉取来检测服务可用性" | 启动期不再检测是设计意图；用户首次使用 omniroute 时再检测；如需预检，手动 `pi update --models` 即可 |
| 移除 `tryRegisterModels` 后 `models` 变量可能在未拉取前被读取 | pi 的 ModelRuntime 已经处理 `getModels() → []` 的情况，会触发 `refreshModels`；不需要扩展手动调度 |
| `src/index.ts` 中 `let models` 与 `provider.getModels` 闭包引用 | 不变；保持模块级单例数组 |

## 迁移计划

- **破坏性变更**：无。外部行为（`/login`、`/models` 命令、聊天调用、ambient env 兜底）完全保留；只是启动期日志中少了一行 `[omniroute] OmniRoute unavailable at ...` 的潜在噪音。
- **部署步骤**：
  1. 修改 `src/index.ts` —— 删除 `tryRegisterModels` 调用与函数体
  2. 不需要新测试 —— 现有测试仅覆盖 auth 流程与 URL 校验，未断言启动期模型拉取
  3. README 无需更新（用户视角没有可观察的协议变化）
- **回滚**：恢复 `tryRegisterModels` 调用即可。无需数据迁移。

## 待解决问题

1. **预热策略**：未来是否要在用户执行 `/login omniroute` 成功后立刻触发一次 `refreshModels` 缓存预热？候选行为：登录成功 → 自动 `refreshModels` 一次，让用户切到 omniroute 时无须等待。本次变更不引入此行为，保留作为未来增强。
2. **失败重试**：`refreshModels` 当前没有重试；网络抖动场景下用户需手动 `pi update --models`。本次变更不引入重试。
3. **本地持久化**：模型列表仅在内存中；每次 Pi 启动后第一次切换到 omniroute 都要走 `/models`。如果未来 OmniRoute 模型列表很大或网络受限，可考虑加本地缓存。本次不引入。

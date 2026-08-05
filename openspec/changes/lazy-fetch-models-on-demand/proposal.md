## 为什么

当前 `src/index.ts` 在扩展加载时无条件地调用 `fetch('${baseUrl}/models')`：
- `refreshModels` 在 pi 触发 `pi update --models` 时立刻同步执行；
- `tryRegisterModels` 在扩展注册 provider 时就发起一次网络请求（5 秒超时）。

结果：即便用户**只是列模型**（`/models` 命令）或者**还没切到 omniroute**，扩展也会在启动时向 OmniRoute 服务端打一发 `/models`。当 OmniRoute 不可达（容器未启动、远端宕机、网络受限）时：
- `tryRegisterModels` 走兜底分支但仍然消耗一次 5s 超时窗口，拖慢 Pi 启动；
- 任何 `/models` 类的操作都要再次拉取（包含重复失败）；
- 启动期日志噪声（`[omniroute] OmniRoute unavailable at ...`）。

诉求：模型列表只在用户**真正需要**时（切换 provider 到 omniroute、显式刷新、或 `/models`）拉取；列模型时若缓存为空再发起请求。

## 变更内容

- `getModels()` 维持返回内存中的 `models` 数组；但当数组为空时返回 `undefined`（或触发一次按需拉取），让 pi 的 ModelRuntime 处理"未拉取"状态
- `refreshModels({ signal })` 行为保持不变：在 `pi update --models` 触发时拉取并填充缓存
- 移除启动期 `tryRegisterModels()` 的自动调用：扩展注册 provider 时不再立即 fetch `/models`；模型拉取改为**按需**——用户切换到 omniroute 模型或显式调用 `refreshModels()` 时再拉
- 当 `getModels()` 返回空数组时，pi 的 ModelRuntime 会按需调用 `refreshModels()`，因此"按需"语义由 pi 自身驱动，不需要扩展手动调度
- 保留兜底：若 provider 已注册但首次模型拉取失败，错误依旧通过 pi 的标准错误通道冒泡（不再静默 `console.warn`）

## 功能 (Capabilities)

### 新增功能

- `lazy-model-fetch`: 扩展启动期不再拉取 `/models`；模型列表仅在 pi ModelRuntime 实际需要时（如切换 provider、调用 `refreshModels()`）按需拉取

### 修改功能

（无）

## 影响

- 修改文件：`src/index.ts`
  - 移除 `tryRegisterModels` 自动调用（`pi.registerProvider(provider)` 之后不再 `await`）
  - 调整 `getModels()` 与 `refreshModels()` 的协作：当 `models` 为空时让 pi 触发 `refreshModels`
- 测试影响：`test/` 下现有 `auth-credentials.test.ts` / `auth.test.ts` / `url.test.ts` 不依赖启动期模型拉取，不受影响
- 行为差异：
  - **启动期网络请求从 1 减为 0**：OmniRoute 不可达时不再阻塞 Pi 启动
  - **首次 `/models` 命令**：若缓存为空，pi 会先调用 `refreshModels` 再返回列表（增加一次往返）
  - **切到 omniroute 模型时**：若缓存为空，同样会先 `refreshModels`
- 外部 API 不变：`/models` 端点、OmniRoute 协议、auth 流程（`/login omniroute`、环境变量）均不受影响

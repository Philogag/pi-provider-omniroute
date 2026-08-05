# 深度技术设计：lazy-fetch-models-on-demand

> 本设计文档基于 OpenSpec 需求（`proposal.md` / `design.md` / `specs/lazy-model-fetch/spec.md`）做实现层面的细化。需求本身以 OpenSpec 为事实源，本文件不重新定义需求。

## 1. 概述

将模型列表拉取从"扩展加载时主动预热"改为"pi ModelRuntime 按需驱动"：

- 删除 `src/index.ts` 中 `tryRegisterModels` 的自动调用与其函数定义（连带 5s `AbortController` 超时与 `console.warn` 兜底）
- `refreshModels({ signal })` 成为**唯一的** `/models` 拉取入口，实现保持不变
- 新增 `test/lazy-fetch.test.ts` 自动化测试，将 delta spec 的验收场景固化为回归保护（升级原 tasks 中的手动验证）

## 2. 实现方案（src/index.ts）

仅两处删除，无新增逻辑：

```typescript
// 删除 1：pi.registerProvider(provider) 之后的调用
pi.registerProvider(provider);
- await tryRegisterModels(baseUrl, (fresh) => { models = fresh; });
```

```typescript
// 删除 2：文件末尾整个函数定义
- async function tryRegisterModels(...) { ... }
```

**保留不动**：
- `let models: OmnirouteModel[]` 闭包（入口函数内，每次扩展加载新建，无跨加载共享状态）
- `getModels: () => models`（pi 见空数组时自行调度 `refreshModels`）
- `refreshModels({ signal })`：`fetch('${baseUrl}/models', { signal })` → `!res.ok` 时 `throw new Error('OmniRoute /models failed: ' + res.status)` → 成功后 `models = data.map(...)`
- `toOmnirouteModel` 映射函数

**契约对齐验证**（pi-ai `Provider.refreshModels` 文档要求）：
- *"retain their previous list on failure"*：`models` 仅在成功后赋值，失败 throw 时保留旧值 —— 天然满足，无需改动
- *"honor the shared abort signal"*：`{ signal }` 已透传 fetch —— 天然满足

删除后 `src/index.ts` 内不再出现 `AbortController` / `setTimeout` / `console.warn`（rg 验证仅存在于 `tryRegisterModels`；`auth.ts`、`auth-credentials.ts` 中的 `console.warn` 属其他模块，不受影响）。

## 3. 测试策略（新增 test/lazy-fetch.test.ts）

沿用现有测试风格：`node:test` + `node:assert/strict`，直接 import 源码模块，mock 依赖（现有 `auth.test.ts` 用 `as unknown as` 断言 mock 类型，保持一致）。

### 3.1 环境隔离

| 依赖 | 隔离手段 |
| --- | --- |
| `~/.pi/agent/auth.json`（`resolveStoredBaseUrl()` 读取） | 测试前置设 `process.env.PI_AGENT_DIR` 为 `fs.mkdtempSync()` 空目录 → `readCredential()` ENOENT 返回 undefined → baseUrl 回退默认值；`after()` 恢复 |
| `process.env.OMNIROUTE_BASE_URL` | 测试前置 `delete process.env.OMNIROUTE_BASE_URL`；`after()` 恢复 |
| 全局 `fetch` | `node:test` 的 `mock.method(globalThis, "fetch", impl)`；`after()` `mock.restoreAll()` |
| `ExtensionAPI` | `{ registerProvider: (p) => { capturedProvider = p } } as unknown as ExtensionAPI`（仅需要 `registerProvider` 一个成员） |

入口函数每次执行新建 `let models` 闭包 → 测试间无共享状态污染。

### 3.2 用例 ↔ delta spec 场景映射

| # | 用例 | 覆盖的 delta spec 场景 |
| --- | --- | --- |
| 1 | 扩展入口执行后 `fetch` callCount === 0 | 扩展加载期无网络请求 |
| 2 | `provider.getModels()` 深等于 `[]` | provider 注册后 models 缓存为空 |
| 3 | fetch→2xx `{data:[...]}`，`refreshModels` 后 `getModels()` 含映射后的模型（id、baseUrl=默认值） | refreshModels 成功拉取 |
| 4 | fetch→`{ok:false,status:401}`，`assert.rejects(/OmniRoute \/models failed: 401/)` | 非 2xx 错误冒泡 |
| 5 | fetch reject `TypeError("fetch failed")`，`assert.rejects` | 网络不可达时抛错、未被 `console.warn` 静默 |
| 6 | 先成功拉取一次，再 mock 失败：rejects 且 `getModels()` 仍返回旧列表 | 后续读取命中缓存 + 契约 retain-on-failure |

`refreshModels` 入参：`{ signal: new AbortController().signal }`（`RefreshModelsContext` 的 `signal` 为可选字段，测试传 AbortSignal）。

### 3.3 TDD 节奏

测试先于实现：用例 1 在现状代码下必然失败（`tryRegisterModels` 会触发 fetch），用例 3–6 测 `refreshModels` 本体（与现状无关，直接绿）。实现删除后全绿。这与现有任务的 typecheck / 现有测试验证衔接，构成完整回归集。

## 4. 技术风险与边界条件

| 风险 / 边界 | 处置 | 等级 |
| --- | --- | --- |
| 并发 `refreshModels` 竞态（两次 fetch 并行，后完成者覆盖先完成者） | **不处理**。pi 不会并发调用同一 provider 的 `refreshModels`；OpenSpec 非目标明确"不引入新的缓存失效策略 / 依赖 pi 自身调度"。记录为已知边界 | 低 |
| 移除 5s 超时兜底 | `refreshModels` 的超时/取消改由 pi 传入的 signal 控制（契约要求 pi 提供并期望 honor）；符合 design.md D4"不修改 refreshModels 内部实现" | 低 |
| 首拉失败的用户感知 | 错误经 pi 标准错误通道渲染给用户，无扩展侧工作；不再有 `console.warn` 掩盖 | 无 |
| 测试环境依赖（本机 auth.json / env 泄漏） | `PI_AGENT_DIR` 空目录 + `delete OMNIROUTE_BASE_URL` 隔离 | 无 |
| 测试间共享状态 | 每次入口调用新建闭包，无污染 | 无 |
| fetch mock 泄漏到其他测试文件 | 每个测试文件独立进程（node --test 按文件跑），`after()` restoreAll 兜底 | 无 |

## 5. 验证与交付

- `npm run typecheck`（tsconfig 覆盖 `src/**` 与 `test/**`）
- `npm test`（`node --test --experimental-strip-types 'test/**/*.test.ts'`）—— 现有 auth/credentials/url + 新增 lazy-fetch 全部通过
- 原 tasks.md 的 2.3/2.4 手动验证升级为自动化测试（用例 1–5）；真实环境冒烟（`/models` 命令首次触发拉取）保留为可选

## 6. 文件清单

- 修改：`src/index.ts`（删除 2 处，无新增）
- 新增：`test/lazy-fetch.test.ts`
- 新增：`openspec/changes/lazy-fetch-models-on-demand/superpower-design.md`（本文档）
- 更新：`openspec/changes/lazy-fetch-models-on-demand/tasks.md`（同步自动化测试任务）

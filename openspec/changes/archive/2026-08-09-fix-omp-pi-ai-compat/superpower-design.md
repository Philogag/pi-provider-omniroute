# fix-omp-pi-ai-compat — Brainstorm Design

> OpenSpec（proposal/design/specs/tasks）是需求事实源。本文档是深度技术设计：实现方案、测试策略、边界条件、风险。

## 1. 问题与根因（已实证）

- **症状**：oh-my-pi 17.2.12 安装扩展失败：
  `Export named appendAssistantMessageDiagnostic not found in module omp-legacy-pi-bundled:@oh-my-pi/pi-ai`
- **根因**：omp 把 pi-ai 捆绑进二进制，经 `omp-legacy-pi-bundled:` 虚拟命名空间重导出（`@oh-my-pi/pi-ai`）。二进制 strings 实证：
  - `createAssistantMessageEventStream` ✅ 存在（event-stream.ts 导出）
  - `appendAssistantMessageDiagnostic` ❌ 缺失（count 0，diagnostics 是 pi-ai 0.84+ 新功能）
  - pi-tui 的 `Container`/`Loader`/`SelectList`/`Text` 全部 ✅
- **触发点**：`src/tools/usage-telemetry.ts:8` 静态导入 `appendAssistantMessageDiagnostic` → omp 校验扩展时按静态 import 逐符号校验 → 缺导出即安装失败。

## 2. 设计决策（用户已确认）

### D1 彻底解耦：永远直接 push `message.diagnostics`
- 导入改造（usage-telemetry.ts:8）：
  ```ts
  // 之前
  import { createAssistantMessageEventStream, appendAssistantMessageDiagnostic } from "@earendil-works/pi-ai";
  // 之后
  import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
  ```
- 调用点改造（:167）：
  ```ts
  (message.diagnostics ??= []).push({
    type: "omniroute-telemetry",
    timestamp: Date.now(),
    details: { responseCost, tokensIn, tokensOut, model, provider, cacheHit },
  });
  ```
- **理由**：官方 `appendAssistantMessageDiagnostic` 的实现就是 `message.diagnostics.push(...)`（d.ts 签名 `T extends { diagnostics?: AssistantMessageDiagnostic[] }` 证明语义等价）。直接 push 不依赖任何宿主导出，双宿主通吃，实现恒一，无运行时分支。
- **`diagnostics` 字段可用性**：pi-ai 0.83.0 / 0.84.1 / omp 捆绑版的 `AssistantMessage` 类型均含 `diagnostics?: AssistantMessageDiagnostic[]`（types.d.ts:296）。
- **否决的替代方案**：
  - Y1 动态导入 → 调用点同步于事件循环泵，引入异步复杂度 + 每消息重复解析
  - Y2 `import * as piAi` 条件访问 → 访问缺失符号返回 undefined 仍需运行时分支；与 omp minified-import 重写兼容性未验证
  - Y3 try/catch 顶层 import → 顶层 await 使模块变异步，破坏 index.ts 同步 import 链

### D2 保留 `createAssistantMessageEventStream` 静态导入
- 该导出是 `wrapStreamWithCost` 核心（构造输出流），omp 捆绑版确认存在，不改动。

### D3 不新增测试专用导出 / 不 mock 模块解析
- 测试环境（node + pi-ai 0.83）实际有该导出，无法自然模拟 omp 缺失。按用户决策：**纯 push 路径单测**，不 mock 模块解析。

### D4 omp 验证 = 先试装再定
- 实现后在本地 omp 环境试装扩展源码目录，实证校验通过；失败再调。不依赖推送。

## 3. 变更范围

- **唯一变更文件**：`src/tools/usage-telemetry.ts`（:8 导入 + :167 调用点）
- **测试文件**：`test/usage-telemetry.test.ts`（+1 单测）；integration/stream 测试文件**不改**（既有断言天然覆盖）
- 其他文件零 diff（含全部禁改文件）

## 4. 测试策略（纯 push 路径）

- **既有测试天然覆盖**（实现移除符号后自动验证 push 路径）：
  - `test/usage-telemetry-integration.test.ts:57` — 断言 `done.message.diagnostics` 含 `omniroute-telemetry`
  - `test/usage-telemetry-stream.test.ts:167,190` — 断言诊断存在 / 无遥测时 `diagnostics === undefined`
- **新增 1 个单测**（usage-telemetry.test.ts）：`wrapStreamWithCost` done 消息的 `diagnostics` 数组包含完整字段（responseCost/tokensIn/tokensOut/model/provider/cacheHit）+ `cost.total` 已覆盖。
- **typecheck**：`tsc --noEmit` 确保移除导入后无残留引用（`grep appendAssistantMessageDiagnostic src/` 应为 0 命中）。

## 5. 边界条件

- `message.diagnostics === undefined` → `??= []` 惰性初始化（与官方函数对可选字段的处理一致）
- 遥测缺失（无 responseCost）→ 跳过诊断附加，不创建空诊断
- 流中途错误 → 既有 catch + `out.end()` 不变
- 空遥测对象 `{}`（parser 对空值返回 `{}`）→ `responseCost === undefined` → 跳过，与现状一致

## 6. 风险与权衡

| 风险 | 缓解 |
|---|---|
| 官方函数未来改变诊断合并策略 | 当前实现即 push；若分歧，一行改条件导入（留档） |
| omp 未来捆绑版补齐导出 | 纯无害，push 语义恒等 |
| 单测无法模拟 omp 缺导出环境 | 用户决策：omp 本地试装实证（D4） |
| 漏掉其他缺失导出 | 已全面审计 src/ 运行时导入（auth.ts:6、index.ts:3-4、search-config.ts:4-5 均 type-only 或已验证）；实现时 grep 复验 |

## 7. 实现顺序（供 plan 参考）

1. usage-telemetry.ts 导入 + 调用点修改（TDD：先加单测红 → 绿）
2. 全量测试 + typecheck + 残留 grep
3. omp 本地试装实证
4. tasks.md 勾选 + commit

## 8. 开放问题

- 无（修复面单一，所有决策已确认）。

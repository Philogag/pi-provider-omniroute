---
change: fix-omp-pi-ai-compat
design-doc: openspec/changes/fix-omp-pi-ai-compat/superpower-design.md
base-ref: 074660ffa4720fb4ba5f1b70e54bd747c38a7332
---

# Goal

让扩展在 oh-my-pi（omp，捆绑 pi-ai 且缺 `appendAssistantMessageDiagnostic` 导出）与标准 Pi（pi-ai 0.83+）两种宿主的加载校验/运行时行为均正常：移除对缺失导出的静态依赖，遥测 diagnostics 改为直接操作 `message.diagnostics` 数组（宿主无关）。

# Architecture

- **唯一变更文件**：`src/tools/usage-telemetry.ts`，两处：
  1. `:8` 静态导入从 `{ createAssistantMessageEventStream, appendAssistantMessageDiagnostic }` 拆为仅 `{ createAssistantMessageEventStream }`（omp 已验证存在）。
  2. `:167` 调用点 `appendAssistantMessageDiagnostic(message, {...})` → `(message.diagnostics ??= []).push({...})`，字段与 timestamp 完全不变。
- 其他源文件零 diff。`wrapStreamWithCost` 签名、`usage.cost.total` 覆盖逻辑、流转发/错误路径全部不动。
- 测试：新增 1 个单测（usage-telemetry.test.ts，完整字段断言）；既有 integration:57 / stream:167,190 测试天然覆盖 push 路径（已断言 diagnostics 数组内容），不改。

# Tech Stack

- TypeScript（tsc --noEmit typecheck）、node:test 单测、npm test（当前基线 225 测试）
- 运行时零新依赖

# Global Constraints

- **禁止改动**：src/auth.ts, src/auth-credentials.ts, src/tools/http.ts, test/auth.test.ts, test/auth-credentials.test.ts, test/url.test.ts, test/tools-http.test.ts, test/tools-search.test.ts, test/tools-web-fetch.test.ts, test/search-config.test.ts, test/search-config-constants.test.ts, test/search-config-submenu.test.ts, test/search-config-select-items.test.ts
- **禁止**重新引入 `appendAssistantMessageDiagnostic` 的任何引用（import/调用/注释提及均避免——grep `appendAssistantMessageDiagnostic src/` 必须 0 命中）
- **禁止** mock `@earendil-works/pi-ai` 模块解析（纯 push 路径单测，用户已确认）
- diagnostics 字段集不变：`{ type: "omniroute-telemetry", timestamp: number, details: { responseCost, tokensIn, tokensOut, model, provider, cacheHit } }`
- `usage.cost.total` 覆盖语义不变（仅当 `responseCost !== undefined`）
- 每个任务独立 commit，message 体现设计意图
- tasks.md 勾选只改内容不 commit（用户既有约定）

---

# Task 1 — 移除缺失导出依赖，改直接 push

**Files**
- Modify: `src/tools/usage-telemetry.ts`（仅 :8 导入行 + :167 调用点）
- Create: 无
- Test: Modify `test/usage-telemetry.test.ts`（追加 1 个测试）

**Interfaces**
- Consumes: `createAssistantMessageEventStream`（从 `@earendil-works/pi-ai`，保持静态导入）
- Produces: 无新导出；行为签名不变（`wrapStreamWithCost(stream, telemetry | (() => telemetry)): AssistantMessageEventStream`）

**Steps**

1. **红**：在 `test/usage-telemetry.test.ts` 追加测试 `"attaches full omniroute-telemetry diagnostic to done message via diagnostics push"`：
   - 构造 mock stream：`{ [Symbol.asyncIterator]: async function* () { yield { type: "start", message: {} as never }; yield { type: "done", reason: "stop", message: { usage: { cost: { total: 0 } }, diagnostics: undefined } as never }; } }`
   - 调 `wrapStreamWithCost(stream, { responseCost: 0.00001904, tokensIn: 88, tokensOut: 13, model: "deepseek-v4-flash", provider: "opencode-go", cacheHit: false })`
   - `await stream.result()` 后断言：`message.diagnostics` 长度 1；`[0].type === "omniroute-telemetry"`；`typeof [0].timestamp === "number"`；`details` 深比较等于 `{ responseCost: 0.00001904, tokensIn: 88, tokensOut: 13, model: "deepseek-v4-flash", provider: "opencode-go", cacheHit: false }`；`message.usage.cost.total === 0.00001904`
   - 预期失败：`diagnostics` 为 undefined 或引用旧实现路径（当前测试环境实际走 `appendAssistantMessageDiagnostic`，若该函数存在则**红性不成立**——此时以 grep 证红：`grep -n "appendAssistantMessageDiagnostic" src/tools/usage-telemetry.ts` 输出 2 处命中作为红证据）
2. **绿**：改 `src/tools/usage-telemetry.ts`：
   - `:8` → `import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";`
   - `:167` → `(message.diagnostics ??= []).push({ type: "omniroute-telemetry", timestamp: Date.now(), details: { responseCost: t.responseCost, tokensIn: t.tokensIn, tokensOut: t.tokensOut, model: t.model, provider: t.provider, cacheHit: t.cacheHit } });`
   - 保持 `if (t?.responseCost !== undefined)` 外层条件与 `message.usage.cost.total = t.responseCost` 顺序不变
3. **验证**：`npm test`（225 基线 + 1 新增 = 226 通过）；`npm run typecheck` exit 0；`grep -rn "appendAssistantMessageDiagnostic" src/` 0 命中
4. **commit**：`fix: drop pi-ai appendAssistantMessageDiagnostic dependency for omp compatibility`

---

# Task 2 — 全量验证与收尾

**Files**
- Create: 无
- Modify: 无
- Test: 无（只验证）

**Interfaces**
- 无

**Steps**

1. **验证**：`npm test` 全量通过（226）；`npm run typecheck` exit 0；`git diff --stat` 确认仅 `src/tools/usage-telemetry.ts` + `test/usage-telemetry.test.ts`；禁改文件 0 diff（`git status --short` 核对）
2. **残留扫描**：`grep -rn "appendAssistantMessageDiagnostic" . --include="*.ts" --exclude-dir=node_modules` 0 命中（含测试文件，确认测试未 mock）
3. **tasks.md 勾选**：主工作区 openspec/changes/fix-omp-pi-ai-compat/tasks.md 勾 1.1/1.2/2.1/2.2（内容更新不 commit）
4. **commit**：无新代码 commit（Task 1 已含全部代码；若验证发现需修补则并入 Task 1 或追加 commit）
5. **通知用户**：omp 本地试装验证（用户侧操作，design D4）

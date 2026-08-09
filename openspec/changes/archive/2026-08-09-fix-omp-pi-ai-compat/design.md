# fix-omp-pi-ai-compat — 设计

## 上下文

- 扩展在 `src/tools/usage-telemetry.ts:8` 静态导入 `appendAssistantMessageDiagnostic`（pi-ai 0.84+ 的 diagnostics 工具），在 `:167` 用于给消息附加 `omniroute-telemetry` 诊断。
- 标准 Pi 环境：`node_modules/@earendil-works/pi-ai` 0.83.0（本仓库）+ 0.84.1（omp 同级目录）均有此导出；`utils/diagnostics.d.ts` 定义 `appendAssistantMessageDiagnostic<T extends { diagnostics?: AssistantMessageDiagnostic[] }>(message, diagnostic): void`。
- oh-my-pi 17.2.12：把 pi-ai 捆绑进二进制，经 `omp-legacy-pi-bundled:` 虚拟命名空间重导出（`@oh-my-pi/pi-ai`）。二进制 strings 验证：`createAssistantMessageEventStream` ✅ 存在，`appendAssistantMessageDiagnostic` ❌ 缺失（count 0）；pi-tui 的 Container/Loader/SelectList/Text 均 ✅。
- omp 校验扩展时按静态 import 逐符号校验 → 缺导出即安装失败（用户实测报错）。

## 目标 / 非目标

**目标：**
- 扩展在 omp（捆绑 pi-ai 无 diagnostics 导出）与标准 Pi（有该导出）两种宿主上均能加载。
- 遥测 diagnostics 行为语义与现状完全一致（类型/字段/timestamp 不变）。
- 225 既有测试通过，typecheck 0。

**非目标：**
- 不改变 usage-cost-telemetry 的任何规范行为（spec 不变，本变更纯实现级）。
- 不 polyfill 或向 omp 注册缺失符号。
- 不更新 pi-ai 版本（无法控制 omp 捆绑版）。

## 决策

### D1 移除静态导入，直接 push `message.diagnostics`
- 静态导入 `import { createAssistantMessageEventStream, appendAssistantMessageDiagnostic }` 拆为：保留 `createAssistantMessageEventStream`（omp 存在），`appendAssistantMessageDiagnostic` 的调用点改为内联等价实现：
  ```ts
  (message.diagnostics ??= []).push({ type: "omniroute-telemetry", timestamp: Date.now(), details: {...} });
  ```
- **理由**：官方 `appendAssistantMessageDiagnostic` 的实现就是 `message.diagnostics.push(...)`（语义等价，d.ts 签名已证明）；直接 push 不依赖任何宿主导出，双宿主通吃。`diagnostics` 字段在 pi-ai 0.83/0.84/omp 捆绑版的 `AssistantMessage` 类型中都存在（types.d.ts:296）。
- **替代方案**：
  - Y1 动态导入（`await import(...)` 或 `require`）→ 被拒：usage-telemetry 的调用点同步于事件循环泵，动态导入引入异步复杂度 + 每个消息重复解析模块；静态拆除更简单。
  - Y2 `import * as piAi from "..."` 后条件访问 → 被拒：命名空间导入在 omp 上虽不失败，但访问缺失符号返回 undefined，仍需运行时分支；且 `import * as` 与 omp 的 minified-import 重写兼容性未验证。
  - Y3 改为 try/catch 包装顶层 import（`let append; try { ({ append } = await import(...)) }`）→ 被拒：顶层 await 使模块变异步，index.ts 同步 import 链被破坏。

### D2 保持 `createAssistantMessageEventStream` 静态导入
- 该导出在 omp 捆绑版中确认存在（strings 验证），且是 `wrapStreamWithCost` 的核心（构造输出流）。保留静态导入，不改动。

### D3 不新增测试专用导出
- 既有测试通过断言 `message.diagnostics` 内容验证行为（integration/stream 测试），无需额外 hook。

## 风险 / 权衡

- [直接 push 与官方函数未来行为分歧（如官方后续版本改变诊断合并策略）] → 官方函数当前就是 push；若未来分歧，仅需一行改回条件导入（`"appendAssistantMessageDiagnostic" in piAi ? piAi.append(...) : push`）。
- [omp 未来捆绑版补齐该导出，静态拆解显得多余] → 无妨：push 实现与官方函数语义恒等，纯无害。
- [漏掉其他缺失导出] → 已全面审计 src/ 全部 `@earendil-works/pi-ai`/`pi-tui` 运行时导入（auth.ts:6、index.ts:3-4、search-config.ts:4-5 均 type-only 或已验证存在），仅 usage-telemetry.ts:8 有运行时依赖；审计在任务中复验。

## 迁移计划

- 无部署/数据迁移。修改 → 测试 → 用户在 omp 重装扩展验证校验通过 → 推送。
- 回滚：恢复静态导入即可（标准 Pi 环境不受影响，omp 环境回到原错误——但错误仅影响 omp，标准 Pi 正常）。

## 开放问题

- 无（修复面单一，无未决决策）。

# fix-omp-pi-ai-compat — 任务

> 与 superpower-plan.md 的 Task 一一对应。

## 1. 兼容修复（plan Task 1）

- [x] 1.1 修改 src/tools/usage-telemetry.ts：从 `@earendil-works/pi-ai` 的导入中移除 `appendAssistantMessageDiagnostic`（保留 `createAssistantMessageEventStream` + type-only 导入）；:167 调用点改为 `(message.diagnostics ??= []).push({ type: "omniroute-telemetry", timestamp: Date.now(), details: {...} })`（字段不变：responseCost/tokensIn/tokensOut/model/provider/cacheHit）
- [x] 1.2 验证 src/ 无其他缺失导出：grep 全部 `@earendil-works/pi-ai`/`pi-tui` 运行时导入（auth.ts:6、index.ts:3-4、search-config.ts:4-5 均 type-only 或 omp 已验证存在），确认仅 usage-telemetry.ts 有改动

## 2. 测试与验证（plan Task 1 + Task 2）

- [x] 2.1 新增单测（usage-telemetry.test.ts）：「done 消息经 diagnostics push 附加完整 omniroute-telemetry 诊断」——断言 type/timestamp 数字/details 完整字段（responseCost/tokensIn/tokensOut/model/provider/cacheHit）+ cost.total 已覆盖
- [x] 2.2 全量验证：npm test（213 基线 + 1 新增）+ npm run typecheck 0 + 禁改文件 0 diff + `grep -rn "appendAssistantMessageDiagnostic" . --include="*.ts" --exclude-dir=node_modules` 0 命中

## 3. 收尾（plan Task 2）

- [ ] 3.1 用户在 omp 本地试装验证扩展校验通过（用户侧，design D4）
- [x] 3.2 tasks.md 勾选 + commit "fix: drop pi-ai appendAssistantMessageDiagnostic dependency for omp compatibility"

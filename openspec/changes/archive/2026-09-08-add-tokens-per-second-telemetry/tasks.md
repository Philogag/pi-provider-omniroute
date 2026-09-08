## 1. 核对 delta 与 PR #2 实现一致

- [x] 1.1 逐项对照 pr-2 分支代码：`tokens-per-second`/`ttft-ms` 解析分支、`> 0` 守卫、`wrapStreamWithCost` 的"任意非空遥测即附加 + cost 仅 responseCost 覆盖"、details 新字段 —— 与 delta spec 文案一致。
- [x] 1.2 确认 R2（成本覆盖语义）无行为变化，不进 delta；既有场景全部保留在 MODIFIED 需求内。

## 2. 验证与归档（promote 主规范）

- [x] 2.1 `openspec-cn validate add-tokens-per-second-telemetry` 通过（4/4 产出物）。
- [x] 2.2 运行 `openspec-cn archive add-tokens-per-second-telemetry`（自动更新主规范），核对 `openspec/specs/usage-cost-telemetry/spec.md`：R1/R3 已更新、新增场景在列、R2 与未改动场景原样保留、文件仍通过 `openspec-cn spec validate usage-cost-telemetry`。
- [x] 2.3 `npm test` 全量回归通过（本变更零代码改动，仅确认基线）。
- [x] 2.4 归档目录落位 `openspec/changes/archive/2026-09-08-add-tokens-per-second-telemetry/`，工作树无残留变更。

## 3. 提交

- [x] 3.1 提交到 main：spec 增量 + 归档 + 主规范同步（conventional commit，遵循仓库历史风格）。

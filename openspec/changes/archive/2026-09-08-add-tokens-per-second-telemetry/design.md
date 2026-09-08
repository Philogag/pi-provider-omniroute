# Design: usage-cost-telemetry spec 增量（PR #2 网关 tok/s 遥测）

## Context

- PR #2（RaviTharuma）实现：`parseOmnirouteTelemetryLine` 新增 `tokens-per-second`/`ttft-ms` 分支（`Number.isFinite(n) && n > 0` 守卫）；`wrapStreamWithCost` 的 `done` 分支把附加诊断的条件从 `t?.responseCost !== undefined` 放宽为 `t && Object.keys(t).length > 0`，`cost.total` 覆盖仍只在 `responseCost !== undefined` 时执行；details 新增 `tokensPerSecond`/`ttftMs`。
- 活动顶层 spec `usage-cost-telemetry`（openspec/specs/）管辖同一表面：R1 捕获 header 集合、R2 cost 覆盖、R3 diagnostics 附加。其「目的」段已承诺"完整遥测（…延迟）附加到 diagnostics"，但代码（main 与 PR）details 均未含 `latencyMs` —— 存在既有漂移。
- 本变更只改 spec，不实现代码；spec 先行，代码经 PR #2 合并落地。

## Goals / Non-Goals

- Goals：R1/R3 全量更新到 PR #2 语义；把"延迟进 details"（S1）固化为 spec 要求以对齐目的段；保留 R2 不动。
- Non-Goals：不改实现、不动 R2（cost.total 覆盖语义无变化）、不新增能力、不处理 issue #1 的其余项（failover 模型归属、`X-OmniRoute-Decision` 等）。

## Decisions

**D1：spec-first 更新（在 PR 合并前落 spec）。**
PR 是外部 fork，无法在此会话内直接改其代码。先 promote spec，合并 PR 时以 spec 为验收清单；避免合并后补 spec 造成漂移窗口。备选（合并后再改 spec）被否：会让中间态"代码已合但契约未更新"。

**D2：`latencyMs` 列入 details 必含字段（S1），并记录为 PR 合并前置代码项。**
理由：spec「目的」段已把延迟列为完整遥测的一部分；details 长期漏写属实现漂移。PR 代码需补 `latencyMs: t.latencyMs`（src/tools/usage-telemetry.ts，约 1 行）+ 测试断言后方满足新 R3。风险：若合并时未补，spec 与代码短暂不一致 —— 以 review 门禁 + 本设计文档标注控制。

**D3：tok/s 与 ttft 的 `> 0` 守卫语义进 spec，但不套用到 `response-cost`。**
缓存命中 $0（`response-cost=0`）是合法且有意义的计费值（R2 场景"缓存命中时成本为零"），因此 0 值仅在速率/延迟类字段上省略；spec 文案明确区分，防止后人"统一守卫"引入回归。

**D4：归档走 `openspec-cn archive`（自动 promote 主规范）。**
archive 子命令"归档已完成的变更并更新主规范"，promote 后 delta 中 MODIFIED 需求整体替换主 spec 对应需求，R2 原样保留。归档名 `2026-09-08-add-tokens-per-second-telemetry`。promote 结果需人工核对（R1/R3 更新、R2 未动、既有场景保留）。

## Risks / Trade-offs

- **Spec 领先代码**：promote 后主 spec 描述 PR 后行为，main 代码仍是旧行为，直到 PR #2 合并。Spec-driven 流程下属正常态；影响仅"merge PR 时必须满足新 spec"。
- **归档重名**：同一天若再建同名变更会冲突 —— 本会话唯一，已核对 archive 目录无同名。
- **S1 遗漏**：详见 D2 风险控制。

## Migration Plan

- 无运行时迁移；回滚 = 撤销本提交（`git revert`）。
- 合并 PR #2 时的验收清单（记录于此，供后续会话/审查引用）：
  1. 解析 `tokens-per-second`/`ttft-ms`（含 `>0` 守卫、不推算）；
  2. 任意非空遥测即附加诊断、details 字段按捕获省略；
  3. **S1**：details 含 `latencyMs` + 测试；
  4. `cost.total` 仅当 responseCost 存在时覆盖（R2 回归）。

## Open Questions

- 无。

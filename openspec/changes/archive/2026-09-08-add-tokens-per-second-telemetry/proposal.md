# Proposal: 把 PR #2 网关 tok/s 遥测语义补进 usage-cost-telemetry spec

## Why

外部贡献者 PR #2（RaviTharuma，`feat/gateway-telemetry`，Closes #1）实现了 OmniRoute `tokens-per-second` / `ttft-ms` 遥测解析，并把"附加 `omniroute-telemetry` 诊断"从"仅当存在 responseCost"放宽为"捕获到任意遥测即附加"。该改动直接触碰**活动顶层 spec `usage-cost-telemetry`** 管辖的行为：其「捕获」需求的 header 集合不含两个新 key，「遥测详情附加」需求仍隐含以 responseCost 为前提、且 details 字段清单与实际实现不符（spec 目的段早已承诺"延迟"进入 diagnostics，但代码从未写入 `latencyMs`）。Spec 是行为契约——需要把 PR 语义（含延迟字段对齐）先落进 spec，避免合并后 spec 漂移。

## What Changes

- 修改 `usage-cost-telemetry` spec 的「捕获」需求：header 集合新增 `X-OmniRoute-Tokens-Per-Second`、`X-OmniRoute-Ttft-Ms`；明确 tok/s 仅报告正值、禁止从 `latency-ms` 推算（该延迟含 TTFT）。
- 修改「遥测详情附加到消息诊断」需求：**任意非空遥测即附加**（不以 responseCost 为前提），details 字段清单扩展为 `responseCost`/`tokensIn`/`tokensOut`/`tokensPerSecond`/`ttftMs`/`latencyMs`/`model`/`provider`/`cacheHit`（未捕获字段省略）。
- 保留既有语义：`cost.total` 仍**仅当 responseCost 存在时**覆盖（spec「成本遥测接入 Pi 计费统计」需求与场景不动）；零/非法 tok/s 忽略；无遥测不附加诊断。
- 补齐实现缺口 S1：spec 要求 details 含 `latencyMs`（对齐 spec 目的段既有承诺）；PR #2 代码未写入该字段，**合并 PR 时需补 S1**（设计文档中记录为合并前置项）。
- 纯 spec 文档变更，无破坏性变更（**BREAKING**: 无）。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `openspec/specs/usage-cost-telemetry/spec.md` ——「捕获 OmniRoute 成本遥测」「遥测详情附加到消息诊断」两条需求发生行为级变化，需 delta spec。

## Impact

- **代码**：本变更本身零代码改动；spec 引入的 `latencyMs`-in-details 要求（S1）在 PR #2 合并时落实（`src/tools/usage-telemetry.ts` details 补一行 + 相应测试断言）。
- **spec/文档**：`openspec/specs/usage-cost-telemetry/spec.md` 被 delta 更新（R1/R3 全量替换，R2 不变）。
- **测试**：不新增；合并 PR 时随 S1 增加 `latencyMs` details 断言。
- **依赖**：无。
- **验证**：`openspec-cn validate` 通过；归档时自动 promote 主规范。

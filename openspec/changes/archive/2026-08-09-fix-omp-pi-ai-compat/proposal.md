# fix-omp-pi-ai-compat

## 为什么

oh-my-pi（omp）通过 `omp-legacy-pi-bundled:@oh-my-pi/pi-ai` 提供捆绑的 pi-ai（0.84 之前），该版本缺少 `appendAssistantMessageDiagnostic` 导出。扩展 `src/tools/usage-telemetry.ts:8` 静态导入该符号，导致 omp 安装时扩展校验失败：

> Export named appendAssistantMessageDiagnostic not found in module omp-legacy-pi-bundled:@oh-my-pi/pi-ai

标准 Pi 环境（pi-ai 0.83+）可用该导出，因此修复必须同时兼容两种宿主。

## 变更内容

- 移除对 `appendAssistantMessageDiagnostic` 的**静态导入**（omp 校验失败的根因）。
- 遥测 diagnostics 附加改为**宿主无关**的实现：直接向 `message.diagnostics` 数组 push `AssistantMessageDiagnostic`（该字段在 `AssistantMessage` 类型中为 `diagnostics?: AssistantMessageDiagnostic[]`，pi-ai 0.83/0.84 与 omp 捆绑版均支持此结构），并保留 `createAssistantMessageEventStream` 导入（omp 中存在）。
- 行为语义不变：`omniroute-telemetry` 诊断仍附加到每条消息，字段（responseCost/tokensIn/tokensOut/model/provider/cacheHit）不变。

## 功能 (Capabilities)

### 新增功能
- `omp-compat`: 在缺少 `appendAssistantMessageDiagnostic` 导出的宿主（oh-my-pi 捆绑 pi-ai）上，扩展仍可加载且遥测 diagnostics 正常工作。

### 修改功能
- 无（这是实现级兼容修复；usage-cost-telemetry 的 spec 行为不变，仅实现方式变化）。

## 影响

- 代码：`src/tools/usage-telemetry.ts`（移除静态导入 + 改直接 push）
- 测试：`test/usage-telemetry.test.ts`、`test/usage-telemetry-stream.test.ts`、`test/usage-telemetry-integration.test.ts`（断言 diagnostics 内容不变；可能新增"宿主缺导出时仍工作"的测试）
- 验证：现有 225 测试 + typecheck 0；omp 安装校验通过（用户侧验证）
- 无新依赖

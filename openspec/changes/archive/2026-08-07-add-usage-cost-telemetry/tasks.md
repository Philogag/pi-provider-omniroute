## 1. 遥测解析器

- [x] 1.1 实现 parseOmnirouteTelemetryLine + extractOmnirouteTelemetry（src/tools/usage-telemetry.ts）+ 单测（test/usage-telemetry.test.ts，5 测试）
- [x] 1.2 提交 commit "feat: parse OmniRoute cost telemetry SSE comment lines"

## 2. TransformStream 透传 + fetch 包装

- [x] 2.1 实现 createTelemetryTransformStream + withOmnirouteFetch + 单测（跨 chunk/透传/UTF-8/非 2xx，7 测试）
- [x] 2.2 提交 commit "feat: byte-transparent telemetry transform stream and fetch wrapper"

## 3. 事件流写入（cost 覆盖 + diagnostics）

- [x] 3.1 实现 wrapStreamWithCost（done 覆盖 cost.total + appendAssistantMessageDiagnostic）+ 单测（test/usage-telemetry-stream.test.ts，5 测试）
- [x] 3.2 提交 commit "feat: wrap event stream to write OmniRoute cost into usage.cost.total"

## 4. Provider 接线

- [x] 4.1 修改 src/index.ts provider stream/streamSimple 注入 withOmnirouteFetch + wrapStreamWithCost + 接线测试（test/usage-telemetry-integration.test.ts，1 测试）
- [x] 4.2 提交 commit "feat: wire OmniRoute cost telemetry into omniroute provider stream"

## 5. 验证收尾

- [x] 5.1 全量验证：npm test（207 全绿）+ typecheck 0 + 禁改文件 0 diff
- [x] 5.2 README 中英补充成本遥测说明 + 提交 commit "docs: document OmniRoute cost telemetry in READMEs"

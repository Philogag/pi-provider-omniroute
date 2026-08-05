## 1. 移除启动期模型拉取

- [x] 1.1 删除 `src/index.ts` 中 `pi.registerProvider(provider)` 之后对 `tryRegisterModels(baseUrl, ...)` 的 `await` 调用
- [x] 1.2 删除 `src/index.ts` 末尾 `tryRegisterModels` 整个函数定义（不再被任何地方引用）
- [x] 1.3 保留 `provider.refreshModels({ signal })` 的实现：仍然 `fetch('${baseUrl}/models')`、解析 `data[]`、映射为 `OmnirouteModel[]`，失败时 `throw`

## 2. 自动化测试（覆盖 delta spec 验收场景）

- [x] 2.1 新增 `test/lazy-fetch.test.ts`：mock fetch + mock `ExtensionAPI`（仅 `registerProvider`）+ `PI_AGENT_DIR` 空目录环境隔离
- [x] 2.2 用例：扩展加载期 fetch 调用数为 0；注册后 `getModels()` 返回 `[]`
- [x] 2.3 用例：`refreshModels` 成功填充缓存（id 映射、baseUrl 为默认值）；非 2xx 与网络错误时 reject 冒泡（未被 `console.warn` 吞）
- [x] 2.4 用例：`refreshModels` 失败后保留旧列表，后续读取命中内存缓存

## 3. 验证

- [x] 3.1 运行 `npm run typecheck`，确认 `src/index.ts` 与 `test/lazy-fetch.test.ts` 通过类型检查
- [x] 3.2 运行 `npm test`，确认现有 auth / credentials / url 测试与新增 lazy-fetch 测试全部通过

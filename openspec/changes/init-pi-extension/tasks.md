## 1. 项目初始化

- [x] 1.1 更新根 `package.json` 添加依赖 `@earendil-works/pi-coding-agent`、`@sinclair/typebox`，设置 `"type": "module"`
- [x] 1.2 `npm install` 安装依赖
- [x] 1.3 验证 pi 入口发现机制（`pi -e .` 是否支持 `src/index.ts`；如不支持，在根目录创建 `index.ts` re-export）

## 2. 扩展骨架（验证加载）

- [x] 2.1 创建 `src/index.ts`，导出 async 默认工厂函数，接收 `pi: ExtensionAPI` 参数
- [x] 2.2 定义 `MODEL_DEFAULTS` 常量（`reasoning: false`、`input: ["text"]`、`cost: { input:0, output:0, cacheRead:0, cacheWrite:0 }`、`contextWindow: 128000`、`maxTokens: 4096`）
- [x] 2.3 验证骨架可被 `pi -e .` 加载（无 TypeScript 报错）

## 3. 完整实现

- [x] 3.1 实现 `registerProvider("omniroute", {...})`：传入 `baseUrl`（含 env 覆盖）、动态 `apiKey`、`api: "openai-completions"`、`models: []`、`refreshModels` 回调
- [x] 3.2 实现 `refreshModels` 回调：从 `${baseUrl}/models` 获取模型，映射为 `ProviderModelConfig` 数组
- [x] 3.3 实现 `tryRegisterModels()` 函数：5 秒超时 fetch、解析 `data` 数组、重新 `registerProvider` 替换模型
- [x] 3.4 优雅降级：catch 网络错误和 HTTP 错误，打印 `console.warn('[omniroute] OmniRoute unavailable, skipping model registration: ${err}')`
- [x] 3.5 TypeScript 类型检查（`tsc --noEmit` 无错误）
- [x] 3.6 验证 `pi -e . --list-models` 可正常加载（OmniRoute 未启动时看到 warning）

## 4. 手动验证

- [x] 4.1 OmniRoute 未启动 → provider 存在、无模型、console.warn ✅
- [ ] 4.2 OmniRoute 运行（无 API key）→ 列出 `omniroute/` 模型
- [ ] 4.3 OmniRoute 运行（设置 API key）→ 同上，apiKey 为 "local" 占位
- [ ] 4.4 `pi -e . update --models` → 模型列表刷新
- [ ] 4.5 普通对话（非流式）→ 正常响应
- [ ] 4.6 流式对话（SSE）→ 正常流式输出
- [ ] 4.7 认证失败（错误 key）→ provider 存在、无模型、console.warn

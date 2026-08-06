## 为什么

当前 `src/index.ts` 的 `toOmnirouteModel` 把所有模型都硬编码为 `contextWindow: 128000`、`maxTokens: 4096`、`reasoning: false`、`input: ["text"]`。但 OmniRoute 的 `GET /v1/models` 实际上为每个路由模型返回了更丰富的元数据：

```json
{
  "id": "auto/best-coding",
  "context_length": 1048576,
  "max_input_tokens": 1048576,
  "max_output_tokens": 1048576,
  "capabilities": { "tool_calling": true, "reasoning": true, "thinking": true, "temperature": true }
}
```

（部分条目还带有 `capabilities.vision` / `input_modalities` 等字段。）硬编码导致：
- Pi 显示错误的上下文窗口：1M 上下文的模型被标成 128k，影响 token 预算与自动截断；
- 推理模型（如 `auto/best-coding`、`*reasoning`）被标成 `reasoning: false`，Pi 不会向其发送 thinking/reasoning 相关参数，推理能力被隐藏；
- 视觉模型无法声明图片输入，Pi 不会向这些模型发送图片消息。

诉求：**优先使用 `/v1/models` 返回的额外信息**（上下文长度、输入/输出 token 上限、能力位）注册模型，仅在字段缺失或非法时回退到现有默认值。

## 变更内容

- `refreshModels` 解析 `/v1/models` 返回条目时，读取 `context_length` / `max_input_tokens` / `max_output_tokens` / `capabilities` 等额外字段并映射到 Pi `Model`：
  - `contextWindow` ← `max_input_tokens`（缺省时用 `context_length`，再缺省回退 128000）
  - `maxTokens` ← `max_output_tokens`（缺省回退 4096）
  - `reasoning` ← `capabilities.reasoning`（缺省回退 false）
  - `input` ← 当 `capabilities.vision` 或 `input_modalities` 含 image 时加入 `"image"`，否则保持 `["text"]`
- 非法值防御：字段缺失、非有限数、≤ 0 时按缺失处理，走回退路径
- 保留现有回退默认值（128000 / 4096 / false / text-only），保证元数据不完整的模型行为不变
- 测试：更新/新增 `/v1/models` 元数据映射的单元测试（含缺字段、非法值、vision、reasoning 场景）

## 功能 (Capabilities)

### 新增功能
- `models-metadata`: 从 `/v1/models` 的额外字段（context_length、max_input_tokens、max_output_tokens、capabilities）映射 Pi 模型元数据（contextWindow、maxTokens、reasoning、input），缺省时回退到固定默认值

### 修改功能

（无）

## 影响

- 修改文件：`src/index.ts`
  - `toOmnirouteModel` 接收完整条目（含可选元数据字段）并完成映射
  - `refreshModels` 的类型注解从 `Array<{ id: string }>` 扩展为带可选字段的条目类型
- 测试影响：
  - `test/lazy-fetch.test.ts` 现有断言基于 `{ id }` 条目，默认值回退逻辑使其继续通过；可补充元数据断言
  - 新增 `test/models-metadata.test.ts` 覆盖映射与回退
- 行为差异：注册后的模型在 Pi 中显示真实上下文窗口与推理/视觉能力；请求路径、协议、auth 流程不变
- 外部 API 不变：`/v1/models` 响应格式、OmniRoute 协议均不受影响

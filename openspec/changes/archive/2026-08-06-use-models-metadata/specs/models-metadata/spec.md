## 新增需求

### 需求:模型上下文窗口来自 /v1/models 元数据

扩展在 `refreshModels` 解析 `/v1/models` 响应时，必须优先使用条目中的 `max_input_tokens` 作为注册模型的 `contextWindow`；当 `max_input_tokens` 缺失或非法（非有限数、≤ 0）时，必须使用 `context_length`；当两者均缺失或非法时，必须回退到 `128000`。所有非 `number` 值（`null`、字符串等）必须按缺失处理。

#### 场景:存在 max_input_tokens 时使用该值
- **当** `/v1/models` 返回条目 `{ id: "m1", max_input_tokens: 1048576, context_length: 2000000 }`
- **那么** 注册的模型 `contextWindow` 必须为 `1048576`

#### 场景:max_input_tokens 缺失时使用 context_length
- **当** `/v1/models` 返回条目 `{ id: "m2", context_length: 131072 }`（无 `max_input_tokens`）
- **那么** 注册的模型 `contextWindow` 必须为 `131072`

#### 场景:两者均缺失时回退默认值
- **当** `/v1/models` 返回条目 `{ id: "m3" }`（无上下文相关字段）
- **那么** 注册的模型 `contextWindow` 必须为 `128000`

#### 场景:非法值按缺失处理
- **当** `/v1/models` 返回条目 `{ id: "m4", max_input_tokens: 0, context_length: -1 }`
- **那么** 注册的模型 `contextWindow` 必须为 `128000`

### 需求:模型输出上限来自 max_output_tokens

扩展注册模型时，必须使用条目中的 `max_output_tokens` 作为 `maxTokens`；当该字段缺失或非法（非有限数、≤ 0）时，必须回退到 `4096`。

#### 场景:存在 max_output_tokens 时使用该值
- **当** `/v1/models` 返回条目 `{ id: "m1", max_output_tokens: 65536 }`
- **那么** 注册的模型 `maxTokens` 必须为 `65536`

#### 场景:max_output_tokens 缺失时回退默认值
- **当** `/v1/models` 返回条目 `{ id: "m2" }`（无 `max_output_tokens`）
- **那么** 注册的模型 `maxTokens` 必须为 `4096`

### 需求:推理能力来自 capabilities.reasoning

扩展注册模型时，必须将条目的 `capabilities.reasoning`（布尔值）映射为模型的 `reasoning` 字段；当 `capabilities` 缺失、`reasoning` 键缺失或非布尔时，`reasoning` 必须为 `false`。

#### 场景:capabilities.reasoning 为 true 时启用推理
- **当** `/v1/models` 返回条目 `{ id: "m1", capabilities: { reasoning: true } }`
- **那么** 注册的模型 `reasoning` 必须为 `true`

#### 场景:capabilities.reasoning 缺失时禁用推理
- **当** `/v1/models` 返回条目 `{ id: "m2", capabilities: { tool_calling: true } }`
- **那么** 注册的模型 `reasoning` 必须为 `false`

#### 场景:capabilities 缺失时禁用推理
- **当** `/v1/models` 返回条目 `{ id: "m3" }`（无 `capabilities`）
- **那么** 注册的模型 `reasoning` 必须为 `false`

### 需求:视觉输入按能力位声明

扩展注册模型时，必须当 `capabilities.vision === true` 或 `input_modalities` 包含 `"image"` 时将模型的 `input` 声明为 `["text", "image"]`；否则 `input` 必须为 `["text"]`。

#### 场景:capabilities.vision 为 true 时声明图片输入
- **当** `/v1/models` 返回条目 `{ id: "m1", capabilities: { vision: true } }`
- **那么** 注册的模型的 `input` 必须为 `["text", "image"]`

#### 场景:input_modalities 含 image 时声明图片输入
- **当** `/v1/models` 返回条目 `{ id: "m2", input_modalities: ["text", "image"] }`（无 `capabilities.vision`）
- **那么** 注册的模型的 `input` 必须为 `["text", "image"]`

#### 场景:input_modalities 非数组时不声明图片输入
- **当** `/v1/models` 返回条目 `{ id: "m9", input_modalities: "text,image" }`（字符串而非数组）
- **那么** 注册的模型的 `input` 必须为 `["text"]`

#### 场景:无视觉证据时仅声明文本输入
- **当** `/v1/models` 返回条目 `{ id: "m3" }`（无视觉相关字段）
- **那么** 注册的模型的 `input` 必须为 `["text"]`

### 需求:模型显示名称来自 name 字段

扩展注册模型时，必须优先使用条目中的 `name` 字段（字符串）作为注册模型的 `name`；当 `name` 缺失或非字符串时，必须回退使用条目的 `id`。

#### 场景:name 存在时使用该值
- **当** `/v1/models` 返回条目 `{ id: "openai/gpt-4o", name: "GPT-4o" }`
- **那么** 注册模型的 `name` 必须为 `"GPT-4o"`

#### 场景:name 缺失时回退 id
- **当** `/v1/models` 返回条目 `{ id: "auto/best-coding" }`（无 `name` 字段）
- **那么** 注册模型的 `name` 必须为 `"auto/best-coding"`

### 需求:思考等级映射到 thinkingLevelMap

扩展注册模型时，当条目 `capabilities.thinking === true` 时，必须设置模型的 `thinkingLevelMap` 为完整映射 `{ minimal: "minimal", low: "low", medium: "medium", high: "high", xhigh: "high", max: "high" }`（将 pi 思考等级映射到 OpenAI `reasoning_effort` 取值，`xhigh`/`max` 收敛到 `high`）；当 `capabilities.thinking` 缺失或非 `true` 时，`thinkingLevelMap` 必须为 `undefined`。

#### 场景:thinking 为 true 时设置完整映射
- **当** `/v1/models` 返回条目 `{ id: "m1", capabilities: { thinking: true } }`
- **那么** 注册模型的 `thinkingLevelMap` 必须等于 `{ minimal: "minimal", low: "low", medium: "medium", high: "high", xhigh: "high", max: "high" }`

#### 场景:thinking 缺失时不设置映射
- **当** `/v1/models` 返回条目 `{ id: "m2", capabilities: { tool_calling: true } }`（无 `thinking` 键）
- **那么** 注册模型的 `thinkingLevelMap` 必须为 `undefined`

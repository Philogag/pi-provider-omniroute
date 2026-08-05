# OpenAI-Compatible Provider

## 新增需求

### 需求:扩展入口必须导出 async 工厂函数

Pi 扩展入口文件必须导出 `async` 默认函数，接收 Pi 实例作为参数，确保模型注册在启动流程完成前执行。

#### 场景:工厂函数签名正确

- **当** Pi 加载扩展
- **那么** 调用 `default(pi)` 并等待其完成

#### 场景:工厂函数为 async

- **当** 工厂函数执行
- **那么** 能够 `await` fetch 等异步操作

### 需求:必须注册 OmniRoute 为 OpenAI 兼容 provider

扩展必须在 `registerProvider()` 中使用 `api: "openai-completions"`，baseUrl 必须为 OmniRoute 的 `/api/v1` 前缀。

#### 场景:Provider 注册参数正确

- **当** 工厂函数执行
- **那么** 使用 `baseUrl: "http://localhost:20128/api/v1"` 和 `api: "openai-completions"`

#### 场景:Provider 名称为 OmniRoute

- **当** provider 注册完成
- **那么** provider 名称为 `"omniroute"`

### 需求:必须支持环境变量覆盖

API key 必须从环境变量读取，支持通过 `$OMNIROUTE_API_KEY` 配置；baseUrl 必须支持通过 `$OMNIROUTE_BASE_URL` 覆盖。

#### 场景:API key 从环境变量读取

- **当** 环境变量 `$OMNIROUTE_API_KEY` 已设置
- **那么** provider 的 `apiKey` 为该值

#### 场景:baseUrl 可通过环境变量覆盖

- **当** 环境变量 `$OMNIROUTE_BASE_URL` 已设置
- **那么** 使用该值作为 baseUrl，否则使用默认值

### 需求:必须自动导入模型列表

启动时必须从 OmniRoute `/api/v1/models` 获取模型列表，解析返回的 `data` 数组并注册为 Pi 模型。

#### 场景:成功获取模型列表

- **当** OmniRoute 可用且认证成功
- **那么** 从 `GET /api/v1/models` 解析 `data` 数组

#### 场景:模型 ID 和名称正确映射

- **当** 处理模型数据项
- **那么** 使用 `id` 作为模型 ID，`name` 缺省时使用 `id`

### 需求:模型配置必须提供默认值

由于 OmniRoute models API 不返回元数据，必须为以下字段提供默认值：

#### 场景:模型默认值配置

- **当** 注册单个模型
- **那么** `reasoning: false`、`input: ["text"]`、`cost: 0`

#### 场景:上下文窗口和最大令牌默认值

- **当** 注册单个模型
- **那么** `contextWindow: 128000`、`maxTokens: 4096`

### 需求:OmniRoute 不可用时必须优雅降级

当 OmniRoute 未启动、网络错误或认证失败时，必须跳过模型注册并打印警告，不阻止 Pi 启动。

#### 场景:OmniRoute 未启动

- **当** 连接 `http://localhost:20128/api/v1/models` 失败
- **那么** 打印警告 "OmniRoute unavailable, skipping model registration"

#### 场景:认证失败

- **当** 请求返回 401/403
- **那么** 打印警告并跳过模型注册

#### 场景:provider 仍可注册（即使无模型）

- **当** 模型注册失败
- **那么** 可选：仍注册 provider（无模型）或跳过 provider 注册

### 需求:必须使用 typebox 定义参数类型

工具参数（未来 Phase 2）必须使用 `typebox` 的 `Type.Object()` 等定义类型。

#### 场景:typebox 可用

- **当** 编写参数定义
- **那么** 使用 `@sinclair/typebox` 的 `Type.*` 函数

## 移除需求

无

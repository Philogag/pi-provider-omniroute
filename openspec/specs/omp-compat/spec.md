# omp-compat 规范

## 目的

本 capability 保证扩展可在标准 Pi 与 oh-my-pi（omp，捆绑 pi-ai 且缺失部分导出）两种宿主上正常加载与工作。omp 捆绑的 pi-ai 不含 `appendAssistantMessageDiagnostic` 导出，扩展不得依赖该符号；遥测诊断改为直接操作 `message.diagnostics` 数组实现，宿主无关。provider 注册使用双参数形式 `pi.registerProvider(name, config)`（omp 不支持单参数 Provider 对象），apiKey 采用标准 stored credential，baseUrl 支持 `omniroute.json` → env → 默认值解析。
## 需求
### 需求:扩展在缺少 diagnostics 导出的宿主上可加载

扩展**必须**在以下两种宿主上均可完成加载且遥测诊断功能正常工作：
1. 标准 Pi 环境（pi-ai 0.83+，含 `appendAssistantMessageDiagnostic` 导出）；
2. oh-my-pi 捆绑宿主（`omp-legacy-pi-bundled:@oh-my-pi/pi-ai`，无 `appendAssistantMessageDiagnostic` 导出）。

扩展**禁止**在模块顶层静态导入任何在任一宿主上不存在的符号。遥测诊断的附加**必须**不依赖 `appendAssistantMessageDiagnostic` 导出而实现（例如直接操作 `message.diagnostics` 数组），同时保留 `createAssistantMessageEventStream` 的导入（两种宿主均存在）。

#### 场景:标准 Pi 环境加载
- **当** 扩展在标准 Pi 环境（pi-ai ≥0.83）中加载
- **那么** 扩展正常注册 provider 与工具，遥测诊断附加到消息的 `diagnostics` 数组

#### 场景:oh-my-pi 捆绑宿主加载
- **当** 扩展在 oh-my-pi（捆绑 pi-ai，无 `appendAssistantMessageDiagnostic`）中安装加载
- **那么** 扩展校验通过、正常注册 provider 与工具，不因缺失导出而失败

#### 场景:遥测诊断内容不变
- **当** 一次 OmniRoute 流式调用成功返回且携带遥测
- **那么** done 消息的 `diagnostics` 数组包含 `omniroute-telemetry` 条目（timestamp 数字 + details 含 responseCost/tokensIn/tokensOut/model/provider/cacheHit），`usage.cost.total` 等于遥测成本

#### 场景:usage.cost.total 覆盖不受影响
- **当** 遥测解析结果 `responseCost` 为数字
- **那么** done 消息的 `usage.cost.total` 被覆盖为该值；当遥测缺失时 `usage.cost.total` 保持原值

### 需求:以双参数表单注册 provider

扩展**必须**通过双参数形式 `pi.registerProvider(providerName: string, config)` 注册 OmniRoute provider，其中 `config` 为 ProviderConfigInput 兼容对象，**禁止**使用单参数 Provider 对象形式（omp 不支持）。配置对象**必须**包含：

- `baseUrl`：OmniRoute API 静态地址（`omniroute.json` → env `OMNIROUTE_BASE_URL` → 默认值依次解析）；
- `api`：自定义 API 标识（`"omniroute"`；不能用内置名，omp 的 `assertCustomApiName` 禁止）；
- `streamSimple`：自定义流函数，**必须**保留遥测包装（`withOmnirouteFetch` + `wrapStreamWithCost`）；
- `models`：静态模型列表（启动时从 `{baseUrl}/models` 拉取并映射），每个模型条目**必须**含 `id`、`name`、`reasoning`、`input`、`cost`、`contextWindow`、`maxTokens`，`api` 与 config 一致。
- `apiKey`：**不**出现在 config 中（省略 → pi/omp 均走 stored credential；`$`/`${}` 语法仅 pi 认、裸名仅 omp 认，语法互斥故不可用）。

#### 场景:双参数注册成功
- **当** 扩展加载且 `{baseUrl}/models` 拉取成功
- **那么** `registerProvider` 以双参数形式被调用（providerName = "omniroute"），models 列表包含从 /models 映射的条目，`api` 为 `"omniroute"`

#### 场景:models 拉取失败降级
- **当** 扩展加载但 `{baseUrl}/models` 请求失败（网络错误 / 4xx / 5xx / 超时）
- **那么** 注册仍以双参数形式完成，models 为空列表，并输出警告日志（不阻断注册与其他工具注册）

#### 场景:streamSimple 保留遥测包装
- **当** 通过已注册 provider 发起一次流式调用
- **那么** 调用经 `config.streamSimple` 执行，且遥测包装生效（流式响应中的 OmniRoute 遥测被解析并附加到 done 消息 diagnostics）

#### 场景:apiKey 采用标准 stored credential
- **当** 用户在 Pi 中执行 `/login` 存入了 key（stored credential）
- **那么** provider 的鉴权使用该 stored key，且**不**依赖自定义 auth 对象（无 `auth` 字段或自定义 login 流程）；config 中**不**包含 `apiKey` 字符串字段


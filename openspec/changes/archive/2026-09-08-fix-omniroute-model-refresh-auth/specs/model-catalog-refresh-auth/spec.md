## 目的

定义 omniroute provider 模型目录刷新的认证契约：`refreshModels` 请求 OmniRoute `/models` 端点时必须携带解析到的 API key（Bearer），使需要认证的部署能成功刷新目录；认证或网络失败时错误照常冒泡、`getModels()` 保留旧列表（pi 据此回退到缓存模型）。

## 新增需求

### 需求:模型目录刷新请求携带 Bearer 认证

provider `refreshModels` 对 OmniRoute `/models` 端点发起的网络请求**必须**携带 `Authorization: Bearer <api-key>` 请求头。api key 的解析顺序**必须**为：pi ModelRuntime 传入的 `context.credential`（`type: "api_key"` 时的 `key`）→ 环境变量 `OMNIROUTE_API_KEY`。请求 URL **必须**由 baseUrl 去除尾部 `/` 后拼接 `/models`，**不得**产生 `//models` 双斜杠。

#### 场景:携带解析到的 credential 刷新成功

- **当** pi ModelRuntime 以携带 `credential`（api_key）的上下文调用 `provider.refreshModels` 且允许网络访问
- **那么** 扩展向 `${baseUrl}/models` 发起带 `Authorization: Bearer <key>` 的 GET 请求，响应 2xx 时 `getModels()` 返回最新模型列表

#### 场景:无 credential 时回退环境变量

- **当** 刷新上下文不携带 `credential` 但环境变量 `OMNIROUTE_API_KEY` 已设置
- **那么** 请求同样携带 `Authorization: Bearer $OMNIROUTE_API_KEY`

#### 场景:baseUrl 以斜杠结尾不产生双斜杠

- **当** baseUrl 以 `/` 结尾（如 `https://route.example.com/v1/`）且 `refreshModels` 发起网络请求
- **那么** 请求 URL 为 `https://route.example.com/v1/models`（不含 `//models`）

### 需求:刷新认证失败错误冒泡且保留旧模型

带认证的刷新请求失败（如 401 认证被拒、网络错误）时，`refreshModels` 抛出的错误**不得**被扩展吞掉，**必须**通过 pi 的标准错误通道呈现（pi 据此提示用户并回退到缓存模型）；`getModels()` 返回的既有列表**必须**保持不变。

#### 场景:401 认证失败错误冒泡

- **当** OmniRoute `/models` 对携带错误或过期 key 的请求返回 401
- **那么** `refreshModels` 抛出包含状态码的错误且未被静默，`getModels()` 保留刷新前的模型列表

#### 场景:网络错误错误冒泡

- **当** `refreshModels` 网络请求失败（fetch 抛错）或请求被中止
- **那么** 错误向调用方冒泡且未被吞掉，`getModels()` 保留刷新前的模型列表

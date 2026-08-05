## 新增需求

### 需求:扩展加载期不发起模型列表请求
扩展注册 provider 时，**禁止**主动调用 OmniRoute 的 `/models` 端点。模型列表的拉取必须**仅**在 pi ModelRuntime 实际需要时（首次枚举 provider、显式 `refreshModels()`、调用 `/models` 命令等）由 `refreshModels({ signal })` 触发。

#### 场景:扩展加载期无网络请求
- **当** 扩展入口函数（`pi.registerProvider` 调用之后）执行
- **那么** 不会向 `${baseUrl}/models` 发起任何 HTTP 请求

#### 场景:provider 注册后 models 缓存为空
- **当** 扩展刚完成 `pi.registerProvider(provider)`
- **那么** `provider.getModels()` 返回空数组（`[]`），且 pi ModelRuntime 后续按需调用 `refreshModels` 填充

### 需求:refreshModels 仍是唯一拉取入口
扩展必须暴露 `refreshModels({ signal })` 回调；pi 在需要最新模型列表时通过此回调获取。所有对 OmniRoute `/models` 端点的 HTTP 请求都必须由 `refreshModels` 内部发出。

#### 场景:refreshModels 成功拉取
- **当** pi 调用 `provider.refreshModels({ signal })` 且 OmniRoute `/models` 返回 2xx
- **那么** `provider.getModels()` 返回的数组被填充为响应中的模型列表

#### 场景:refreshModels 失败时错误冒泡
- **当** pi 调用 `provider.refreshModels({ signal })` 且 OmniRoute `/models` 返回非 2xx
- **那么** `refreshModels` 抛出的错误未被扩展吞掉，错误通过 pi 的标准错误通道呈现给用户

#### 场景:refreshModels 在网络不可达时抛错
- **当** pi 调用 `provider.refreshModels({ signal })` 且网络不可达或超时
- **那么** `refreshModels` 抛出错误，错误未被 `console.warn` 静默

### 需求:模型列表的可见行为对用户保持一致
从用户视角，列模型（`/models` 命令、provider 切换）展示的列表内容**必须**与变更前一致：仍是 `refreshModels` 拉到的最新结果。

#### 场景:首次切到 omniroute 触发拉取
- **当** 用户首次在 Pi 会话中将 provider 切换到 omniroute 且 `models` 缓存为空
- **那么** pi ModelRuntime 触发 `refreshModels` 一次，结果在 `getModels()` 中可见

#### 场景:后续读取命中缓存
- **当** `refreshModels` 已成功填充缓存，用户再次读取 `provider.getModels()`
- **那么** 返回内存中的模型数组，不重新发起 HTTP 请求

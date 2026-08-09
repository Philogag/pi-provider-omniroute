# omp-compat 规范

## 新增需求

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
- **当** 一条消息携带 OmniRoute 遥测（responseCost 等）
- **那么** 附加的诊断 `type` 为 `"omniroute-telemetry"`，`timestamp` 为数字，`details` 包含 `responseCost`、`tokensIn`、`tokensOut`、`model`、`provider`、`cacheHit` 字段

#### 场景:usage.cost.total 覆盖不受影响
- **当** 遥测中的 `responseCost` 已解析
- **那么** 消息 `usage.cost.total` 被覆盖为该值，与宿主类型无关

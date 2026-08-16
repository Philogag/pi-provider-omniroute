# Base URL Config

## Purpose

定义 OmniRoute base URL 的配置化生命周期：以全局 `settings.json`（`$PI_AGENT_DIR/settings.json`，通常为 `~/.pi/agent/settings.json`）中 `pi-provider-omniroute` 块的 `baseUrl` 字段为唯一持久化点，支持在 `/omniroute-settings` 中交互式查看、修改与重置，并完成旧版登录流程遗留 baseUrl 与旧配置文件 `omniroute.json` 的一次性迁移。

## ADDED Requirements

### Requirement: baseUrl 解析优先级

扩展解析 OmniRoute baseUrl 时必须按以下优先级：`settings.json` 的 `pi-provider-omniroute.baseUrl` 字段 → `OMNIROUTE_BASE_URL` 环境变量 → 默认值 `http://localhost:20128/v1`。已弃用的 auth.json 凭据环境变量与旧 `omniroute.json` 文件不得作为常驻回退参与解析。

#### Scenario: 配置块优先
- **WHEN** `settings.json` 的 `pi-provider-omniroute` 块配置了 `baseUrl` 且 `OMNIROUTE_BASE_URL` 环境变量同时存在
- **THEN** 所有 OmniRoute 请求使用配置块中的 baseUrl

#### Scenario: 无配置时使用环境变量
- **WHEN** `settings.json` 的 `pi-provider-omniroute` 块未配置 `baseUrl` 但设置了 `OMNIROUTE_BASE_URL`
- **THEN** 请求使用该环境变量的值

#### Scenario: 都未设置时使用默认值
- **WHEN** 配置块与环境变量均未提供 baseUrl
- **THEN** 请求使用默认值 `http://localhost:20128/v1`

#### Scenario: 旧配置源不再参与解析
- **WHEN** auth.json 凭据 env 存有 `OMNIROUTE_BASE_URL` 或旧 `omniroute.json` 存在，但迁移已完成或不存在，且配置块与 env 均未设置 baseUrl
- **THEN** 解析结果使用默认值，不使用任何旧配置源的值

### Requirement: 旧配置一次性迁移

扩展在会话启动时，若配置块无 `baseUrl` 且 `OMNIROUTE_BASE_URL` 未设置，必须把以下旧配置源一次性并入 `settings.json` 的 `pi-provider-omniroute` 块（仅填补缺失字段，不覆盖块内已有值），并立即以迁移后的值参与解析：
1. 旧 `omniroute.json`（若存在，其 `baseUrl` 与 `search`/`fetch` provider 配置整体并入；迁移成功后**删除**该文件）；
2. 旧版 `/login` 遗留的 auth.json 凭据 env `OMNIROUTE_BASE_URL`（仅 baseUrl；仅在无旧 `omniroute.json` 或其无 `baseUrl` 时使用）。

迁移只发生一次（写入后配置块字段存在，后续启动不再迁移）；若迁移写入 settings.json 失败，不得删除旧文件，告警后下次启动再次尝试。

从 auth.json 成功迁移 baseUrl（源②）后，扩展必须从该凭据的 `env` 中移除 `OMNIROUTE_BASE_URL`（保留 apiKey 与其余 env 键；env 变空时删除整个 env 字段），使该遗留值不再参与任何解析，且用户在菜单中重置 baseUrl 后不会被下一次会话启动重新迁移；清除失败（如 auth.json 不可写）时保留该值并告警，下次启动重试。

#### Scenario: 启动时存在旧 omniroute.json 则迁移并删除
- **WHEN** 会话启动时配置块无 `baseUrl`、env 未设置、且旧 `omniroute.json` 存在
- **THEN** 扩展把该文件的 baseUrl 与 search/fetch provider 配置并入配置块（不覆盖块内已有字段），本次会话使用迁移后的 baseUrl，迁移成功后删除旧文件

#### Scenario: 启动时存在 auth.json 遗留值则迁移
- **WHEN** 会话启动时配置块无 `baseUrl`、env 未设置、无旧 `omniroute.json`、但 auth.json 凭据 env 存在 `OMNIROUTE_BASE_URL`
- **THEN** 扩展把该值写入配置块的 `baseUrl` 字段，本次会话使用该 baseUrl

#### Scenario: 迁移成功后清除 auth.json 遗留 env
- **WHEN** 源②迁移成功（auth.json 凭据 env 的 `OMNIROUTE_BASE_URL` 已并入配置块）
- **THEN** 该 env 键被从凭据中移除（apiKey 与其余 env 键保留；env 变空则删除整个 env 字段），此后用户在菜单中重置 baseUrl 不会被下一次会话启动重新迁移

#### Scenario: 迁移后重置不会复活遗留值
- **WHEN** 用户通过 `/omniroute-settings` 重置 baseUrl（空输入回车，删除配置块 `baseUrl` 字段）后再次启动会话
- **THEN** 配置块仍无 `baseUrl`（旧 auth.json 遗留值已被清除，不会重新迁移），解析回退 env/默认值

#### Scenario: 迁移写入失败时保留旧文件
- **WHEN** 迁移写入 settings.json 失败（如目录不可写）
- **THEN** 旧 `omniroute.json` 不被删除，扩展记录告警，下次启动再次尝试迁移

#### Scenario: 迁移后不再重复执行
- **WHEN** 已完成一次迁移（配置块已含 `baseUrl`）后再次启动会话
- **THEN** 扩展不再改写 settings.json，直接使用已配置的 baseUrl

### Requirement: /omniroute-settings 顶层菜单提供 Base URL 条目

扩展的 `/omniroute-settings` 顶层菜单必须包含 "Base URL" 条目，行尾显示当前生效的 baseUrl 值预览；激活该条目后进入 baseUrl 编辑界面（预填当前值），支持 Enter 提交与 Esc 取消。

#### Scenario: 顶层菜单显示 Base URL 条目
- **WHEN** 用户在 TUI 模式下调起 `/omniroute-settings`
- **THEN** 顶层菜单出现 "Base URL: <当前生效值>" 条目（例如 `Base URL: http://localhost:20128/v1`）

#### Scenario: 编辑界面预填当前值
- **WHEN** 用户激活 "Base URL" 条目
- **THEN** 编辑界面显示当前生效的 baseUrl 作为预填内容

#### Scenario: Esc 取消编辑
- **WHEN** 用户在 baseUrl 编辑界面按 Esc
- **THEN** 扩展不修改任何配置，返回顶层菜单

### Requirement: baseUrl 提交校验、写入与重置

用户在 baseUrl 编辑界面按 Enter 提交时，扩展必须按以下规则处理：输入为合法 http(s) URL 时，校验通过后写入配置块（`settings.json` 的 `pi-provider-omniroute.baseUrl`）并返回顶层菜单；输入非法时，必须显示错误提示并停留在编辑界面（不写入配置）；输入为空时，必须从配置块删除 `baseUrl` 字段（解析回退到环境变量或默认值）并返回顶层菜单。

#### Scenario: 提交合法 URL
- **WHEN** 用户输入 `https://route.example.com/v1` 并按 Enter
- **THEN** 配置块的 `baseUrl` 字段被写为该值，顶层菜单预览更新为 `Base URL: https://route.example.com/v1`

#### Scenario: 提交非法 URL
- **WHEN** 用户输入 `not-a-url` 并按 Enter
- **THEN** 编辑界面显示校验错误提示，配置不被修改，输入内容保留供用户修改

#### Scenario: 空输入重置
- **WHEN** 用户清空输入并按 Enter
- **THEN** 扩展删除配置块的 `baseUrl` 字段，解析回退到 `OMNIROUTE_BASE_URL` 环境变量或默认值，顶层菜单预览随之更新

### Requirement: baseUrl 变更后尽力刷新模型

扩展在 baseUrl 提交成功后，必须尽力让已加载的 omniroute 模型使用新 baseUrl（例如触发模型刷新）；若刷新在当前环境不可用或失败，必须通知用户模型将在下次会话刷新。

#### Scenario: 刷新可用时模型立即更新
- **WHEN** 用户提交新的 baseUrl 且模型刷新成功
- **THEN** 已加载的 omniroute 模型列表来自新 baseUrl 的 `/models` 响应，模型请求使用新地址

#### Scenario: 刷新不可用时通知用户
- **WHEN** 用户提交新的 baseUrl 但模型刷新失败或不可用
- **THEN** 扩展向用户提示模型将在下次会话刷新，本次会话内模型端点保持不变

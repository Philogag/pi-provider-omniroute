# Base URL Config

## Purpose

定义 OmniRoute base URL 的配置化生命周期：以 `omniroute.json` 的 `baseUrl` 字段为唯一持久化点，支持在 `/omniroute-settings` 中交互式查看、修改与重置，并完成旧版登录流程遗留 baseUrl 的一次性迁移。

## ADDED Requirements

### Requirement: baseUrl 解析优先级

扩展解析 OmniRoute baseUrl 时必须按以下优先级：`omniroute.json` 的 `baseUrl` 字段 → `OMNIROUTE_BASE_URL` 环境变量 → 默认值 `http://localhost:20128/v1`。已弃用的 auth.json 凭据环境变量不得作为常驻回退参与解析。

#### Scenario: 配置文件优先
- **WHEN** `omniroute.json` 配置了 `baseUrl` 且 `OMNIROUTE_BASE_URL` 环境变量同时存在
- **THEN** 所有 OmniRoute 请求使用配置文件中的 baseUrl

#### Scenario: 无配置时使用环境变量
- **WHEN** `omniroute.json` 未配置 `baseUrl` 但设置了 `OMNIROUTE_BASE_URL`
- **THEN** 请求使用该环境变量的值

#### Scenario: 都未设置时使用默认值
- **WHEN** 配置文件与环境变量均未提供 baseUrl
- **THEN** 请求使用默认值 `http://localhost:20128/v1`

#### Scenario: auth.json 遗留值不再参与解析
- **WHEN** 用户的 `auth.json` 凭据 env 中存有 `OMNIROUTE_BASE_URL`，但配置文件与 env 均未设置 baseUrl，且迁移已完成或不存在
- **THEN** 解析结果使用默认值，不使用 auth.json 中的遗留值

### Requirement: 旧版登录遗留 baseUrl 一次性迁移

扩展在会话启动时，若 `omniroute.json` 未配置 `baseUrl`、`OMNIROUTE_BASE_URL` 未设置、且旧版 `/login` 遗留的 auth.json 凭据 env 中存在 `OMNIROUTE_BASE_URL`，必须把该值写入 `omniroute.json` 的 `baseUrl` 字段，并立即以该值参与解析。迁移只发生一次（写入后配置字段存在，后续启动不再迁移）。

#### Scenario: 启动时存在遗留值则迁移
- **WHEN** 会话启动时配置文件无 `baseUrl`、env 未设置、auth.json 凭据 env 存在 `OMNIROUTE_BASE_URL`
- **THEN** 扩展把该值写入 `omniroute.json` 的 `baseUrl` 字段，本次会话使用该 baseUrl

#### Scenario: 迁移后不再重复执行
- **WHEN** 已完成一次迁移（`omniroute.json` 已含 `baseUrl`）后再次启动会话
- **THEN** 扩展不再改写配置文件，直接使用已配置的 baseUrl

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

用户在 baseUrl 编辑界面按 Enter 提交时，扩展必须按以下规则处理：输入为合法 http(s) URL 时，校验通过后写入 `omniroute.json` 的 `baseUrl` 字段并返回顶层菜单；输入非法时，必须显示错误提示并停留在编辑界面（不写入配置）；输入为空时，必须从 `omniroute.json` 删除 `baseUrl` 字段（解析回退到环境变量或默认值）并返回顶层菜单。

#### Scenario: 提交合法 URL
- **WHEN** 用户输入 `https://route.example.com/v1` 并按 Enter
- **THEN** `omniroute.json` 的 `baseUrl` 字段被写为该值，顶层菜单预览更新为 `Base URL: https://route.example.com/v1`

#### Scenario: 提交非法 URL
- **WHEN** 用户输入 `not-a-url` 并按 Enter
- **THEN** 编辑界面显示校验错误提示，配置文件不被修改，输入内容保留供用户修改

#### Scenario: 空输入重置
- **WHEN** 用户清空输入并按 Enter
- **THEN** 扩展删除 `omniroute.json` 的 `baseUrl` 字段，解析回退到 `OMNIROUTE_BASE_URL` 环境变量或默认值，顶层菜单预览随之更新

### Requirement: baseUrl 变更后尽力刷新模型

扩展在 baseUrl 提交成功后，必须尽力让已加载的 omniroute 模型使用新 baseUrl（例如触发模型刷新）；若刷新在当前环境不可用或失败，必须通知用户模型将在下次会话刷新。

#### Scenario: 刷新可用时模型立即更新
- **WHEN** 用户提交新的 baseUrl 且模型刷新成功
- **THEN** 已加载的 omniroute 模型列表来自新 baseUrl 的 `/models` 响应，模型请求使用新地址

#### Scenario: 刷新不可用时通知用户
- **WHEN** 用户提交新的 baseUrl 但模型刷新失败或不可用
- **THEN** 扩展向用户提示模型将在下次会话刷新，本次会话内模型端点保持不变

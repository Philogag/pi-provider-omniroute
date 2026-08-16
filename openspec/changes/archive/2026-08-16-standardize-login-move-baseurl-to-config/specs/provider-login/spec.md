# Provider Login

## Purpose

定义 OmniRoute provider 的标准 api-key 登录与解析流程：`/login omniroute` 只收集 API key，不涉及 base URL；key 的解析遵循 pi 的标准优先级（已存凭据 → 环境变量）。

## ADDED Requirements

### Requirement: /login omniroute 只提示 API key

当用户执行 `/login omniroute` 时，扩展必须只提示输入 OmniRoute API key（secret 类型），不得提示输入 base URL；登录成功后存储的凭据必须只包含 API key，不得把 `OMNIROUTE_BASE_URL` 写入凭据的环境变量字段。

#### Scenario: 用户执行标准登录
- **WHEN** 用户执行 `/login omniroute` 且此前未登录
- **THEN** 扩展提示"Enter OmniRoute API key"（secret 输入），且不出现 base URL 提示

#### Scenario: 登录成功后凭据不含 base URL
- **WHEN** 用户通过 `/login omniroute` 提交 API key
- **THEN** 存储的凭据包含该 key，且凭据中不存在 `OMNIROUTE_BASE_URL` 环境变量

### Requirement: API key 解析遵循标准优先级

扩展解析 OmniRoute API key 时必须按以下优先级：已存储的凭据 key 优先；其次 `OMNIROUTE_API_KEY` 环境变量；两者皆无时视为未配置（provider 不可用）。

#### Scenario: 优先使用已存储凭据
- **WHEN** 用户已通过 `/login omniroute` 存储 key，且 `OMNIROUTE_API_KEY` 环境变量同时存在
- **THEN** 请求使用已存储凭据的 key

#### Scenario: 无凭据时使用环境变量
- **WHEN** 无存储凭据但设置了 `OMNIROUTE_API_KEY`
- **THEN** 请求使用该环境变量的值，来源标记为 `OMNIROUTE_API_KEY`

#### Scenario: 两者皆无视为未配置
- **WHEN** 既无存储凭据也未设置 `OMNIROUTE_API_KEY`
- **THEN** 扩展报告 OmniRoute provider 未配置，不发起认证请求

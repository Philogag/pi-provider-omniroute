## 为什么

`omniroute_web_search` 工具当前通过 `provider` 参数将搜索委托给 OmniRoute，但 `provider` 是每次调用都需显式传入的临时值 —— 用户没有"用户级默认 provider"的配置入口，每次想要"始终走 Tavily / Brave"必须在每次工具调用时手动指定。OmniRoute 服务端在 `GET /v1/search` 已暴露了可用 provider 目录（含每个 provider 的 `search_types` 元数据）。本次变更同时（1）将配置入口从单命令提升为统一设置菜单 `/omniroute-settings`（顶层菜单）以便后续扩展更多配置项（如 baseUrl / auth 状态等），（2）将 provider 选择持久化为 pi 全局文件（跨 session 生效），避免每次新会话都要重选。

## 变更内容

- 新增顶层设置命令 `/omniroute-settings`：进入一级菜单，呈现可配置项列表；当前包含 "Search provider" 一项。
- 新增二级配置项 "Search provider"：在一级菜单选择后进入 provider 选择面板，从 `${baseUrl}/search` 拉取 provider 目录（认证同 `/v1/models`），首项保留 `auto`（"Auto (follow server default)"），其后为 provider id；选择后立即写入 pi 全局配置文件。
- 配置持久化到独立的 `${PI_AGENT_DIR || ~/.pi/agent}/omniroute.json`（与 `auth.json` 解耦 —— `auth.json` 仍只承担 `env.OMNIROUTE_BASE_URL` 与 API key 等"凭据类"信息；`omniroute.json` 承担"用户偏好类"信息）。文件内根对象即为 omniroute 偏好，初始形态 `{ search: { provider?: string } }`。`auth-credentials.ts` 的 `readCredential` / `resolveStoredBaseUrl` 不动；新增 `readOmnirouteConfig` / `writeOmnirouteConfig` 助手独立读写 `omniroute.json`。
- `session_start` 钩子读取文件配置；`session_tree` 不再需要（文件全局生效，与分支无关）。
- 搜索工具 `execute` 阶段按"显式入参 > 配置文件 > 省略"合并 provider：`provider` 入参显式传入时优先；否则若配置为非 `auto` 字符串则注入；否则省略。
- `SEARCH_PROVIDERS` 静态字面量列表保留作为 `/v1/search` 不可达时的回退源，并作为 TypeBox schema 的字面量联合来源（不删除）。

## 功能 (Capabilities)

### 新增功能

- `web-search-provider-config`: 顶层级 `/omniroute-settings` 菜单 + "Search provider" 二级配置 + pi 全局文件持久化 + 工具执行的合并优先级 + 目录拉取与不可达回退。

### 修改功能

<!-- 无。当前没有需要需求变更的现有功能。搜索工具的 spec 层行为（provider 仍为可选）不变；新增的是独立 config 能力与持久化存储。 -->

## 影响

- `src/index.ts`: 注册 `/omniroute-settings` 顶层命令（自定义 TUI 组件实现层级导航）+ `session_start` 钩子读取配置；移除原先计划的 `/omniroute-search` 子命令。
- `src/tools/search-config.ts` (新): provider 目录拉取（`fetchSearchProviders` / `resolveSearchCatalog`）+ 文件持久化助手（`readOmnirouteConfig` / `writeOmnirouteConfig`）+ 静态回退常量 + 顶层菜单 / 子菜单渲染助手。
- `src/tools/search.ts`: `execute` 阶段读 config，按"显式入参 > 有效具体值 > 省略"合并 `provider`；`buildSearchBody` 透传逻辑保持不变。
- 依赖: `design.md` 阶段决策是否新增 `@earendil-works/pi-tui`（用于 `SettingsList` / `Container` 复用 `tools.ts` 例程模式）。
- 新增测试: provider 拉取成功/失败回退、文件读写（temp `PI_AGENT_DIR`）、配置合并三态、显式入参覆盖 config、顶层菜单与子菜单的导航流（mock `ctx.ui.custom` 验证状态机）。
- API: 新增消费端点 `GET /search`（同 baseUrl、同 auth）。
- 兼容: 现有 `omniroute_web_search` 调用方无需任何修改；既有 `auth.json` 完全不动（omniroute.json 与 auth.json 解耦）。

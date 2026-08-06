## 上下文

`src/tools/search.ts` 中的 `omniroute_web_search` 工具通过 `${baseUrl}/search`（POST）将查询委托给 OmniRoute；当前 `provider` 字段是每次调用都需显式传入的临时参数，扩展层无"用户级默认 provider"的配置入口。`src/index.ts` 仅注册 provider + 两个工具，未消费 OmniRoute 的 provider 目录端点。`/v1/search` GET 端点返回 provider 目录（含 `id` / `name` / `search_types`），是 provider 选择的运行时真相源。`SEARCH_PROVIDERS` 静态字面量列表（14 项）当前作为 TypeBox schema 的字面量联合来源，约束了入参取值集合；运行时 provider 集合可能更大（或更小），但 schema 的字面量联合不能动态生成（TypeBox 在 schema 构造时定型），故静态列表需保留为回退与 schema 来源。`pi-coding-agent` 的 ExtensionAPI 提供 `registerCommand` / `ctx.ui.custom` / `appendEntry` / `on("session_start"|"session_tree")`；其内置 TUI 设置列表组件来自 `@earendil-works/pi-tui`（`SettingsList` / `Container`），该依赖当前未在 package.json，但 pi-coding-agent 在其内置 settings-selector 与 `tools.ts` 例程中均直接使用。`src/auth-credentials.ts` 已建立文件持久化模式：`${PI_AGENT_DIR || ~/.pi/agent}/auth.json` 承载凭据（顶层 `omniroute` 键下的 `env.OMNIROUTE_BASE_URL` 等）。本变更引入**独立**的偏好文件 `${PI_AGENT_DIR || ~/.pi/agent}/omniroute.json`，与 auth.json 解耦 —— 凭据（auth.json）与偏好（omniroute.json）分文件存放，职责清晰，避免 auth.json 在 read-modify-write 时与未来其他字段互踩。

## 目标 / 非目标

**目标：**
- 用户在交互模式下通过 `/omniroute-settings` 进入设置菜单（一级菜单），从菜单选择 "Search provider" 进入 provider 选择面板（二级配置）
- provider 选择持久化到 pi 全局配置文件，跨 session 生效
- 搜索工具 `execute` 阶段自动按"显式入参 > 配置文件 > 省略"合并 provider
- provider 目录优先从 `${baseUrl}/search` GET 拉取（带 auth），端点不可达 / 401 时回退到 `SEARCH_PROVIDERS` 静态列表
- 菜单视觉复用 pi TUI `SettingsList` / `Container` 风格

**非目标：**
- 不修改 `omniroute_web_search` 工具的入参 / 出参 / TypeBox schema
- 不持久化 provider key（仍由 OmniRoute 路由层管理）
- 不实现其他配置项（baseUrl 编辑 / auth 重置）—— 本次仅落地 "Search provider" 一项；菜单架构保留扩展位
- 不消费 `search_types` 进行 UI 分组

## 决策

### D1: provider 目录运行时拉取 + 静态回退
- 主源: `GET ${baseUrl}/search`，带 `Authorization: Bearer <apiKey>`（复用 `omnirouteRequest` 模式），解析 `{ data: Array<{ id, name, search_types }> }`
- 回退: `SEARCH_PROVIDERS` 静态字面量（仅在 fetch 抛错 / status 非 2xx 时使用）
- 每次进入 "Search provider" 二级菜单时拉取（新 provider 立即可见），不在一级菜单渲染时拉取
- 拒绝: 不完全删除静态列表（TypeBox schema 需固定字面量联合；离线场景兜底）

### D2: 顶层菜单 + 二级配置项的两级 TUI 导航
- 顶层 `/omniroute-settings` 通过 `ctx.ui.custom` 渲染一个 `Container`，包含一个自定义菜单组件（首行 "Settings" 标题 + 一组 "menu item" 行 + 提示行），每行格式 `  <name>: <current value preview>`
- 菜单行支持上下键导航（j/k 或方向键）、Enter 激活、Esc 关闭
- 激活 "Search provider" 行后，状态机切换至 sub-state，重新渲染一个 `Container`，包含一个 `SettingsList`（provider 选项：首项 `auto`、其后目录 / 回退 entries）
- provider 子菜单的 `SettingsList` 回调 `(id, newValue)` 中：若新值为某 provider id 或 `auto`，调 `writeOmnirouteConfig({ search: { provider: id === "auto" ? undefined : id } })` 并切回顶层 state；Esc 切回顶层 state 不写入
- 单一 `ctx.ui.custom` 内的状态机，避免嵌套 `custom` 调用导致的 TUI overlay 栈管理复杂度
- 拒绝 A: 顶层用 `SettingsList` + 每行 `values` 数组内联编辑 —— 与 "一级菜单 / 二级配置项" 的层级语义不符（用户明确要求 drill-down）
- 拒绝 B: 多命令分发（`/omniroute-settings` → 子命令 `/omniroute-settings-search`）—— 增加命令表面积，且子命令注册时机需考虑命令解析顺序
- 复用: `tools.ts` 例程的 `Container` / `SettingsList` 模式

### D3: 持久化到独立文件 `${PI_AGENT_DIR || ~/.pi/agent}/omniroute.json`（pi 全局，与 auth.json 解耦）
- 路径: `${PI_AGENT_DIR || ~/.pi/agent}/omniroute.json`（与 `auth-credentials.ts` 的 `resolveAuthJsonPath()` 平行但不同文件）
- 目录解析: 新增 `resolveOmnirouteConfigPath(): string` 复用同 `PI_AGENT_DIR || ~/.pi/agent` 模式
- 数据模型: 根对象即为 omniroute 偏好；初始形态 `{ search: { provider?: string } }`；`provider` 缺失 / `undefined` / `"auto"` 语义等价（"不携带"）
- 读: `readOmnirouteConfig(): { provider?: string }` —— 解析根对象 `search.provider` 字段；缺失 / 字段不存在 / 类型不符 / JSON 损坏 / 文件不存在一律返回 `{}`（与 `readCredential` 错误处理一致：`console.warn` 记录，不抛）
- 写: `writeOmnirouteConfig(provider: string | undefined)` —— `read-modify-write` omniroute.json 全量 JSON（保留根对象其他键与 `search` 之外的可能字段，便于未来扩展），将 `search.provider` 设为 `provider`（`undefined` 时移除 `search` 键）；原子写（先写 `omniroute.json.tmp` 再 rename）；失败仅 `console.warn` 不抛
- 写入时机: provider 子菜单选择时立即写入；`session_start` 钩子读取当前配置填充 `currentConfigProvider`
- 不动 `auth-credentials.ts` 的 `readCredential` / `resolveStoredBaseUrl` —— 避免改动既有契约；omniroute.json 与 auth.json 是平行但独立的两份文件
- 拒绝 A: 仍写入 `auth.json` 的 `omniroute` 键下 —— 凭据与偏好混文件；与本变更"独立配置文件"的原则冲突
- 拒绝 B: 用 `pi.appendEntry`（session 作用域）—— 用户明确要求 pi 全局（跨 session）
- 拒绝 C: 用 pi-coding-agent 的 `SettingsManager` —— 扩展不应直写内置存储（与既有 auth.json 模式不同源）

### D4: 工具 execute 阶段三态合并
- 在 `searchTool.execute` 入口（解析 params 之后、调 `buildSearchBody` 之前）计算 `effectiveProvider`:
  - 若 `params.provider !== undefined`: 用 `params.provider`（显式入参优先，**不动现有透传逻辑**）
  - 否则若 `configProvider !== undefined && configProvider !== "auto"`: 用 `configProvider`
  - 否则: `undefined`（不注入，`buildSearchBody` 现有 `passthrough` 循环自然跳过 undefined）
- `configProvider` 通过工具闭包注入（`searchTool` 初始化时由 `src/index.ts` 注入 `() => currentConfigProvider`）；`session_start` 读取文件后调用 setter 更新
- 拒绝: 改 `buildSearchBody` 签名（透传逻辑保持稳定，避免回归）

### D5: 不动 TypeBox schema
- `searchParamsSchema` 的 `provider` 字段仍为 `stringEnum(SEARCH_PROVIDERS)`（14 项静态）
- 运行时目录可能含静态列表之外的 provider id —— 工具入参 schema 仍按字面量校验；配置文件注入是内部通道（spec 场景 4 的"无效 provider id 不注入"作为防御性检查）

## 风险 / 权衡

| 风险 | 缓解措施 |
| --- | --- |
| `@earendil-works/pi-tui` 以 peerDependency 引入，与 pi-coding-agent 解析路径冲突或未装 | 文档明示 peer 范围与 pi-coding-agent 一致；CI 跑 `npm ls @earendil-works/pi-tui` 校验可解析；用户机器若未自动装则提示安装 |
| 写入 `auth.json` 失败时丢配置 | 原子写（tmp + rename）；失败仅 warn，不抛；下次命令可重试 |
| `omniroute.json` 全量 read-modify-write 破坏根对象其他字段 | 严格保留原 JSON 结构（spread）；`search` 之外的字段保持不动；空对象写入自动清理为 `{}` |
| 两份文件（auth.json + omniroute.json）一致性 | 各自独立；无共享状态；若用户手动迁移需同时维护两文件（文档说明） |
| `/v1/search` 端点不存在 / 401 / 5xx | 静态回退 + UI 提示 |
| 顶层菜单扩展性（未来加 "Base URL" 等） | 一级菜单行注册表预留；当前仅 "Search provider" 一项 |
| `currentConfigProvider` 初始化时机（`session_start` 之前搜索工具已被调用） | `searchTool` 初始化时 `getConfigProvider` 默认返回 `undefined`；`session_start` 后异步更新；测试中可直接 setter 注入 |
| 分支恢复失效（用户期望在新分支自动重选） | 设计为 pi 全局：跨 session 共享，分支无关；不感知分支切换（`session_tree` 钩子移除） |

## 迁移计划

- 无破坏性变更：`omniroute_web_search` 调用方接口完全不变
- 既有 `auth.json` 完全不动（无 `search` 字段、omniroute.json 不存在均视为无偏好）
- 部署：随扩展下一次启动生效；`/omniroute-settings` 命令注册 + `session_start` 钩子在加载时挂接；首次进入菜单时若 `omniroute.json` 不存在，`writeOmnirouteConfig` 会自动创建（空对象或含选定 provider）
- 回滚：`git revert` 该变更；遗留的 `omniroute.json`（含 `search.provider` 字段）可手动删除，扩展代码不再读它时不影响 auth.json 凭据

## 开放问题

- 一级菜单未来要加的项（baseUrl 编辑 / auth 重置 / 模型刷新）当前未列入；菜单架构预留
- 是否需要为 provider 选择面板增加"测试 provider"按钮（用 provider 跑一次小查询）？当前不含
- 是否需要在 UI 中按 `search_types` 分组（web / news）？当前简化为平铺

## 为什么

`omniroute_web_fetch` 工具目前只能由调用方显式传 `provider` 参数（firecrawl / jina-reader / tavily-search / tinyfish），无法像 `omniroute_web_search` 那样在设置菜单中配置默认 provider。用户希望统一体验：通过 `/omniroute-settings` 配置默认 web-fetch provider，持久化到 pi 全局配置，并在工具调用时按"显式入参 > 已配置 > 省略"合并。

## 变更内容

- 在 `/omniroute-settings` 顶层菜单新增 "Web Fetch provider" 项（与 "Search provider" 并列），进入二级面板选择 fetch provider（静态 4 项：firecrawl / jina-reader / tavily-search / tinyfish）
- 二级面板使用官方 TUI 脚手架（DynamicBorder + SelectList + ✓ 标记 + keyHint），与 search 子菜单一致
- 选择持久化到 pi 全局 `omniroute.json` 的 `fetch.provider` 字段（与 `search.provider` 并列；`undefined`/缺失/`"auto"` 等价）
- `session_start` 时读取 `fetch.provider` 为 `currentFetchProvider`
- `omniroute_web_fetch` 工具 execute 阶段三态合并 provider：显式入参 > 已配置（非 auto）> 省略；TypeBox schema 静态字面量校验保持不变

## 功能 (Capabilities)

### 新增功能
- `web-fetch-provider-config`: web-fetch 工具的 provider 配置选择能力——`/omniroute-settings` 中的 Web Fetch provider 子菜单、`omniroute.json` 的 `fetch.provider` 持久化、`session_start` 加载、工具 execute 阶段三态合并

### 修改功能
<!-- 无——`web-fetch-provider-config` 是全新 capability；主规范中尚无 fetch provider 相关需求 -->

## 影响

- `src/tools/web-fetch.ts`: execute 阶段 provider 三态合并（新增 `currentFetchProvider` 注入，`buildFetchBody` 语义不变）
- `src/tools/search-config.ts`: 顶层菜单加 "Web Fetch provider" 行 + fetch 二级面板渲染器 + fetch 状态机分支
- `src/index.ts`: `session_start` 读取 `fetch.provider`、命令 handler 接入 fetch 子菜单
- 新增测试：`test/search-config-fetch-submenu.test.ts`、`test/web-fetch-merge.test.ts`、`test/session-start-fetch-config.test.ts` 等
- 无新依赖；官方 TUI 组件（DynamicBorder/Text/SelectList/keyHint）渲染

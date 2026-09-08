# Design: /omniroute-settings 登录前可用（移除 apiKey 守卫）

## Context

- `src/index.ts` registerSettingsCommand handler 开头（~L255-262）：`resolveApiKey(ctx)` 为空 → `ctx.ui.notify("…Run /login omniroute…", "error")` + return。`resolveApiKey` = `ctx.modelRegistry.getApiKeyForProvider("omniroute")`（tools/http.ts）。
- 死锁：新用户无 key → 菜单打不开 → baseUrl 无法从默认 localhost 改到真实实例 → `/login` 无从进行。活动顶层 spec（web-search-provider-config / web-fetch-provider-config）顶层菜单场景均无条件要求"输入命令即呈现菜单"，守卫是实现偏差。
- 菜单内部：top 级三项均不依赖 key；仅 `sub-search` 的 `fetchCatalogAsync`（search-config.ts ~L711-717）在 `deps.resolveApiKey()` 为空时**提前 return**——目录永不加载 → 静态 "Loading search providers…" 永久停留（Esc 可退回）。
- `fetchSearchProviders(baseUrl, apiKey, signal)` 无条件发送 `Authorization: Bearer ${apiKey}`——apiKey 为空会产生字面量 `Bearer undefined`。
- 无任何现有测试断言 settings 守卫行为（command-register.test.ts 仅覆盖非 TUI notify 分支、重复注册、Top 菜单渲染含 key 的路径）——移除零测试破坏。
- tools（omniroute_web_search / omniroute_web_fetch）执行时的 `/login` 提示是独立路径，本变更不触碰。

## Goals / Non-Goals

- Goals：无 key 时菜单可打开并可完成 Base URL / Web Fetch provider 配置；无 key 时 Search provider 子菜单优雅降级（无伪造认证头、无无限加载、401→静态回退符合活动 spec）；从零流程文档化为"settings → login"。
- Non-Goals：不自动触发登录、不改变 TUI-only 注册门控、不改变 tools 的 `/login` 提示、不改 provider 目录回退的既有文案。

## Decisions

**D1：直接删除 handler 的守卫（menu 无条件打开）。**
备选 (a) 无 key 时仍打开菜单但禁用部分行——复杂且与活动 spec"激活 Search provider 项即呈现二级面板"冲突；(b) 无 key 时改走自动登录流——越界。选直删。

**D2：`fetchCatalogAsync` 删除无 key 早退；`fetchSearchProviders` 的 `Authorization` 头按需附加（`apiKey` 存在才发送）。**
类型 `apiKey: string` → `string | undefined`（与 refreshModels 认证回退同一模式，见 model-catalog-refresh-auth 实现）。行为推演：开放网关（默认 localhost）无 key → 200 → 目录正常呈现；认证网关 → 401 → SearchCatalogError → `resolveSearchCatalog` 静态回退 `isFallback=true` → 面板显示 "…unreachable, using built-in list" + 内置 14 provider（满足 web-search-provider-config 目录回退需求）。目录请求本身有 10s 超时 + 错误分支，任何路径都收敛到列表或可 Esc，无限加载消除。

**D3：Base URL 提交的 best-effort 模型刷新保持不变。**
无 key 时 pi-ai `refresh()` 阶段二（网络）因无 credential 被静默跳过，`refreshOmnirouteModels` 自带 try/catch——settings 流程零风险（spec 场景"登录前 baseUrl 变更后的模型刷新不打断设置流程"）。

**D4：无 key 集成测试通过 command-register.test.ts 现有 handler harness 扩展**（ui.custom 捕获 + modelRegistry 返回 undefined），断言"custom 被调用（菜单打开）且无 error notify"。

## Risks / Trade-offs

- 认证网关下"未登录看 Search provider"会显示静态回退并提示 "catalog unreachable"——文案语义略偏（实为需认证），但与活动 spec 回退文案一致；区分"需登录"专属文案列为可选后续，不做本次范围。
- 发送无认证的目录请求到公网网关：无害（等同匿名 GET /search），无凭据泄漏。

## Migration Plan

- 无运行时迁移；回滚 = `git revert` 本提交。
- 合并清单（供 /stdd-apply 引用）：①删守卫；②无 key 不带认证头 + 类型放宽；③新测试（菜单开、无 Authorization 头、401 回退）；④README 两步从零流程；⑤spec 新能力 `settings-config-before-login` 归档。

## Open Questions

- 无。

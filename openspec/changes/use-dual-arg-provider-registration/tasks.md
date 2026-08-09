# use-dual-arg-provider-registration — 任务

## 1. omniroute.json baseUrl 持久化（配置层）

- [ ] 1.1 `OmnirouteConfigShape`/`readOmnirouteConfig` 支持根级 `baseUrl` 字符串（非字符串 warn + 跳过）
- [ ] 1.2 新增 `writeOmnirouteBaseUrl(baseUrl)`：写/删根级 baseUrl，保留未知键，atomic tmp+rename 0o600
- [ ] 1.3 新增 `resolveOmnirouteBaseUrl()`：omniroute.json → env → `OMNIROUTE_DEFAULT_BASE_URL`
- [ ] 1.4 测试：read/write/resolve 优先级（file beats env beats default）

## 2. 注册层双参数改造（index.ts + auth 清理 + 静态 models）

- [ ] 2.1 `pi.registerProvider("omniroute", { baseUrl, api: "omniroute", streamSimple, models })`；删除 auth/getModels/refreshModels/stream；apiKey: undefined（stored credential）
- [ ] 2.2 `toOmnirouteModel` 的 api 改 `"omniroute" as const`；`OmnirouteModel = Model<"omniroute">`
- [ ] 2.3 启动时 fetch `{baseUrl}/models` 一次；失败 → 空列表 + warn，不抛
- [ ] 2.4 src/auth.ts 删除 omnirouteApiKeyAuth/promptBaseUrlWithRetry；src/auth-credentials.ts 删除 resolveStoredBaseUrl
- [ ] 2.5 新测试 test/register-dual-arg.test.ts（双参数捕获/api 字段/models 映射/失败降级/apiKey undefined）
- [ ] 2.6 重写 test/lazy-fetch.test.ts 与 test/models-metadata.test.ts（旧懒加载断言与新设计冲突）；更新 test/auth.test.ts、test/auth-credentials.test.ts、test/command-register.test.ts

## 3. 状态机层 — Base URL 子菜单

- [ ] 3.1 `renderBaseUrlSubmenu`（官方 Pattern 1：DynamicBorder+Text+Input+keyHint；setValue 预填；onSubmit→onCommit；onEscape→onCancel；暴露 _input）
- [ ] 3.2 `renderTopLevelMenu` 第三行 `Base URL: <preview>` + `onActivateBaseUrl`
- [ ] 3.3 状态机 `"sub-base-url"` 模式 + `cachedBaseUrlSubmenu` 缓存（全 reset 路径失效）+ `initialBaseUrl`/`onCommitBaseUrlPersist` deps
- [ ] 3.4 测试：renderBaseUrlSubmenu（预填/提交/取消）、toplevel 第三行、状态机（模式切换/持久化/缓存）

## 4. index.ts 接线（settings 命令）

- [ ] 4.1 命令 handler deps 增 `initialBaseUrl: resolveOmnirouteBaseUrl()` + `onCommitBaseUrlPersist: writeOmnirouteBaseUrl`
- [ ] 4.2 command-register.test.ts 顶层渲染断言补 Base URL 行

## 5. 验证收尾

- [ ] 5.1 typecheck 0 + 全量测试 PASS + 残留 grep 干净
- [ ] 5.2 标准 Pi 人工冒烟（用户侧）：/login + 聊天遥测 + settings Base URL 持久化 + 重启生效
- [ ] 5.3 omp 冒烟（用户侧）：omp install + `omp -p --model omniroute/... "hi"` 不崩溃
- [ ] 5.4 README.md + README.zh-CN.md 注册段更新（双参数 + stored credential + Base URL 设置）

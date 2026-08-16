# 深度设计：仅 TUI 模式下注册 /omniroute-settings

> 上游需求摘要（勿重写）：`/omniroute-settings` 命令 SHALL 仅当运行环境为 TUI 模式时注册；print/json/rpc 模式 MUST NOT 注册（调用得到 unknown command，无任何 TUI 错误提示）；同一进程实例内注册幂等（session_start 多次触发不重复注册）。
> 用户确认（brainstorming）：①注册方案采用 session_start 内按 `ctx.mode` 判定 + once 标记；②rpc 模式同样排除（有对话框但无 `ui.custom` 覆盖层）。

## 1. 注册流程与数据流

```
扩展加载 (export default, pi: ExtensionAPI)
  └─ ExtensionAPI 无 mode 字段 → 加载期不注册（已核实 types.d.ts）
  └─ pi.on?.("session_start", handler)  ← 既有的迁移/配置读取逻辑在此

会话启动 (每次 session 开始: startup/new/resume/fork/reload 后的新实例)
  └─ handler(_ev, ctx: ExtensionContext)
       ├─ migrateLegacyConfig() 等既有逻辑（不变）
       └─ if (ctx.mode === "tui") registerSettingsCommand(pi)
             └─ once 标记 → 跳过重复
             └─ pi.registerCommand?.("omniroute-settings", { description, handler })

调用期
  └─ pi 每次 getRegisteredCommands() 实时 re-resolve（autocomplete 与命令分发都走它）
     → session_start 内注册的命令立即出现在 /- 菜单与可调用集合（已核实 runner.js:434）
```

## 2. 代码结构（src/index.ts）

```ts
let settingsCommandRegistered = false;

function registerSettingsCommand(pi: ExtensionAPI): void {
  if (settingsCommandRegistered) return;
  settingsCommandRegistered = true;
  pi.registerCommand?.("omniroute-settings", {
    description: "OmniRoute settings (search / web-fetch provider)",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      // 非 TUI 分支已删除（命令只存在于 TUI 模式）
      // API key 校验与 ctx.ui.custom 菜单渲染原样保留
      const apiKey = await resolveApiKey(ctx);
      if (!apiKey) { ctx.ui.notify("... /login omniroute ...", "error"); return; }
      // ...createMenuStateMachine + ctx.ui.custom 覆盖层（不变）
    },
  });
}
```

`session_start` handler 改造：

```ts
pi.on?.("session_start", async (_ev: unknown, ctx: ExtensionContext) => {
  const migrated = migrateLegacyConfig();
  if (migrated !== undefined) {
    baseUrl = migrated;
    await refreshOmnirouteModels(ctx);
  }
  const cfg = readOmnirouteConfig();
  currentConfigProvider = cfg.search?.provider;
  currentFetchProvider = normalizeFetchProvider(cfg.fetch?.provider);
  if (ctx.mode === "tui") registerSettingsCommand(pi);
});
```

要点：
- once 标记为模块级 `let`（`/reload` 重新执行扩展工厂 → 新模块实例 → 标记重置，自然重新评估，与 design.md D3 一致）。
- 注册调用放在 session_start handler 末尾：注册时机不影响迁移/配置读取的正确性；handler 闭包访问 `pi`（工厂参数）合法。
- `pi.on?.` 与 `pi.registerCommand?.` 保持可选调用（兼容最小测试替身）。

## 3. 边界条件表

| 场景 | 行为 | 依据 |
| --- | --- | --- |
| `session_start` 多次触发（TUI 内 new/resume/fork） | once 标记跳过，注册次数不增加 | spec R2 场景 1 |
| `/reload` | 新模块实例，标记重置 → 按当前模式重新评估 | design.md D3 |
| `ctx.mode === "rpc" / "json" / "print"` | 不注册（fail-closed：仅 `"tui"` 命中注册，其余一律不注册） | 用户确认② |
| `ctx.mode` 缺失/未知（测试替身未传） | `undefined !== "tui"` → 不注册（fail-closed 默认安全） | 判定实现 |
| 测试替身无 `on` / `registerCommand` | 可选调用跳过，无异常 | 既有惯例 |
| 注册时 `runtime.assertActive()` 抛错 | session_start 由 runner 派发，必然已激活；不防御 | runner.js 实现 |
| apiKey 未配置（TUI 内调起命令） | notify 提示 `/login`（既有行为保留） | spec 未改 |
| 迁移在非 TUI 执行 | 迁移逻辑与注册解耦：非 TUI 照常迁移、配置读取，仅不注册 | 代码位置 |

## 4. 测试策略（test/command-register.test.ts 重写）

harness：`mockPi()` 现有捕获 `sessionStartHandler` + `registeredCommands` map + 新增 `registerCommandCalls` 计数器。

| 用例 | 断言 |
| --- | --- |
| TUI mode 触发 session_start 后命令可用 | `sessionStartHandler({}, { mode: "tui" })` → `registeredCommands["omniroute-settings"]` 存在；registerCommandCalls === 1 |
| print / json / rpc mode 不注册 | 分别触发 → `registeredCommands["omniroute-settings"]` 为 undefined；registerCommandCalls === 0 |
| 未触发 session_start 不注册（懒注册语义） | 仅 `entry(mockPi())` → 命令未注册（原"entry 即注册"断言删除） |
| 幂等：TUI session_start 两次 | 触发两次 → registerCommandCalls === 1，命令仍可调用 |
| handler 无残留非 TUI 分支 | TUI 注册后直接调用 handler 传 `{ mode: "print", ui: { notify: spy } }` → notify 未被调用（原"non-TUI notifies"测试删除） |
| 既有集成路径保持 | 沿用现有 TUI 集成用例（apiKey 缺失 notify / 菜单渲染），前置加 session_start(TUI) 触发 |

其他测试文件影响评估：
- `session-start-config.test.ts` / `session-start-fetch-config.test.ts`：sessionCtx 无 `mode` → 判定为不注册，不影响其断言（它们不检查命令）；若其 mockPi 无 `registerCommand`，可选调用跳过。
- `migration-config.test.ts`：迁移逻辑位置不变，无影响。

## 5. 文件级变更清单

| 文件 | 变更 |
| --- | --- |
| `src/index.ts` | +`registerSettingsCommand()` + once 标记；session_start handler 末尾加 `if (ctx.mode === "tui") registerSettingsCommand(pi)`；handler 删除非 TUI notify 分支 |
| `test/command-register.test.ts` | harness 加 registerCommandCalls；按上表重写/增删用例 |
| `README.md` / `README.zh-CN.md` | `/omniroute-settings` 相关说明标注"仅 TUI 模式可用" |

无新增依赖；无数据迁移。

## 6. 风险与缓解

- [用户先于 session_start 调用命令（理论上不可能）] → session_start 在启动流程中先于用户输入触发；命令表实时读取。可接受（design.md Risk 同）。
- [测试替身缺 mode 字段 → 注册判定走不到 TUI 分支] → 显式传 `{ mode: "tui" }`；这正是测试策略的用例设计。
- [README 措辞与实现漂移] → 变更清单同步更新两语言 README。

## 7. 开放问题

无阻塞开放问题。delta spec（settings-command-tui-gating）验收场景已完整（TUI 注册 / 非 TUI 不注册 / 无通知 / 幂等 / 判定后不变），无需回写。

---
change: register-settings-in-tui-only
design-doc: openspec/changes/register-settings-in-tui-only/superpower-design.md
base-ref: b9b854759e7d6932cfb5ac5b4ca699c53a6aceea
---

# Register /omniroute-settings in TUI mode only — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Register the `/omniroute-settings` command only when the extension runs in TUI mode, so print/json/rpc sessions never expose it.

**Architecture:** The extension factory's `pi` argument has no mode field, so registration cannot be gated at module load. Instead, gate on the `session_start` event's `ExtensionContext.mode` — the only place the run mode is visible — using a module-level once-flag for idempotence. Command autocomplete resolves the command registry live per menu-open, so late registration works. The handler's non-TUI `notify` branch becomes dead code and is removed.

**Tech Stack:** TypeScript (ESM, Node ≥ 22.6, `@earendil-works/pi-coding-agent` 0.84.x). No new dependencies.

**Spec:** `openspec/changes/register-settings-in-tui-only/specs/settings-command-tui-gating/spec.md` (capability `settings-command-tui-gating`, requirements R1/R2) + deep design in `openspec/changes/register-settings-in-tui-only/superpower-design.md`.

## Global Constraints

- Parsing/resolution priority and settings.json `pi-provider-omniroute` block semantics must not change (readOmnirouteConfig / writeOmnirouteConfig / writeOmnirouteBaseUrl / migrateLegacyConfig untouched).
- Command handler behavior in TUI mode (API-key check, menu state machine, `ctx.ui.custom` overlay, Esc-close semantics) must not change — only registration timing and the dead non-TUI branch.
- `pi.on?.` and `pi.registerCommand?.` stay optional calls (test doubles without them must not crash).
- No new dependencies. Tests run with `node --test --experimental-strip-types 'test/**/*.test.ts'`; typecheck with `tsc --noEmit` (strict).
- Commit per task with a clear message.

---

### Task 1: Gate /omniroute-settings registration on TUI mode

**Files:**
- Modify: `src/index.ts` — module state + `session_start` handler (lines 213-224) + replace the `pi.registerCommand?.("omniroute-settings", ...)` block (lines 228-283)
- Modify: `test/command-register.test.ts` — harness counter, rewrite/add 4 tests, update 2 integration tests

**Interfaces:**
- Consumes: `ExtensionContext.mode: "tui" | "rpc" | "json" | "print"` (pi-coding-agent types.d.ts:208-213); existing `registerSettingsCommand`-internal deps unchanged (`resolveApiKey(ctx)`, `createMenuStateMachine({...})`, `writeOmnirouteConfig`, `writeOmnirouteBaseUrl`, `refreshOmnirouteModels(ctx)`, `currentConfigProvider`, `currentFetchProvider`, `baseUrl`).
- Produces: module-scoped `let settingsCommandRegistered: boolean`; hoisted function `registerSettingsCommand(pi: ExtensionAPI): void`; `session_start` handler ends with `if (ctx.mode === "tui") registerSettingsCommand(pi);`. Nothing else imports these — later tasks (README) only reference behavior.

- [ ] **Step 1: Update the test harness and write the failing tests**

In `test/command-register.test.ts`:

1. Add a `registerCommandCalls` counter next to `registerProviderCount` (line 3):

```ts
let registerCommandCalls = 0;
```

2. Increment it in `mockPi`'s `registerCommand`:

```ts
    registerCommand: (name: string, opts: { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> | void }) => {
      registerCommandCalls++;
      registeredCommands[name] = opts.handler;
    },
```

3. Add a `freshPi()` helper after `mockPi()` (resets counters and the command registry so new tests are order-independent; the existing first test still runs first against zeroed module state):

```ts
function freshPi(): ExtensionAPI {
  registerProviderCount = 0;
  registerToolCount = 0;
  registerCommandCalls = 0;
  for (const k of Object.keys(registeredCommands)) delete registeredCommands[k];
  return mockPi();
}
```

4. Replace the second test (currently `"/omniroute-settings in non-TUI mode notifies without opening UI"`) with these four tests:

```ts
test("entry registers provider + 2 tools but not /omniroute-settings (TUI-only)", async () => {
  await entry(freshPi());
  assert.equal(registerProviderCount, 1);
  assert.equal(registerToolCount, 2);
  assert.equal(registeredCommands["omniroute-settings"], undefined, "command must not be registered before a TUI session start");
});

test("TUI session_start registers /omniroute-settings exactly once (idempotent)", async () => {
  await entry(freshPi());
  assert.ok(sessionStartHandler, "harness must capture session_start");
  await sessionStartHandler!({}, { mode: "tui" });
  await sessionStartHandler!({}, { mode: "tui" });
  assert.ok(registeredCommands["omniroute-settings"], "command must be registered after a TUI session start");
  assert.equal(registerCommandCalls, 1, "repeated session_start must not re-register");
});

test("print/json/rpc session_start never registers /omniroute-settings", async () => {
  for (const mode of ["print", "json", "rpc"]) {
    await entry(freshPi());
    await sessionStartHandler!({}, { mode });
    assert.equal(registeredCommands["omniroute-settings"], undefined, `${mode} must not register the settings command`);
    assert.equal(registerCommandCalls, 0, `${mode} must not call registerCommand`);
  }
});

test("TUI-registered handler no longer notifies in non-TUI contexts", async () => {
  await entry(freshPi());
  await sessionStartHandler!({}, { mode: "tui" });
  let notified: { msg: string; type: string } | null = null;
  const ctx = {
    mode: "print",
    ui: { notify: (msg: string, type?: "info" | "warning" | "error") => { notified = { msg, type: type ?? "info" }; } },
  } as unknown as ExtensionCommandContext;
  await registeredCommands["omniroute-settings"]("", ctx);
  assert.equal(notified, null, "the non-TUI notify branch must be gone");
});
```

5. The two remaining integration tests (`"wrapped custom component re-resolves the state-machine component per render"` and `"/omniroute-settings: top menu renders Base URL row; base-url reset commit refreshes models"`) invoke `registeredCommands["omniroute-settings"]("", ctx)` right after `await entry(mockPi());`. Insert a TUI session_start trigger before that invocation in **both** tests:

```ts
    await sessionStartHandler?.({}, { mode: "tui" });
```

- [ ] **Step 2: Run the focused suite to verify the new tests fail**

Run: `node --test --experimental-strip-types test/command-register.test.ts`
Expected: at least 2 FAILURES —
- `"entry registers provider + 2 tools but not /omniroute-settings (TUI-only)"` (current code registers the command at entry),
- the `"print/json/rpc session_start never registers"` loop (current code registers it at entry, so `registerCommandCalls === 1` for the first iteration).
The old deleted test is gone; the two integration tests still pass because the trigger line is a no-op on the current code (`sessionStartHandler` exists and calling it is harmless).

- [ ] **Step 3: Implement the gated registration in `src/index.ts`**

3a. Add the once-flag next to the other module-level state (near `currentConfigProvider` / `currentFetchProvider`, ~line 73):

```ts
// /omniroute-settings is TUI-only (its overlay needs ctx.ui.custom). The run
// mode is only visible via session_start's ExtensionContext, so registration
// happens on the first TUI session_start; repeated events (new/resume/fork)
// must not re-register the command (spec R1/R2).
let settingsCommandRegistered = false;
```

3b. Append the registration gate at the end of the existing `session_start` handler (after the `currentFetchProvider = normalizeFetchProvider(...)` line, ~line 223):

```ts
    // Register the TUI-only settings command only when running in TUI mode.
    // print/json/rpc sessions must not expose /omniroute-settings (spec R1).
    if (ctx.mode === "tui") registerSettingsCommand(pi);
```

3c. Replace the entire current `pi.registerCommand?.("omniroute-settings", { ... })` block (lines 228-283) with a hoisted function declaration (same handler body, minus the `if (ctx.mode !== "tui") { ...notify...; return; }` branch, plus a comment pointing at the gate):

```ts
// /omniroute-settings: two-level menu (top → Search provider submenu) rendered
// as a TUI overlay. Registered only on the first TUI session_start (see the
// session_start handler); the handler's non-TUI notify branch was removed
// because the command no longer exists outside TUI mode.
function registerSettingsCommand(pi: ExtensionAPI): void {
  if (settingsCommandRegistered) return;
  settingsCommandRegistered = true;
  pi.registerCommand?.("omniroute-settings", {
    description: "OmniRoute settings (search / web-fetch provider)",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      // Verify the API key before opening the menu.
      const apiKey = await resolveApiKey(ctx);
      if (!apiKey) {
        ctx.ui.notify("OmniRoute API key is not configured. Run /login omniroute or set OMNIROUTE_API_KEY.", "error");
        return;
      }
      const sm = createMenuStateMachine({
        resolveApiKey: () => resolveApiKey(ctx),
        resolveBaseUrl: () => baseUrl,
        initialCurrentProvider: currentConfigProvider,
        initialFetchProvider: currentFetchProvider,
        onCommitPersist: (provider) => {
          currentConfigProvider = provider;
          writeOmnirouteConfig(provider);
        },
        onCommitFetchPersist: (provider) => {
          currentFetchProvider = provider;
          writeOmnirouteConfig(provider, "fetch");
        },
        onCommitBaseUrl: (value) => {
          writeOmnirouteBaseUrl(value);
          baseUrl = value ?? resolveOmnirouteBaseUrl();
          void refreshOmnirouteModels(ctx);
        },
        onClose: () => {},
      });
      await ctx.ui.custom((tui, theme, _kb, done) => {
        // Resolve the component fresh on each frame/input so the wrapped render
        // and handleInput always delegate to the current mode's component.
        const wrapped: Component = {
          render: (w: number) => sm.getComponent(tui, theme).render(w),
          invalidate: () => sm.getComponent(tui, theme).invalidate(),
          handleInput: (data: string) => {
            // Top-level Esc closes the overlay; submenu Esc is forwarded to the
            // current mode's component which handles its own cancel/back.
            if (data === "\x1b" && sm.mode() === "top") {
              done(undefined);
              return;
            }
            sm.getComponent(tui, theme).handleInput?.(data);
            tui.requestRender();
          },
        };
        return wrapped;
      });
    },
  });
}
```

Note: `registerSettingsCommand` is a hoisted function declaration, so the call inside `session_start` (which appears earlier in the file) resolves at runtime. Keep `pi.on?.` and `pi.registerCommand?.` optional.

- [ ] **Step 4: Run the focused suite, then the full suite and typecheck**

Run: `node --test --experimental-strip-types test/command-register.test.ts`
Expected: PASS (5 tests in this file, all green).

Run: `npm test`
Expected: PASS — the full suite (`test/**/*.test.ts`). Other files (session-start-config, migration-config, search-config-*, tools-*) are unaffected: their mock doubles either lack `on`/`registerCommand` or trigger `sessionStartHandler` without a `mode`, which is `!== "tui"` → no registration, and they never assert on the command.

Run: `npm run typecheck`
Expected: no output (clean).

- [ ] **Step 5: Commit**

```bash
git add src/index.ts test/command-register.test.ts
git commit -m "feat: register /omniroute-settings only in TUI mode (session_start gating)"
```

---

### Task 2: Document the TUI-only command in README (EN + zh-CN)

**Files:**
- Modify: `README.md` — line 94 area (`/omniroute-settings` invocation block)
- Modify: `README.zh-CN.md` — line 134 area (same block)

**Interfaces:**
- Consumes: Task 1 behavior (command exists only in TUI sessions; unknown command in print/json/rpc).
- Produces: documentation only — no runtime interfaces.

- [ ] **Step 1: Update the English README command section**

In `README.md`, find the block at line ~94 (currently a bare `/omniroute-settings` code line followed by "This opens an interactive TUI menu...") and make the section explicitly TUI-only. Add a `> **Note:**` line before the invocation block (keep the existing code fence and following sentence intact):

```markdown
> **Note:** `/omniroute-settings` is a TUI-only command. It is registered only
> when Pi runs in interactive TUI mode — in `print` / `json` / `rpc` sessions
> the command does not exist (configure via `$PI_AGENT_DIR/settings.json`
> instead, see [Configuration](#configuration)).

/omniroute-settings
```

- [ ] **Step 2: Mirror the note in the Chinese README**

In `README.zh-CN.md`, find the `/omniroute-settings` block at line ~134 and prepend the same note in Chinese before the code line:

```markdown
> **注意：** `/omniroute-settings` 是仅 TUI 模式可用的命令。只有 Pi 以交互式 TUI
> 运行时才会注册该命令 —— 在 `print` / `json` / `rpc` 会话中命令不存在（如需配置，
> 请直接编辑 `$PI_AGENT_DIR/settings.json`，见[配置](#配置)）。

/omniroute-settings
```

- [ ] **Step 3: Verify no stale wording remains**

Run: `grep -n "omniroute-settings" README.md README.zh-CN.md`
Expected: only the existing mentions plus the new notes; no line claims the command works in non-TUI modes.

- [ ] **Step 4: Run the full suite as a smoke check**

Run: `npm test && npm run typecheck`
Expected: PASS (docs-only change; full suite still 260 passing) and clean typecheck.

- [ ] **Step 5: Commit**

```bash
git add README.md README.zh-CN.md
git commit -m "docs: note /omniroute-settings is TUI-only (EN + zh-CN)"
```

---

## Self-Review

**1. Spec coverage:**
- R1 (TUI 注册 / print·json·rpc MUST NOT 注册 / 非 TUI 无提示) → Task 1 steps 1-4 (4 new tests + gate + notify branch removal). ✓
- R2 (同一进程幂等 / 判定后不变) → Task 1 idempotent test (two `session_start` events → `registerCommandCalls === 1`) + once-flag implementation. ✓
- BREAKING note (非 TUI unknown command) → Task 2 README notes. ✓

**2. Placeholder scan:** All steps carry exact code (verified against current `src/index.ts:213-283` and `test/command-register.test.ts`). No TBD/TODO/later steps. ✓

**3. Type consistency:** `registerSettingsCommand(pi: ExtensionAPI): void` — call site passes `pi` (factory param, in closure of `session_start` handler). `registerCommandCalls` matches harness + all four tests. `sessionStartHandler!({}, { mode: "tui" })` — harness types it as `(...args: unknown[]) => unknown`, `await` on unknown is fine. ✓

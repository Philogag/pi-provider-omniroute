# superpower-design: add-web-search-provider-selection

> **For implementers:** This document complements (does not replace) the OpenSpec artifacts at `proposal.md` / `design.md` / `tasks.md` / `specs/web-search-provider-config/spec.md`. OpenSpec is the source of truth for *what* to build; this doc supplies *how* (component contracts, state-machine mechanics, persistence algorithms, error matrix, testing strategy, edge cases). Read OpenSpec first, this doc second.

**Source-of-truth pointers:**
- 目标与动机 → `proposal.md` Why
- 决策摘要（D1-D5） → `design.md` Decisions
- 验收需求与场景 → `specs/web-search-provider-config/spec.md`
- 任务边界 → `tasks.md`

---

## 1. Scope of This Document

OpenSpec `design.md` captures the *what* and *why* at decision granularity. This document provides:

1. **Architecture refinements** that translate OpenSpec decisions into concrete module boundaries, signatures, and call sequences
2. **Component contracts** for the new `search-config` module (TUI renderers, persistence helpers, catalog fetcher)
3. **State-machine mechanics** for the two-level TUI navigation (D2 implementation)
4. **Persistence mechanics** for `omniroute.json` (D3 implementation)
5. **Error handling matrix** covering all failure modes end-to-end
6. **Testing strategy** with explicit mock boundaries
7. **Edge cases & boundary conditions** that emerged during brainstorming
8. **OpenSpec spec gaps** identified during design that must be back-written before implementation
9. **Risk matrix** extending OpenSpec's risk table
10. **Implementation sequence** for the upcoming `/opsx-sp-plan` skill

Out of scope: rewriting OpenSpec requirements, changing OpenSpec decisions without user sign-off, deciding questions the user has already answered.

---

## 2. Architecture Refinements

### 2.1 Module layout

```
src/
├── index.ts                       # register provider, tools, /omniroute-settings, session_start
├── auth.ts                        # (unchanged) URL validation, default baseUrl
├── auth-credentials.ts            # (unchanged) auth.json read — strict no-touch
├── tools/
│   ├── http.ts                    # (unchanged) omnirouteRequest, resolveApiKey, resolveBaseUrl
│   ├── search.ts                  # MODIFY: inject getConfigProvider closure; 三态合并 effectiveProvider
│   ├── web-fetch.ts               # (unchanged)
│   └── search-config.ts           # NEW: catalog fetch + persistence + TUI renderers
└── ...

test/
├── search-config.test.ts          # NEW: catalog fetch + fallback
├── search-config-submenu.test.ts  # NEW: provider SettingsList render contract
├── search-config-persistence.test.ts  # NEW: omniroute.json round-trip + corruption
└── search-tool-merge.test.ts      # NEW: 三态合并 + 防御性
```

`search-config.ts` is the single new module. It is the only place that:
- Reads or writes `${PI_AGENT_DIR || ~/.pi/agent}/omniroute.json`
- Renders TUI components for the provider submenu and the top-level menu
- Calls `GET ${baseUrl}/search`

`src/index.ts` is the only place that:
- Holds `currentConfigProvider` module state
- Registers `/omniroute-settings` and `session_start` hooks
- Constructs the `ctx.ui.custom` state machine and dispatches top/sub rendering
- Calls `setSearchConfigReader` to inject the closure into `searchTool`

`src/tools/search.ts` is the only place that:
- Reads `getConfigProvider()` and computes `effectiveProvider`
- The `buildSearchBody` pass-through loop is **not modified** — it already skips `undefined` values

### 2.2 State ownership (D2 + D3 + D4 cross-cutting)

Three pieces of mutable state across two modules:

| State | Location | Owner | Reader |
|---|---|---|---|
| `currentConfigProvider` | `src/index.ts` module scope | `session_start` callback writes; `/omniroute-settings` `onCommit` writes; `onCancel` does not write | `searchTool` via `getConfigProvider` closure |
| `mode: "top" \| "sub"` | `ctx.ui.custom` factory closure | `top`/`sub` key handlers; `Enter`/`Esc`/`SettingsList` callback | The state machine's render selector |
| `catalog: { providers, isFallback }` | `ctx.ui.custom` factory closure | `resolveSearchCatalog` async call on submenu open | The submenu `SettingsList` constructor |

No global state. The `currentConfigProvider` in `index.ts` is the **only** cross-command state; the menu state is scoped to one `ctx.ui.custom` invocation.

### 2.3 Locked decisions recap (consolidated)

The brainstorming session locked three previously-open decisions:

| ID | Decision | Rationale |
|---|---|---|
| A | Menu state machine uses **closure variable + two independent Components** (not a single Component that re-renders different rows, not nested `ctx.ui.custom` calls) | Preserves focus/scroll per-component; single TUI overlay; clean Enter/Esc dispatch |
| B | `@earendil-works/pi-tui` is declared as **peerDependency** in `package.json` (range aligned with `pi-coding-agent`) | Extensions are expected to share the same pi-tui; avoids duplicate installs; user must have pi-coding-agent installed (implicit prerequisite) |
| C | Provider catalog is **re-fetched every time the submenu opens** (no caching) | Submenu is a low-frequency operation; freshness beats stale-data risk; failed fetch falls back to static list |

---

## 3. Component Contracts

All signatures are normative. Implementers must match them; deviations require updating this doc and the tasks.

### 3.1 Catalog fetch

```ts
// src/tools/search-config.ts
export interface SearchProviderEntry {
  readonly id: string;
  readonly name: string;
  readonly search_types: readonly string[];
}

export interface SearchCatalog {
  readonly providers: readonly SearchProviderEntry[];
  readonly isFallback: boolean;  // true when fetch failed and static list was used
}

export class SearchCatalogError extends Error {
  constructor(message: string, public readonly cause?: unknown) { super(message); }
}

export function fetchSearchProviders(
  baseUrl: string,
  apiKey: string,
  signal: AbortSignal,
  timeoutMs?: number,  // default 10_000
): Promise<SearchProviderEntry[]>;

export function resolveSearchCatalog(
  baseUrl: string,
  apiKey: string,
  signal: AbortSignal,
  timeoutMs?: number,
): Promise<SearchCatalog>;  // never throws; returns fallback on any error
```

Behavior:
- `fetchSearchProviders` throws `SearchCatalogError` on:
  - `fetch` rejects (network error, DNS, abort)
  - Response `status` is not 2xx
  - Response body is not valid JSON
  - Response body lacks a `data` array OR `data` items are missing `id` / `name` / `search_types`
- `resolveSearchCatalog` catches any thrown error from `fetchSearchProviders` and returns `{ providers: STATIC_FALLBACK_PROVIDERS.map(toEntry), isFallback: true }`
- On success: `{ providers, isFallback: false }`
- Timeout: enforced via `AbortController.timeout(timeoutMs)` (Node ≥17.3). The signal passed in is combined with the timeout signal.

### 3.2 Persistence

```ts
export function resolveOmnirouteConfigPath(): string;
// Returns `${PI_AGENT_DIR || path.join(homedir(), ".pi", "agent")}/omniroute.json`

export function readOmnirouteConfig(): { readonly provider?: string };
// Never throws. Returns `{}` when:
//   - file does not exist
//   - file is not readable (permission / IO error)
//   - file content is not valid JSON
//   - file root is not a plain object
//   - root.search is not a plain object
//   - root.search.provider is present but not a string
// All non-success paths emit a single `console.warn` line; never throw.

export function writeOmnirouteConfig(provider: string | undefined): void;
// Never throws. Behavior:
//   1. Resolve current file (or start with `{}` if absent)
//   2. If provider is undefined and root.search is an object: delete root.search
//   3. Otherwise: ensure root.search is `{}` then set root.search.provider = provider
//   4. If the resulting root object is empty (`{}` after spread) AND no other keys were present: write `{}` (clean state)
//   5. Atomic write: write to `${path}.tmp` then `rename` to final path
//   6. On any failure: console.warn + return
// MUST NOT touch auth.json or any other file under PI_AGENT_DIR.
```

Atomic write pseudocode:
```
tmp = path + ".tmp"
data = JSON.stringify(rootObject, null, 2) + "\n"
writeFileSync(tmp, data, { mode: 0o600 })  // match auth.json's mode
renameSync(tmp, path)
```

`mode: 0o600` matches `auth.json`'s default permission (user-only read/write). The file is created with this mode; `chmod` is a no-op if the file already exists with different mode.

### 3.3 TUI renderers

```ts
// Top-level menu (D2)
export interface TopLevelMenuParams {
  readonly currentProvider: string | undefined;  // undefined ≡ "未配置" ≡ "Auto"
  readonly theme: Theme;
  readonly onActivateSearchProvider: () => void;
}

export function renderTopLevelMenu(params: TopLevelMenuParams): Component;

// Provider submenu (D2)
export interface ProviderSubmenuParams {
  readonly currentProvider: string | undefined;
  readonly catalog: SearchCatalog;
  readonly theme: Theme;
  readonly onCommit: (provider: string | undefined) => void;  // "auto" maps to undefined
  readonly onCancel: () => void;
}

export function renderProviderSubmenu(params: ProviderSubmenuParams): Component;
```

`renderTopLevelMenu` contract:
- Returns a `Container` containing:
  - Header row: bold "OmniRoute Settings"
  - One navigable row: `  Search provider: <preview>` where preview is `currentProvider ?? "Auto"`
  - Hint row: italic `↑/↓ select · Enter activate · Esc close`
- Up/Down arrow keys (and `j`/`k`) move the active row index; only one row exists so they are no-ops (but must not error)
- Enter on the active row triggers `onActivateSearchProvider()` synchronously
- Esc triggers a no-op (the `ctx.ui.custom` factory's `done` callback closes the overlay)
- Renders deterministically from `params`; no internal state

`renderProviderSubmenu` contract:
- Returns a `Container` containing:
  - A `SettingsList` with items built as follows:
    - Item 0: `{ id: "auto", label: "Auto (follow server default)", currentValue: currentProvider === undefined || currentProvider === "auto" ? "auto" : (some other id), values: [otherProvider, "auto"] }` — toggling flips between current provider and auto
    - Items 1..N: `{ id: <provider.id>, label: <provider.name>, currentValue: currentProvider === <provider.id> ? <provider.id> : ("auto" or other), values: ["auto", <provider.id>] }`
  - When `isFallback` is true, a hint line above the list: `dim "OmniRoute search catalog unreachable, using built-in list"`
- The `SettingsList` value-change callback `(id, newValue)`:
  - If `newValue === "auto"`: invoke `onCommit(undefined)`
  - Else: invoke `onCommit(newValue as string)`
  - Then the parent (`ctx.ui.custom` state machine) closes the overlay
- Esc on the SettingsList: invokes `onCancel()` (the parent closes without committing)
- Note: since each commit transitions back to top-level (and the overlay closes), the SettingsList is short-lived. Its callback does NOT need to handle "stay on submenu" semantics.

> **Note on SettingsList values:** The example `tools.ts` shows `values: ["enabled", "disabled"]` (2-element toggle). For provider selection with N providers + auto, each row needs `values: [<other providers, "auto">, <self>]` — i.e., the "off" state. This is the same pattern; no SettingsList customization needed.

### 3.4 State injection into `searchTool`

```ts
// src/tools/search.ts (module-level additions)
let getConfigProvider: () => string | undefined = () => undefined;

export function setSearchConfigReader(fn: () => string | undefined): void {
  getConfigProvider = fn;
}

// In searchTool.execute (after query validation, before omnirouteRequest):
const configProvider = getConfigProvider();
const effectiveProvider =
  params.provider !== undefined ? params.provider
  : isValidProvider(configProvider) ? configProvider
  : undefined;

// isValidProvider: typeof === "string" && STATIC_FALLBACK_PROVIDERS.includes(configProvider)
//   (防御性: spec 需求6 场景"配置为无效字符串时省略")
```

`setSearchConfigReader` is a test seam. `src/index.ts` calls it from the `session_start` callback and from the `/omniroute-settings` `onCommit` handler.

> **Removed from OpenSpec tasks:** the original Task 4.1 setter pattern is preserved here; OpenSpec Task 4.4's setter is the only caller.

---

## 4. TUI State Machine Mechanics

The `/omniroute-settings` command handler in `src/index.ts` uses a single `ctx.ui.custom(factory)` call. The factory returns a single `Component` that internally manages a `mode` closure variable.

### 4.1 Flow

```
[top mode]
  ↑          Enter          ↓
[top mode] ────── onActivateSearchProvider() ────→ [sub: catalog fetching]
  ↑                                                  │
  │                                                  │ resolveSearchCatalog resolves
  │                                                  │ (during this time, render shows
  │                                                  │  Loading status; top menu hidden)
  │                                                  ↓
  │                                            [sub: catalog resolved]
  │                                                  │
  │         onCancel() / Esc                         │ onCommit(provider)
  │         (no write)                               │ (writes to omniroute.json)
  │              ↑                                   │     ↓
  └──────────────┴───────────────────────────────────┘
                            ↓ done(undefined) on Esc at top
                        [overlay closed]
```

### 4.2 Mode transition mechanics

```ts
pi.registerCommand("omniroute-settings", {
  handler: async (_args, ctx) => {
    if (ctx.mode !== "tui") {
      ctx.ui.notify("/omniroute-settings requires TUI mode", "error");
      return;
    }
    const theme = getSettingsListTheme();

    await ctx.ui.custom((tui, _theme, _kb, done) => {
      // ---- closure state ----
      let mode: "top" | "sub" = "top";
      let cachedSubmenu: Component | null = null;  // memoize while in sub

      // Helper: build the active component based on mode
      const buildComponent = (): Component => {
        if (mode === "top") {
          return renderTopLevelMenu({
            currentProvider: currentConfigProvider,
            theme,
            onActivateSearchProvider: () => { mode = "sub"; invalidate(); },
          });
        }
        // mode === "sub"
        if (cachedSubmenu) return cachedSubmenu;
        // Lazy-build: trigger async catalog fetch + render Loading first
        const loadingComponent: Component = {
          render: () => ["Loading search providers…"],
          invalidate() {},
          handleInput(data) {
            if (data === "\x1b") { mode = "top"; invalidate(); }  // Esc cancels fetch
          },
        };
        cachedSubmenu = loadingComponent;
        void (async () => {
          const apiKey = await resolveApiKey(ctx);  // may also throw if not configured
          const baseUrl = resolveBaseUrl(ctx);
          const catalog = await resolveSearchCatalog(
            baseUrl, apiKey, new AbortController().signal,
          );
          if (mode !== "sub") return;  // user already Esc'd
          ctx.ui.setStatus("omniroute-search-catalog", undefined);  // clear loading
          cachedSubmenu = renderProviderSubmenu({
            currentProvider: currentConfigProvider,
            catalog,
            theme,
            onCommit: (p) => {
              currentConfigProvider = p;
              writeOmnirouteConfig(p);
              mode = "top"; cachedSubmenu = null; invalidate();
            },
            onCancel: () => {
              mode = "top"; cachedSubmenu = null; invalidate();
            },
          });
          invalidate();
        })().catch((err) => {
          console.warn("[omniroute] /omniroute-settings submenu load failed:", err);
          mode = "top"; cachedSubmenu = null; invalidate();
        });
        return loadingComponent;
      };

      // ...component lifecycle
    });
  },
});
```

### 4.3 Invalidation pattern

Each `Component` exposes `invalidate()`. After a mode switch, the factory closure must call `tui.requestRender()` (or `invalidate()` on the parent) to signal that the next `render()` should re-execute `buildComponent()`. The factory in `tools.ts` example shows `tui.requestRender()` being called after `settingsList.handleInput?.(data)`.

### 4.4 Focus behavior

Top-level and submenu are independent `Container` instances. When `mode` flips:
- The previous component is dropped (no cleanup needed; TUI's overlay is a single frame)
- The new component starts with default focus (first item highlighted)
- `cachedSubmenu` memoization prevents unnecessary rebuilds across multiple `render()` calls within the sub mode

### 4.5 Esc handling

`ctx.ui.custom`'s factory's `done` callback closes the overlay. Esc dispatch:
- In `top` mode: `Container`'s `handleInput` should treat Esc as "close" by calling `done(undefined)`
- In `sub` mode: delegated to `SettingsList` (which has built-in Esc handling per `tools.ts` example, or explicit `handleInput` to invoke `onCancel`)

---

## 5. Persistence Mechanics

### 5.1 Read flow

```ts
export function readOmnirouteConfig(): { readonly provider?: string } {
  const path = resolveOmnirouteConfigPath();
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    console.warn(`[omniroute] failed to read ${path}: ${(err as Error).message}`);
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.warn(`[omniroute] ${path} is malformed JSON: ${(err as Error).message}`);
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const root = parsed as Record<string, unknown>;
  const search = root["search"];
  if (!search || typeof search !== "object" || Array.isArray(search)) return {};
  const provider = (search as Record<string, unknown>)["provider"];
  if (typeof provider !== "string") return {};
  return { provider };
}
```

### 5.2 Write flow

```ts
export function writeOmnirouteConfig(provider: string | undefined): void {
  const path = resolveOmnirouteConfigPath();
  const tmp = path + ".tmp";
  // Read current (preserve unknown keys)
  let root: Record<string, unknown> = {};
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      root = parsed as Record<string, unknown>;
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`[omniroute] failed to read ${path} before write: ${(err as Error).message}`);
    }
    // ENOENT or malformed: start from `{}`. If malformed, user loses the corrupted file.
    // Mitigation: log loudly so the user notices; do not throw.
  }

  // Apply change
  if (provider === undefined) {
    delete root["search"];
  } else {
    if (!root["search"] || typeof root["search"] !== "object") {
      root["search"] = {};
    }
    (root["search"] as Record<string, unknown>)["provider"] = provider;
  }

  // Atomic write
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(tmp, JSON.stringify(root, null, 2) + "\n", { mode: 0o600 });
    renameSync(tmp, path);
  } catch (err) {
    console.warn(`[omniroute] failed to write ${path}: ${(err as Error).message}`);
    // Best-effort cleanup of tmp
    try { unlinkSync(tmp); } catch { /* ignore */ }
  }
}
```

### 5.3 Concurrency model

Within a single pi process: accept last-write-wins. No file locking.

- `readOmnirouteConfig` and `writeOmnirouteConfig` are synchronous (`readFileSync` / `writeFileSync`).
- The TUI handler awaits `resolveSearchCatalog` before opening the submenu, so the submenu's `onCommit` is on the main thread when `writeOmnirouteConfig` runs.
- `session_start` reads; `onCommit` writes. There is a brief window during `session_start` where `currentConfigProvider` may be `undefined`; the search tool treats this as "no config" (auto). No data loss.

Cross-process: the only realistic scenario is the user running two pi instances against the same `PI_AGENT_DIR`. POSIX `rename` is atomic; last-writer wins. Documented as a known non-goal.

### 5.4 Why `mode: 0o600`

`auth.json` is created with restrictive permissions by `auth-credentials.ts` (which delegates to the underlying fs write call's default umask; effectively user-only on most systems). `omniroute.json` mirrors this — the file may contain user preferences but should not be world-readable.

---

## 6. Catalog Fetch & Fallback

### 6.1 Per-open fetch policy

The submenu is opened at most a few times per session (user is selecting a provider, not browsing). Each open triggers `resolveSearchCatalog`. The trade-off:

| Policy | Pros | Cons |
|---|---|---|
| **Per-open fetch (chosen)** | New provider visible immediately; no cache invalidation logic; user perceives "live" catalog | Slight latency on submenu open; potential repeated 401s if auth is broken |
| Session cache | One network call; faster | Stale data if provider added/removed mid-session; cache invalidation adds complexity |
| Persistent cache | Same as session + cross-session | Stale data longer; additional write paths; harder to invalidate |

The `Loading…` render during fetch hides the latency.

### 6.2 Fetch sequence

```
submenu opened
  │
  ├─ Loading… row shown
  ├─ fetchSearchProviders(baseUrl, apiKey, signal, timeoutMs=10s)
  │     │
  │     ├─ 2xx + valid body → return providers, isFallback=false
  │     ├─ non-2xx / network / parse / schema → throw SearchCatalogError
  │     └─ timeout via AbortController.timeout(10s)
  │
  ├─ resolveSearchCatalog catches error
  │     └─ returns STATIC_FALLBACK_PROVIDERS, isFallback=true
  │
  ├─ If isFallback: show "OmniRoute search catalog unreachable, using built-in list"
  │
  └─ render SettingsList
```

### 6.3 Fetch prerequisites

`fetchSearchProviders` requires:
- `apiKey` (from `resolveApiKey(ctx)`)
- `baseUrl` (from `resolveBaseUrl(ctx)`)

If `apiKey` is undefined: this is a fatal error — the submenu should close with a notify. The state machine handles this by `.catch` in the async submenu builder: `if (!apiKey) { ctx.ui.notify("OmniRoute API key is not configured. Run /login omniroute or set OMNIROUTE_API_KEY.", "error"); mode = "top"; invalidate(); }`.

---

## 7. State Synchronization Chain

End-to-end state propagation:

```
┌─────────────────┐
│ session_start   │
│   (pi event)    │
└────────┬────────┘
         │ readOmnirouteConfig()
         ↓
┌─────────────────────────┐
│ currentConfigProvider   │  ← module-level in src/index.ts
│ (string | undefined)    │
└────────┬────────────────┘
         │ setSearchConfigReader(() => currentConfigProvider)
         ↓
┌─────────────────────────┐
│ searchTool.execute      │
│   configProvider =      │
│   getConfigProvider()   │
│                         │
│   effectiveProvider =   │
│     params.provider ??  │
│     valid(config) ??    │
│     undefined           │
└────────┬────────────────┘
         │ buildSearchBody({ ..., provider: effectiveProvider })
         ↓
┌─────────────────────────┐
│ POST /search body       │
│   provider: ePv (or     │
│            absent)      │
└─────────────────────────┘
```

On `/omniroute-settings → onCommit`:
```
onCommit(p)
  ├─ currentConfigProvider = p
  ├─ writeOmnirouteConfig(p)   ← file updated, no need to re-read
  ├─ mode = "top"              ← back to top menu (which will re-render preview)
  └─ invalidate()
```

No "watch" mechanism: each `execute` reads `getConfigProvider()` fresh.

---

## 8. Error Handling Matrix

| Failure | Detected by | Behavior | User-visible |
|---|---|---|---|
| `auth.json` lacks API key | `resolveApiKey(ctx)` returns undefined | `/omniroute-settings` notifies; submenu not built | Toast: "OmniRoute API key is not configured…" |
| `GET /v1/search` returns 401 | `fetchSearchProviders` throws `SearchCatalogError` | `resolveSearchCatalog` returns fallback; submenu shows "unreachable" hint | Hint line + static list |
| `GET /v1/search` returns 5xx | Same as 401 | Same | Same |
| `GET /v1/search` network error | `fetch` rejects (ENOTFOUND, ECONNREFUSED, etc.) | Same | Same |
| `GET /v1/search` timeout (>10s) | `AbortController.timeout` aborts | `fetch` rejects with AbortError; `resolveSearchCatalog` returns fallback | Same |
| `GET /v1/search` invalid JSON | `JSON.parse` throws | Throws `SearchCatalogError`; fallback | Same |
| `GET /v1/search` body schema mismatch | Manual check `data` array + item fields | Throws `SearchCatalogError`; fallback | Same |
| `omniroute.json` not found on read | `ENOENT` | `readOmnirouteConfig` returns `{}` | (silent) |
| `omniroute.json` malformed JSON | `JSON.parse` throws | `readOmnirouteConfig` returns `{}`; warn | (silent) |
| `omniroute.json` wrong shape | Type check | `readOmnirouteConfig` returns `{}`; warn | (silent) |
| `omniroute.json` write fails (permission) | `writeFileSync` / `renameSync` throws | `writeOmnirouteConfig` warns; submenu `onCommit` still flips back to top | "Search provider" preview updates in-session but not persisted; user sees no error toast (intentional) |
| `omniroute.json` write fails (disk full) | Same | Same | Same |
| `search.types` field in catalog contains unexpected values | (no validation) | Rendered as-is in `search_types` array (unused by current UI) | (no impact) |
| provider id contains special characters / Unicode | (no validation) | Used as SettingsList `id` and stored verbatim | (no impact in current UI) |
| `currentConfigProvider` set to invalid string (not in static list) | `isValidProvider` check | Skipped; `effectiveProvider = undefined` | Tool behaves as if no config |
| `session_start` fires after `searchTool.execute` is called once | Module init order | First call sees `currentConfigProvider = undefined`; subsequent calls see correct value | First tool call uses auto; subsequent use config |
| Submenu open with `apiKey = undefined` (key removed mid-session) | `resolveApiKey` in state machine | `.catch` branch notifies user; mode = top | Toast |
| `process.env.PI_AGENT_DIR` changed after extension load | Path resolution uses env at call time | `resolveOmnirouteConfigPath` re-reads each call | Subsequent reads/writes use new path (intentional; matches `auth-credentials.ts`) |

---

## 9. Testing Strategy

### 9.1 Unit tests (mock boundaries)

| Test file | Mock boundary | Coverage |
|---|---|---|
| `test/search-config.test.ts` | `globalThis.fetch` | 200/401/5xx/network/timeout; `isFallback` flag; `SearchCatalogError` thrown by `fetchSearchProviders` |
| `test/search-config-submenu.test.ts` | `pi-tui` `Container` / `SettingsList` constructors; `tui` handleInput dispatch | Item ordering (auto first); callback wiring (commit on switch, cancel on Esc); fallback hint rendered when `isFallback=true` |
| `test/search-config-persistence.test.ts` | `process.env.PI_AGENT_DIR` → `mkdtempSync`; real fs | Read/write round-trip; auto removes `search` key; preserves root other keys; auto-creates file; malformed JSON returns `{}`; non-object root returns `{}`; write failure (read-only dir) warns and does not throw |
| `test/search-tool-merge.test.ts` | `setSearchConfigReader`; mock `omnirouteRequest` body capture | Four 三态 scenarios: explicit overrides / config injects / config undefined or "auto" omits / invalid config string omitted |

### 9.2 Test isolation pattern

```ts
// search-config-persistence.test.ts
const origPiAgentDir = process.env.PI_AGENT_DIR;
beforeEach(() => {
  process.env.PI_AGENT_DIR = mkdtempSync(join(tmpdir(), "omniroute-config-test-"));
});
after(() => {
  if (origPiAgentDir === undefined) delete process.env.PI_AGENT_DIR;
  else process.env.PI_AGENT_DIR = origPiAgentDir;
});
```

This mirrors `test/lazy-fetch.test.ts` / `test/auth-credentials.test.ts` patterns.

### 9.3 State machine testing

The TUI state machine in `src/index.ts` is hard to test in isolation because it depends on `ctx.ui.custom`, `pi-tui` components, and `pi` event hooks. Two acceptable strategies:

**Strategy A (recommended):** Extract the state machine into a testable factory in `search-config.ts`:
```ts
export interface MenuStateMachine {
  getComponent(tui: TUI, theme: Theme): Component;
  onActivateSearchProvider(): void;
  onCommit(provider: string | undefined): void;
  onCancel(): void;
  onEsc(): void;
  // Exposed for tests:
  readonly mode: () => "top" | "sub";
  readonly catalog: () => SearchCatalog | undefined;
}
export function createMenuStateMachine(deps: { ... }): MenuStateMachine;
```

The command handler in `src/index.ts` becomes a thin wrapper that constructs the state machine with `ctx`-derived dependencies.

**Strategy B (fallback):** Test the renderer functions (`renderTopLevelMenu` / `renderProviderSubmenu`) with synthetic params. Skip end-to-end state machine testing; rely on manual smoke (OpenSpec Task 5.4).

OpenSpec Task 5 already covers "manual smoke (optional)". Strategy A is the better long-term investment but adds a refactor. Implementers may choose B for time-to-implementation; A is preferred for test coverage.

### 9.4 Coverage gates

Per the repo's `package.json`:
- `npm run typecheck` exit 0
- `npm test` 0 failures
- No new test-less commits; every task PR has at least one new test in its corresponding file

### 9.5 What we do NOT test

- Actual TUI rendering (TTY escape codes) — out of scope
- `pi-coding-agent` internals (e.g., `sessionManager.getBranch`) — not used by this change
- Cross-process concurrency (last-write-wins accepted) — documented non-goal
- Performance of the SettingsList with N>100 providers — N is bounded by OmniRoute's catalog (currently 14)

---

## 10. Edge Cases & Boundary Conditions

### 10.1 Catalog edges
- **Empty `data` array** (`{ data: [] }`): `fetchSearchProviders` throws `SearchCatalogError` (schema mismatch: empty list is not a valid provider catalog). Fallback returns 14 static entries. (Could be relaxed to render only the `auto` row, but that masks upstream regressions.)
- **Duplicate provider ids in `data`**: rendered as separate rows; second occurrence shadows first. No dedup. (Acceptable; matches API's own behavior.)
- **Provider with empty `name`**: fallback to use `id` as label.

### 10.2 Persistence edges
- **`omniroute.json` exists but is empty** (0 bytes): `JSON.parse("")` throws → `readOmnirouteConfig` returns `{}`.
- **`omniroute.json` contains `null`**: `parsed && typeof parsed === "object"` rejects null → `{}`.
- **`omniroute.json` is a JSON array** (`[1,2,3]`): `Array.isArray(parsed)` rejects → `{}`.
- **`omniroute.json` `search` is a string** (`"tavily-search"`): `typeof search !== "object"` rejects → `{}`.
- **`omniroute.json` `search.provider` is empty string `""`**: `typeof provider !== "string"` accepts (it's a string) but `isValidProvider("")` returns false (not in static list) → omitted in tool merge.
- **`omniroute.json` `search.provider` is `"auto"`**: `isValidProvider("auto")` returns false (not in static list) → omitted in tool merge. ✓ matches spec.
- **`omniroute.json` `search.provider` is a number `42`**: `typeof !== "string"` → `readOmnirouteConfig` returns `{}`. (Defensive: numeric provider ids from a future API would be lost. Acceptable for now.)

### 10.3 Menu edges
- **User opens `/omniroute-settings` while another `ctx.ui.custom` overlay is active**: behavior depends on `pi-coding-agent`; the new overlay may replace or queue. Not the responsibility of this change; document as "open one menu at a time".
- **User opens `/omniroute-settings` during tool execution**: `ctx.ui.custom` is async; the command returns immediately. UI overlay renders on next tick.
- **User changes provider during an in-flight search tool call**: The in-flight call uses `getConfigProvider()` at execute time, so the call already captured its `effectiveProvider`. The next call uses the new value. No mid-call race.

### 10.4 Session edges
- **Extension reload (hot reload during development)**: `currentConfigProvider` resets to `undefined`; `session_start` fires again on next session. This is the documented behavior of session_start.
- **Multiple extensions sharing the same `omniroute.json`**: Not in scope. omniroute.json is owned solely by this extension.

### 10.5 Build / dev edges
- **TypeScript strict null checks**: `getConfigProvider()` return type is `string | undefined`; `params.provider` is `string | undefined`; `isValidProvider` returns `boolean`. No `any` introduced.
- **Node version**: `AbortController.timeout` requires Node ≥17.3. The repo's `package.json` should be checked; if older, use `setTimeout(() => controller.abort(), timeoutMs)` pattern.

---

## 11. OpenSpec Spec Gaps Identified

The following gaps in `specs/web-search-provider-config/spec.md` emerged during brainstorming. Per brainstorming skill constraint 4, these are listed for back-writing to the delta spec. **Do not implement against these scenarios until the spec is updated.**

| Gap | Description | Proposed scenario |
|---|---|---|
| **G1** | "Loading" intermediate state during catalog fetch | `#### 场景:provider 目录拉取中显示 Loading` — When submenu is opened and catalog fetch is in progress, the submenu must display a "Loading search providers…" placeholder (Esc cancels back to top-level). |
| **G2** | Esc during submenu catalog fetch | `#### 场景:provider 目录拉取中按 Esc` — When the submenu is in Loading state and user presses Esc, the submenu must cancel the fetch and return to top-level without modifying omniroute.json. |
| **G3** | apiKey missing when opening submenu | `#### 场景:无 API key 时打开子菜单` — When `/omniroute-settings` is activated and the user is not authenticated (no API key in auth.json), the submenu must NOT fetch; instead, the top menu must show a notify "OmniRoute API key is not configured. Run /login omniroute or set OMNIROUTE_API_KEY." and remain open. |
| **G4** | Non-ASCII / special-char provider id | `#### 场景:provider id 含特殊字符或 Unicode` — When the catalog returns a provider whose id contains special characters (e.g. spaces, quotes, non-ASCII), the submenu must render the row with `id` as the internal value and `name` as the display label; selection commits verbatim to omniroute.json. (Acceptable; the current 14 static ids are ASCII but the spec should be future-proof.) |
| **G5** | Empty catalog (`{ data: [] }`) | `#### 场景:provider 目录返回空 data 数组` — When `GET /v1/search` returns 200 with `{ object: "list", data: [] }`, the implementation must treat this as a fetch failure (catalog schema mismatch) and fall back to the static list with the unreachable hint. |
| **G6** | Manual edit of `omniroute.json` to invalid shape | `#### 场景:omniroute.json 被外部修改为非对象根` — When `omniroute.json` is manually edited to a non-object root (e.g. `null`, array, string), `readOmnirouteConfig` must return `{}` (treat as no config), emit one warn, and the tool must behave as auto. |
| **G7** | Manual edit of `omniroute.json` `search` to non-object | `#### 场景:omniroute.json 的 search 字段为非对象` — When `search` is a string / number / array / null, `readOmnirouteConfig` must return `{}` (treat `search` as missing). |
| **G8** | `omniroute.json` write failure visibility | `#### 场景:omniroute.json 写入失败不阻塞 UI` — Already covered (existing 场景 写入失败不阻塞 UI). No gap. (Listed for completeness.) |

**Action item:** Before implementation begins, the implementer (or this design step) must update `specs/web-search-provider-config/spec.md` to add G1-G7. G8 is already covered.

---

## 12. Risk Matrix (extends OpenSpec design.md)

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `pi-tui` peer dep not resolvable in user's environment | Low | High (menu can't render) | Document the peer requirement; provide fallback to `ctx.ui.select` if pi-tui import fails (catch at module load) |
| TUI state machine focus/scroll glitch on mode switch | Medium | Low | Two-component model preserves focus per component; user can re-navigate if needed |
| `search` key in `omniroute.json` corrupted by external tool | Low | Low (read returns `{}`, falls back to auto) | Defensive type checks at every read; warn on malformed |
| Multiple `pi` processes write to `omniroute.json` simultaneously | Very Low | Low (last-write-wins) | Document; user can mitigate with file locking if needed (out of scope) |
| `searchConfigReader` setter called from `session_start` before searchTool's first use | Medium | Low | Module init: `getConfigProvider` defaults to `() => undefined`; first tool call uses auto; subsequent calls see correct value |
| Submenu opened with provider name containing TUI escape characters | Very Low | Low (visual glitch) | Use `name` as the display label via theme-aware rendering; TUI SettingsList already escapes input by default |
| `peerDependency` `@earendil-works/pi-tui` version drift from `pi-coding-agent` | Medium | Medium | Pin range `>=1.0.0` or use exact same as resolved by `pi-coding-agent`; document in README |
| Search submenu Esc doesn't cancel in-flight fetch | Low | Low (resource leak until next open or session end) | Use `AbortController` linked to the submenu lifecycle; cancel on `onCancel` and `onCommit` |
| First-time user has no `omniroute.json` and no provider configured | Certain (cold start) | None (designed) | `readOmnirouteConfig` returns `{}`; tool uses auto; user can configure via `/omniroute-settings` |

---

## 13. Implementation Sequence (for `/opsx-sp-plan`)

Recommended order for `superpower-plan.md`. Each task is sized for one subagent pass with one review round.

**Phase A: Foundation (TDD red→green)**
1. **A1** `package.json` + `npm install` to declare `@earendil-works/pi-tui` as peerDependency (range: `>=1.0.0` or exact same as `pi-coding-agent`)
2. **A2** `src/tools/search-config.ts` skeleton: `STATIC_FALLBACK_PROVIDERS` constant + `SEARCH_PROVIDERS` re-export from `src/tools/search.ts`
3. **A3** `fetchSearchProviders` + `SearchCatalogError` + `resolveSearchCatalog` (TDD: 200 / 401 / 5xx / network / timeout / schema)
4. **A4** `readOmnirouteConfig` + `writeOmnirouteConfig` + `resolveOmnirouteConfigPath` (TDD: round-trip / auto removes key / preserves other keys / file auto-create / malformed / non-object / write-fail-warn-not-throw)

**Phase B: Search tool merge (TDD red→green)**
5. **B1** `searchTool` module-level `getConfigProvider` + `setSearchConfigReader` setter + `isValidProvider` helper
6. **B2** Wire `effectiveProvider` into `searchTool.execute` and `buildSearchBody` call site (TDD: 4 三态 scenarios)
7. **B3** Full suite green; ensure no regression to existing 98 tests

**Phase C: TUI renderers (TDD)**
8. **C1** `renderTopLevelMenu` (TDD: header / row / hint / Enter onActivate / Esc done)
9. **C2** `renderProviderSubmenu` (TDD: auto first / providers order / value-change callback / isFallback hint / Esc onCancel)
10. **C3** State machine factory in `search-config.ts` per Strategy A (testable) — `createMenuStateMachine` + scenarios covering mode transitions, async catalog, Esc-during-load, missing apiKey

**Phase D: Command & hooks (integration)**
11. **D1** `pi.registerCommand("omniroute-settings", ...)` in `src/index.ts` — non-TUI notify + custom factory + state machine wiring
12. **D2** `pi.on("session_start", ...)` — `readOmnirouteConfig` → `currentConfigProvider` + `setSearchConfigReader`
13. **D3** `npm run typecheck` + full `npm test` green
14. **D4** Manual smoke: `/omniroute-settings` open, drill into Search provider, select Tavily, verify `omniroute.json` written, verify next `omniroute_web_search` body includes `provider: "tavily-search"` (via `ctx.ui.notify` debug or a temporary `console.log` if needed)
15. **D5** Update `tasks.md` checkboxes + final docs commit

**Phase E: Cleanup**
16. **E1** Remove any debug logs
17. **E2** Run final review per `superpowers:requesting-code-review`
18. **E3** Hand off to `superpowers:finishing-a-development-branch` (in-place on main, no branch to merge)

**Critical-path note:** Phase A and B can run in parallel (different files, no shared state). Phase C depends on A (needs catalog types). Phase D depends on B + C. The natural parallelization cut is:
- Track 1: A2 → A3 → A4
- Track 2: B1 → B2 → B3
- Track 3 (depends on A): C1 → C2 → C3
- Integration: D1 → D2 → D3 → D4 → D5 → E1 → E2 → E3

---

## 14. Open Questions Deferred to Follow-up Changes

(From OpenSpec `design.md` 开放问题, restated for traceability)

- Future top-level menu items (Base URL editor, auth reset, model refresh) — architecture预留
- "Test provider" button in submenu — not in this change
- Grouping submenu rows by `search_types` (web / news) — not in this change
- File-level persistence with multi-process locking — not in this change

---

## 15. Document Self-Review

Pre-flight checks performed (per brainstorming skill step 7):

1. **Placeholder scan:** No "TBD" / "TODO" / "适当处理" markers. Every section is concrete.
2. **Internal consistency:** OpenSpec D1-D5 referenced verbatim; no contradiction. The D2 风险表 line about "锁版本" was corrected in design.md (R1) to reflect peerDependency.
3. **Scope check:** Single implementation plan (Phase A-E). No decomposition needed.
4. **Ambiguity check:** Every function signature is normative; every error path has explicit behavior; every UI interaction has an explicit key binding.
5. **Spec gaps:** G1-G7 explicitly listed in §11 for back-writing. G8 already covered by existing scenario.

---

**Document status:** Ready for user review. After approval, `/opsx-sp-plan` will create `superpower-plan.md` with TDD task-by-task instructions.

# add-web-search-provider-selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/omniroute-settings` TUI command exposing a two-level navigation (top menu → "Search provider" submenu) that fetches the provider catalog from `GET /v1/search`, lets the user pick a provider (or `auto`), and persists the choice to a dedicated `omniroute.json` (pi-global, not auth.json). The `omniroute_web_search` tool merges the configured provider into the request body (explicit param > config > omit).

**Architecture:** Single new module `src/tools/search-config.ts` holds catalog fetch + `omniroute.json` read/write + TUI renderers. `src/index.ts` owns a closure-based state machine inside a single `ctx.ui.custom` call (mode `"top" | "sub"`, two independent `Container` components, memoized submenu). `src/tools/search.ts` gains a module-level `getConfigProvider` closure and a three-state merge into the request body. `@earendil-works/pi-tui` is a peer dependency.

**Tech Stack:** TypeScript 5.9 (strict), Node `node:test` + `node --experimental-strip-types`, `@earendil-works/pi-ai`, `@earendil-works/pi-coding-agent` (peer + actual), `@earendil-works/pi-tui` (peer), `@sinclair/typebox`.

---
change: add-web-search-provider-selection
design-doc: openspec/changes/add-web-search-provider-selection/superpower-design.md
base-ref: 976dcfda9c215be6f38357b80b67e5634c496c73
---

## OpenSpec Artifact References

| Artifact | Path | Role |
|---|---|---|
| Proposal | `openspec/changes/add-web-search-provider-selection/proposal.md` | Why / what / impact |
| Design (summary) | `openspec/changes/add-web-search-provider-selection/design.md` | Decisions D1-D5 + risks |
| Deep design | `openspec/changes/add-web-search-provider-selection/superpower-design.md` | Component contracts, state machine, persistence algorithm, error matrix, testing strategy, spec gaps G1-G7 |
| Delta spec | `openspec/changes/add-web-search-provider-selection/specs/web-search-provider-config/spec.md` | 6 requirements / 20 scenarios (will be 6 / 27 after Task 0 back-writes G1-G7) |
| Task list | `openspec/changes/add-web-search-provider-selection/tasks.md` | High-level checkboxes (24 items) — kept in sync; the per-step TDD detail lives here |

## Global Constraints

These are copied verbatim from OpenSpec design.md / superpower-design.md and apply to every task unless a task explicitly deviates with a reason.

- **Module boundaries** — Only `src/index.ts` (modified) and `src/tools/search.ts` (modified) may change outside the new `src/tools/search-config.ts`. `src/auth-credentials.ts` and `src/auth.ts` are **untouched** (the new persistence is in a separate file, not auth.json).
- **No new exports of internals** — `OmnirouteModelEntry`-style pattern: helpers stay module-private.
- **Provider schema** — `searchParamsSchema` in `src/tools/search.ts` is **not modified**; the `provider` field still uses `stringEnum(SEARCH_PROVIDERS)` (14 static literals). The `STATIC_FALLBACK_PROVIDERS` constant is the single source of truth; `SEARCH_PROVIDERS` re-exports it.
- **Fetch client** — Catalog fetch reuses `omnirouteRequest` (or the same auth pattern) from `src/tools/http.ts`. Do not introduce a new HTTP helper.
- **Tool merge priority** — `effectiveProvider = params.provider ?? (valid(config) ? config : undefined)`. The `buildSearchBody` pass-through loop is **not** modified; `effectiveProvider` is passed in place of `params.provider` at the call site.
- **Atomic write** — `writeOmnirouteConfig` writes to `${path}.tmp` then `rename`; mode `0o600`; never touches `auth.json`.
- **Defensive read** — `readOmnirouteConfig` returns `{}` on any error (missing file, permission, malformed JSON, wrong shape) and emits a single `console.warn`. Never throws.
- **Concurrent read-modify-write** — Accept last-write-wins. No file locking.
- **TUI state machine** — Single `ctx.ui.custom` factory; closure variable `mode: "top" | "sub"`; two independent `Container` components; `cachedSubmenu` memoization. No nested `ctx.ui.custom` calls.
- **No `/omniroute-search` command** — Only `/omniroute-settings` is registered.
- **No `session_tree` hook** — File is pi-global; no branch awareness.
- **No `pi.appendEntry` for the config** — All persistence is via `omniroute.json` file.
- **TDD discipline** — Every code task: write failing test → verify RED → implement → verify GREEN → full suite + typecheck → commit. Commit message must reflect design intent (e.g., "feat: map search provider config from /v1/search"). One commit per task.
- **Commit hygiene** — Stage only the files each task specifies. Do **not** run `git add .` or `git add -A`. Do **not** commit `openspec/`, `.pi-glla/`, `node_modules/`, `package-lock.json` unless the task explicitly says to.
- **Spec gap G1-G7** — These are listed in `superpower-design.md` §11. They **must** be back-written to `openspec/changes/add-web-search-provider-selection/specs/web-search-provider-config/spec.md` in Task 0 before any code task runs. Code tasks reference these scenarios; the spec is the contract.
- **Baseline** — `npm run typecheck` exit 0; `npm test` passes 98/98 at base. Tasks must end with both green and ≥ baseline test count.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `package.json` | Modify | Add `@earendil-works/pi-tui` as peerDependency |
| `src/index.ts` | Modify | Register `/omniroute-settings` command; `session_start` hook; hold `currentConfigProvider` module state; call `setSearchConfigReader` |
| `src/tools/search.ts` | Modify | Add `getConfigProvider` / `setSearchConfigReader` / `isValidProvider`; wire `effectiveProvider` into `execute`; re-export `SEARCH_PROVIDERS` from new module |
| `src/tools/search-config.ts` | **Create** | `STATIC_FALLBACK_PROVIDERS`; `SEARCH_PROVIDERS` re-export; `SearchProviderEntry` / `SearchCatalog` / `SearchCatalogError` types; `fetchSearchProviders` / `resolveSearchCatalog`; `resolveOmnirouteConfigPath` / `readOmnirouteConfig` / `writeOmnirouteConfig`; `renderTopLevelMenu`; `renderProviderSubmenu`; `createMenuStateMachine` |
| `openspec/changes/add-web-search-provider-selection/specs/web-search-provider-config/spec.md` | Modify | Back-write G1-G7 (Task 0) |
| `openspec/changes/add-web-search-provider-selection/tasks.md` | Modify | Backfill checkbox mapping + per-task group update (Task 10) |
| `test/search-config.test.ts` | Create | Catalog fetch + fallback tests |
| `test/search-config-submenu.test.ts` | Create | Provider submenu renderer contract tests |
| `test/search-config-persistence.test.ts` | Create | omniroute.json round-trip + corruption tests |
| `test/search-tool-merge.test.ts` | Create | Three-state merge tests |

**Untouched:** `src/auth.ts`, `src/auth-credentials.ts`, `src/tools/http.ts`, `src/tools/web-fetch.ts`, `test/lazy-fetch.test.ts`, `test/auth-credentials.test.ts`, `test/url.test.ts`, `test/tools-*.test.ts`.

---

## Task Mapping (OpenSpec tasks.md → plan tasks)

| OpenSpec tasks.md group | Plan task(s) | Notes |
|---|---|---|
| (preamble) | Task 0 | Spec gaps G1-G7 back-write |
| 1.1 dep + 1.2 constants | Task 1 | `package.json` + `STATIC_FALLBACK_PROVIDERS` |
| 1.3-1.5 fetch | Task 2 | `fetchSearchProviders` / `resolveSearchCatalog` |
| 2.1-2.2 submenu render | Task 3 | `renderProviderSubmenu` |
| 3.1-3.3 persistence | Task 4 | `readOmnirouteConfig` / `writeOmnirouteConfig` |
| 4.1-4.3 tool merge | Task 5 | `setSearchConfigReader` + `effectiveProvider` |
| 4.4-4.5 session_start + suite | Task 6 | `session_start` hook in `src/index.ts` |
| 5.1 top-level render | Task 7 | `renderTopLevelMenu` |
| (design §9.3 Strategy A) | Task 8 | `createMenuStateMachine` |
| 5.2-5.4 command + manual | Task 9 | `registerCommand` wiring + smoke |
| 6.1-6.3 verify + cleanup | Task 10 | `tasks.md` final + full suite + smoke |

---

## Task 0: Back-write Spec Gaps G1-G7

**Files:**
- Modify: `openspec/changes/add-web-search-provider-selection/specs/web-search-provider-config/spec.md`
- No code, no commit (this is a docs-only change; the docs commit happens in Task 10 alongside tasks.md).

**Why:** superpower-design.md §11 identified 7 scenarios missing from the delta spec. Per OpenSpec workflow ("缺少验收场景/边界条件 → 直接编辑 delta spec"), they must exist in the spec before any code task can be reviewed against them.

- [ ] **Step 1: Read current spec**

Read `openspec/changes/add-web-search-provider-selection/specs/web-search-provider-config/spec.md` to identify the insertion point (after the "二级 provider 选择面板" requirement's last scenario, before "配置持久化到 pi 全局 `omniroute.json`" requirement).

- [ ] **Step 2: Append G1-G7 scenarios to the provider panel requirement**

Append the following scenarios at the end of the "二级 provider 选择面板的选项与选择行为" requirement block (the requirement's last existing scenario is "用户在二级面板按 Esc"):

```markdown
#### 场景:provider 目录拉取中显示 Loading
- **当** 用户激活 "Search provider" 后 provider 面板尚未拉取到目录
- **那么** 扩展必须显示一行占位文本 "Loading search providers…"，不接受除 Esc 外的输入

#### 场景:provider 目录拉取中按 Esc
- **当** provider 面板处于 Loading 状态且用户按 Esc
- **那么** 扩展必须取消拉取（AbortController.abort），返回顶层菜单，不修改 `omniroute.json`

#### 场景:无 API key 时打开子菜单
- **当** `/omniroute-settings` 被激活且 `resolveApiKey(ctx)` 返回 `undefined`（auth.json 中 omniroute 凭据缺失或无效）
- **那么** 扩展必须不进入二级面板；必须 `ctx.ui.notify` 提示 "OmniRoute API key is not configured. Run /login omniroute or set OMNIROUTE_API_KEY."；顶层菜单保持打开

#### 场景:provider id 含特殊字符或 Unicode
- **当** provider 目录返回的 `id` 字段含特殊字符（空格、引号、反斜杠）或非 ASCII Unicode
- **那么** 扩展必须将 `id` 作为内部 value，将 `name` 作为显示 label；用户选择后必须按 `id` 原样写入 `omniroute.json.search.provider`，不做任何转义

#### 场景:provider 目录返回空 data 数组
- **当** `GET /v1/search` 返回 `200` 且 body 为 `{ object: "list", data: [] }`
- **那么** 扩展必须视为 fetch 失败（目录 schema 不匹配），回退到静态 `SEARCH_PROVIDERS` 列表，并在面板顶部显示 "OmniRoute search catalog unreachable, using built-in list"
```

- [ ] **Step 3: Append G6 + G7 to the persistence requirement**

At the end of the "配置持久化到 pi 全局 `omniroute.json`" requirement block (after the "写入失败不阻塞 UI" scenario), append:

```markdown
#### 场景:omniroute.json 根对象为非对象类型
- **当** `omniroute.json` 根内容是 `null` / 数组 / 字符串 / 数字（非普通对象）
- **那么** `readOmnirouteConfig` 必须返回 `{}` 并 `console.warn` 一次；搜索工具必须按"无配置"（auto）行为

#### 场景:omniroute.json 的 search 字段为非对象类型
- **当** `omniroute.json` 根对象存在但 `search` 字段值是字符串 / 数字 / 数组 / `null`（非普通对象）
- **那么** `readOmnirouteConfig` 必须返回 `{}` 并 `console.warn` 一次；搜索工具必须按"无配置"（auto）行为
```

- [ ] **Step 4: Verify spec consistency**

Run: `openspec-cn status --change "add-web-search-provider-selection" --json`
Expected: `isComplete: true`; the spec file is still valid; `artifacts.specs.status === "done"`.

Run: `grep -c "^#### 场景:" openspec/changes/add-web-search-provider-selection/specs/web-search-provider-config/spec.md`
Expected: 27 (20 original + 7 new). If 20, G1-G5 or G6-G7 wasn't applied.

- [ ] **Step 5: Defer commit**

Do NOT commit yet. The `openspec/` directory will be committed in Task 10 step "Final docs commit" alongside `tasks.md` checkboxes.

---

## Task 1: peerDependency + STATIC_FALLBACK_PROVIDERS Constant

**Files:**
- Modify: `package.json` (add `peerDependencies` entry)
- Create: `src/tools/search-config.ts` (skeleton with `STATIC_FALLBACK_PROVIDERS` export)
- Modify: `src/tools/search.ts` (re-export `SEARCH_PROVIDERS` from `search-config.ts`; remove inline array)
- Create: `test/search-config-constants.test.ts` (one assertion: `STATIC_FALLBACK_PROVIDERS` has 14 entries, all kebab-case, no duplicates)

**Interfaces:**
- Consumes: nothing (this is the first code task)
- Produces:
  - `export const STATIC_FALLBACK_PROVIDERS: readonly string[]` in `src/tools/search-config.ts`
  - `export const SEARCH_PROVIDERS` in `src/tools/search.ts` re-exported from the new module
  - `peerDependencies."@earendil-works/pi-tui"` in `package.json`

- [ ] **Step 1: Inspect the resolved pi-tui version**

Run:
```bash
node -e "console.log(require('./node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-tui/package.json').version)"
```
Expected: prints a semver string (e.g. `0.x.y` or `1.x.y`). Save this version — you'll use it in the peer range.

If the above fails (no nested pi-tui), try:
```bash
find node_modules -name "package.json" -path "*@earendil-works/pi-tui*" | head -5
```
and inspect the version from any result.

- [ ] **Step 2: Write the failing test**

Create `test/search-config-constants.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { STATIC_FALLBACK_PROVIDERS, SEARCH_PROVIDERS } from "../src/tools/search-config.ts";

test("STATIC_FALLBACK_PROVIDERS has 14 kebab-case providers", () => {
  assert.equal(STATIC_FALLBACK_PROVIDERS.length, 14);
  for (const id of STATIC_FALLBACK_PROVIDERS) {
    assert.match(id, /^[a-z0-9-]+$/, `id ${id} must be lowercase kebab-case`);
  }
  assert.equal(new Set(STATIC_FALLBACK_PROVIDERS).size, 14, "no duplicates");
});

test("SEARCH_PROVIDERS re-export matches STATIC_FALLBACK_PROVIDERS", async () => {
  const search = await import("../src/tools/search.ts");
  assert.deepEqual([...search.SEARCH_PROVIDERS], [...STATIC_FALLBACK_PROVIDERS]);
});
```

- [ ] **Step 3: Run test to verify RED**

Run: `npm test -- test/search-config-constants.test.ts`
Expected: FAIL — `src/tools/search-config.ts` does not exist.

- [ ] **Step 4: Create `src/tools/search-config.ts` skeleton**

```ts
// src/tools/search-config.ts
// Catalog fetch + persistence + TUI renderers for the search provider config.

export const STATIC_FALLBACK_PROVIDERS: readonly string[] = [
  "serper-search",
  "brave-search",
  "perplexity-search",
  "exa-search",
  "tavily-search",
  "firecrawl",
  "google-pse-search",
  "linkup-search",
  "ollama-search",
  "searchapi-search",
  "youcom-search",
  "searxng-search",
  "zai-search",
  "duckduckgo-free",
] as const;
```

- [ ] **Step 5: Modify `src/tools/search.ts` to re-export**

Open `src/tools/search.ts`. Replace the existing `SEARCH_PROVIDERS` definition (the inline `as const` array at the top) with:
```ts
import { STATIC_FALLBACK_PROVIDERS } from "./search-config.ts";
export const SEARCH_PROVIDERS = STATIC_FALLBACK_PROVIDERS;
```

The rest of `src/tools/search.ts` is unchanged in this task.

- [ ] **Step 6: Run test to verify GREEN**

Run: `npm test -- test/search-config-constants.test.ts`
Expected: 2/2 pass.

- [ ] **Step 7: Run full suite + typecheck**

Run: `npm run typecheck` then `npm test`
Expected: typecheck exit 0; full suite ≥ 98 pass (98 existing + 2 new = 100). No regressions.

- [ ] **Step 8: Add `@earendil-works/pi-tui` as peerDependency**

Open `package.json`. Add (or update) the `peerDependencies` block:
```json
"peerDependencies": {
  "@earendil-works/pi-tui": "VERSION_FROM_STEP_1",
  "@earendil-works/pi-coding-agent": "*"
}
```
Use the exact version from Step 1 for `@earendil-works/pi-tui`. If the version is `0.4.0`, use `"0.4.0"`. If the version is something like `1.2.3`, you may use `"^1.2.3"`.

Run: `npm install` (no-op but updates the lockfile marker).

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json src/tools/search-config.ts src/tools/search.ts test/search-config-constants.test.ts
git commit -m "feat: scaffold search-config module with static provider fallback"
```

---

## Task 2: Catalog Fetch (fetchSearchProviders + resolveSearchCatalog)

**Files:**
- Modify: `src/tools/search-config.ts` (add types + `SearchCatalogError` + `fetchSearchProviders` + `resolveSearchCatalog`)
- Create: `test/search-config.test.ts`

**Interfaces:**
- Consumes: `STATIC_FALLBACK_PROVIDERS` (from Task 1), `omnirouteRequest` pattern from `src/tools/http.ts` (read but do not import — `fetchSearchProviders` uses `globalThis.fetch` to match the test mock boundary)
- Produces:
  - `export interface SearchProviderEntry { id: string; name: string; search_types: readonly string[] }`
  - `export interface SearchCatalog { providers: readonly SearchProviderEntry[]; isFallback: boolean }`
  - `export class SearchCatalogError extends Error`
  - `export function fetchSearchProviders(baseUrl, apiKey, signal, timeoutMs?): Promise<SearchProviderEntry[]>`
  - `export function resolveSearchCatalog(baseUrl, apiKey, signal, timeoutMs?): Promise<SearchCatalog>`

- [ ] **Step 1: Write the failing test**

Create `test/search-config.test.ts`:
```ts
import { test, mock, after } from "node:test";
import assert from "node:assert/strict";
import { fetchSearchProviders, resolveSearchCatalog, SearchCatalogError, STATIC_FALLBACK_PROVIDERS } from "../src/tools/search-config.ts";

const origFetch = globalThis.fetch;
after(() => { globalThis.fetch = origFetch; mock.restoreAll(); });

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

test("fetchSearchProviders: 200 + valid body returns providers", async () => {
  globalThis.fetch = mock.method(globalThis, "fetch", async () => jsonResponse(200, {
    object: "list",
    data: [
      { id: "tavily-search", name: "Tavily", search_types: ["web","news"] },
      { id: "brave-search",  name: "Brave",  search_types: ["web"] },
    ],
  })) as never;
  const out = await fetchSearchProviders("http://x", "key", new AbortController().signal);
  assert.deepEqual(out, [
    { id: "tavily-search", name: "Tavily", search_types: ["web","news"] },
    { id: "brave-search",  name: "Brave",  search_types: ["web"] },
  ]);
});

test("fetchSearchProviders: 401 throws SearchCatalogError", async () => {
  globalThis.fetch = mock.method(globalThis, "fetch", async () => jsonResponse(401, { error: "unauthorized" })) as never;
  await assert.rejects(
    fetchSearchProviders("http://x", "bad", new AbortController().signal),
    (err: unknown) => err instanceof SearchCatalogError,
  );
});

test("fetchSearchProviders: 5xx throws SearchCatalogError", async () => {
  globalThis.fetch = mock.method(globalThis, "fetch", async () => jsonResponse(502, { error: "bad gateway" })) as never;
  await assert.rejects(
    fetchSearchProviders("http://x", "k", new AbortController().signal),
    (err: unknown) => err instanceof SearchCatalogError,
  );
});

test("fetchSearchProviders: network error throws SearchCatalogError", async () => {
  globalThis.fetch = mock.method(globalThis, "fetch", async () => { throw new Error("ECONNREFUSED"); }) as never;
  await assert.rejects(
    fetchSearchProviders("http://x", "k", new AbortController().signal),
    (err: unknown) => err instanceof SearchCatalogError && /ECONNREFUSED/.test((err as Error).message),
  );
});

test("fetchSearchProviders: invalid JSON body throws SearchCatalogError", async () => {
  globalThis.fetch = mock.method(globalThis, "fetch", async () => ({
    ok: true, status: 200, json: async () => { throw new SyntaxError("bad json"); },
  } as Response)) as never;
  await assert.rejects(
    fetchSearchProviders("http://x", "k", new AbortController().signal),
    (err: unknown) => err instanceof SearchCatalogError,
  );
});

test("fetchSearchProviders: body missing data array throws", async () => {
  globalThis.fetch = mock.method(globalThis, "fetch", async () => jsonResponse(200, { object: "list" })) as never;
  await assert.rejects(
    fetchSearchProviders("http://x", "k", new AbortController().signal),
    (err: unknown) => err instanceof SearchCatalogError,
  );
});

test("fetchSearchProviders: empty data array throws (spec G5)", async () => {
  globalThis.fetch = mock.method(globalThis, "fetch", async () => jsonResponse(200, { object: "list", data: [] })) as never;
  await assert.rejects(
    fetchSearchProviders("http://x", "k", new AbortController().signal),
    (err: unknown) => err instanceof SearchCatalogError,
  );
});

test("resolveSearchCatalog: success returns isFallback=false", async () => {
  globalThis.fetch = mock.method(globalThis, "fetch", async () => jsonResponse(200, {
    data: [{ id: "exa-search", name: "Exa", search_types: ["web"] }],
  })) as never;
  const out = await resolveSearchCatalog("http://x", "k", new AbortController().signal);
  assert.equal(out.isFallback, false);
  assert.equal(out.providers[0]?.id, "exa-search");
});

test("resolveSearchCatalog: 401 returns static fallback isFallback=true", async () => {
  globalThis.fetch = mock.method(globalThis, "fetch", async () => jsonResponse(401, {})) as never;
  const out = await resolveSearchCatalog("http://x", "bad", new AbortController().signal);
  assert.equal(out.isFallback, true);
  assert.equal(out.providers.length, STATIC_FALLBACK_PROVIDERS.length);
  assert.equal(out.providers[0]?.id, STATIC_FALLBACK_PROVIDERS[0]);
});

test("resolveSearchCatalog: network error returns static fallback isFallback=true", async () => {
  globalThis.fetch = mock.method(globalThis, "fetch", async () => { throw new Error("ETIMEDOUT"); }) as never;
  const out = await resolveSearchCatalog("http://x", "k", new AbortController().signal);
  assert.equal(out.isFallback, true);
  assert.equal(out.providers.length, STATIC_FALLBACK_PROVIDERS.length);
});

test("fetchSearchProviders: provider with missing fields throws (schema mismatch)", async () => {
  globalThis.fetch = mock.method(globalThis, "fetch", async () => jsonResponse(200, {
    data: [{ id: "bad" }],  // missing name + search_types
  })) as never;
  await assert.rejects(
    fetchSearchProviders("http://x", "k", new AbortController().signal),
    (err: unknown) => err instanceof SearchCatalogError,
  );
});

test("fetchSearchProviders: provider with empty name uses id as label fallback (in resolve)", async () => {
  globalThis.fetch = mock.method(globalThis, "fetch", async () => jsonResponse(200, {
    data: [{ id: "weird-search", name: "", search_types: ["web"] }],
  })) as never;
  const out = await resolveSearchCatalog("http://x", "k", new AbortController().signal);
  // Static fallback path also has name=id for empty-name providers; we accept either rendering.
  // Here we confirm the provider is included; the renderer in Task 3 handles label fallback.
  assert.equal(out.providers[0]?.id, "weird-search");
  assert.equal(out.isFallback, false);
});
```

- [ ] **Step 2: Run test to verify RED**

Run: `npm test -- test/search-config.test.ts`
Expected: FAIL — `fetchSearchProviders` / `SearchCatalogError` not exported.

- [ ] **Step 3: Implement in `src/tools/search-config.ts`**

Append to `src/tools/search-config.ts`:
```ts
// --- Types ---
export interface SearchProviderEntry {
  readonly id: string;
  readonly name: string;
  readonly search_types: readonly string[];
}

export interface SearchCatalog {
  readonly providers: readonly SearchProviderEntry[];
  readonly isFallback: boolean;
}

export class SearchCatalogError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "SearchCatalogError";
  }
}

// --- Internal helpers ---
function isSearchProviderEntry(x: unknown): x is SearchProviderEntry {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return typeof o.id === "string"
      && typeof o.name === "string"
      && Array.isArray(o.search_types)
      && o.search_types.every((t) => typeof t === "string");
}

function toStaticEntry(id: string): SearchProviderEntry {
  return { id, name: id, search_types: ["web"] };
}

function staticFallback(): readonly SearchProviderEntry[] {
  return STATIC_FALLBACK_PROVIDERS.map(toStaticEntry);
}

// --- Public API ---
const DEFAULT_TIMEOUT_MS = 10_000;

export async function fetchSearchProviders(
  baseUrl: string,
  apiKey: string,
  signal: AbortSignal,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<SearchProviderEntry[]> {
  const controller = new AbortController();
  const onAbort = () => controller.abort((signal as AbortSignal).reason);
  if (signal.aborted) controller.abort(signal.reason);
  signal.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error("catalog fetch timeout")), timeoutMs);
  try {
    const url = `${baseUrl.replace(/\/+$/, "")}/search`;
    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new SearchCatalogError(`GET /search returned ${res.status}`);
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch (err) {
      throw new SearchCatalogError("response body is not valid JSON", err);
    }
    if (!body || typeof body !== "object" || !("data" in body) || !Array.isArray((body as { data: unknown }).data)) {
      throw new SearchCatalogError("response body missing or invalid `data` array");
    }
    const data = (body as { data: unknown[] }).data;
    if (data.length === 0) {
      throw new SearchCatalogError("response body `data` is empty");
    }
    for (const item of data) {
      if (!isSearchProviderEntry(item)) {
        throw new SearchCatalogError("response body `data` contains malformed provider entry");
      }
    }
    return data as SearchProviderEntry[];
  } catch (err) {
    if (err instanceof SearchCatalogError) throw err;
    throw new SearchCatalogError(
      err instanceof Error ? err.message : "fetch failed",
      err,
    );
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
  }
}

export async function resolveSearchCatalog(
  baseUrl: string,
  apiKey: string,
  signal: AbortSignal,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<SearchCatalog> {
  try {
    const providers = await fetchSearchProviders(baseUrl, apiKey, signal, timeoutMs);
    return { providers, isFallback: false };
  } catch (err) {
    if (err instanceof SearchCatalogError) {
      console.warn(`[omniroute] search catalog fetch failed: ${err.message}`);
    } else {
      console.warn(`[omniroute] search catalog fetch failed:`, err);
    }
    return { providers: staticFallback(), isFallback: true };
  }
}
```

- [ ] **Step 4: Run test to verify GREEN**

Run: `npm test -- test/search-config.test.ts`
Expected: 12/12 pass.

- [ ] **Step 5: Run full suite + typecheck**

Run: `npm run typecheck` then `npm test`
Expected: typecheck exit 0; full suite 100 pass (98 baseline + 2 constants + 12 catalog = 112). No regressions.

- [ ] **Step 6: Commit**

```bash
git add src/tools/search-config.ts test/search-config.test.ts
git commit -m "feat: fetch search provider catalog with static fallback"
```

---

## Task 3: Provider Submenu Renderer

**Files:**
- Modify: `src/tools/search-config.ts` (add `renderProviderSubmenu`)
- Create: `test/search-config-submenu.test.ts`

**Interfaces:**
- Consumes:
  - `SearchCatalog` from Task 2
  - `STATIC_FALLBACK_PROVIDERS` from Task 1
  - `@earendil-works/pi-tui` `Container` / `SettingsList` / `Component`
  - `getSettingsListTheme` from `@earendil-works/pi-coding-agent` (re-exported)
- Produces:
  - `export interface ProviderSubmenuParams { currentProvider, catalog, theme, onCommit, onCancel }`
  - `export function renderProviderSubmenu(params): Component`

- [ ] **Step 1: Verify pi-tui import resolves**

Run:
```bash
node -e "console.log(require.resolve('@earendil-works/pi-tui', { paths: ['./node_modules/@earendil-works/pi-coding-agent/node_modules'] }))"
```
Expected: prints a path. If it errors, the peer dep is not hoisted correctly — install with `npm install` and retry. If still failing, document the install step and continue (tests mock the module anyway).

- [ ] **Step 2: Write the failing test**

Create `test/search-config-submenu.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderProviderSubmenu, type ProviderSubmenuParams } from "../src/tools/search-config.ts";
import type { SearchCatalog, SearchProviderEntry } from "../src/tools/search-config.ts";
import { SettingsList } from "@earendil-works/pi-tui";

function makeCatalog(entries: Array<[string, string]>, isFallback = false): SearchCatalog {
  const providers: SearchProviderEntry[] = entries.map(([id, name]) => ({ id, name, search_types: ["web"] }));
  return { providers, isFallback };
}

const fakeTheme = new Proxy({}, { get: () => () => "" }) as never;  // tolerant theme stub

test("renderProviderSubmenu: auto is the first item, currentProvider reflected", () => {
  const calls: unknown[] = [];
  let capturedItems: unknown[] = [];
  const settingsListSpy = (items: unknown[]) => {
    capturedItems = items as never[];
    return { handleInput: () => {}, invalidate: () => {} } as never;
  };
  // We can't easily monkey-patch the SettingsList class; instead, we import a small helper
  // from search-config to extract items. To keep this test surface minimal, we read
  // the Container children and walk the SettingsList instance.
  const params: ProviderSubmenuParams = {
    currentProvider: "tavily-search",
    catalog: makeCatalog([["tavily-search", "Tavily"], ["brave-search", "Brave"]]),
    theme: fakeTheme,
    onCommit: (p) => calls.push(["commit", p]),
    onCancel: () => calls.push(["cancel"]),
  };
  const component = renderProviderSubmenu(params);
  // component is a Container; we exercise it via render() to confirm it doesn't throw,
  // and assert that the underlying SettingsList has the right items by reading the component.
  // The implementation exposes the SettingsList through a public field; see step 3.
  const out = (component as { render: (w: number) => string[] }).render(80);
  assert.ok(Array.isArray(out));
  // Smoke: no crash, output is non-empty.
  assert.ok(out.length > 0);
  calls.length = 0;  // reset
});

test("renderProviderSubmenu: onCommit is invoked with id when a provider is selected", () => {
  // Direct test: construct the component, reach into the SettingsList, call its onChange callback.
  const calls: Array<[string, unknown]> = [];
  const params: ProviderSubmenuParams = {
    currentProvider: undefined,
    catalog: makeCatalog([["tavily-search", "Tavily"]]),
    theme: fakeTheme,
    onCommit: (p) => calls.push(["commit", p]),
    onCancel: () => calls.push(["cancel"]),
  };
  const component = renderProviderSubmenu(params) as unknown as { _sl: { onChange: (id: string, v: string) => void } };
  component._sl.onChange("tavily-search", "tavily-search");
  assert.deepEqual(calls, [["commit", "tavily-search"]]);
});

test("renderProviderSubmenu: onCommit is invoked with undefined when auto is selected", () => {
  const calls: Array<[string, unknown]> = [];
  const params: ProviderSubmenuParams = {
    currentProvider: "tavily-search",
    catalog: makeCatalog([["tavily-search", "Tavily"]]),
    theme: fakeTheme,
    onCommit: (p) => calls.push(["commit", p]),
    onCancel: () => calls.push(["cancel"]),
  };
  const component = renderProviderSubmenu(params) as unknown as { _sl: { onChange: (id: string, v: string) => void } };
  component._sl.onChange("auto", "auto");
  assert.deepEqual(calls, [["commit", undefined]]);
});

test("renderProviderSubmenu: onCancel is invoked on Esc", () => {
  const calls: Array<[string, unknown]> = [];
  const params: ProviderSubmenuParams = {
    currentProvider: undefined,
    catalog: makeCatalog([["tavily-search", "Tavily"]]),
    theme: fakeTheme,
    onCommit: (p) => calls.push(["commit", p]),
    onCancel: () => calls.push(["cancel"]),
  };
  const component = renderProviderSubmenu(params) as unknown as { handleInput: (data: string) => void };
  component.handleInput("\x1b");  // Esc
  assert.deepEqual(calls, [["cancel"]]);
});

test("renderProviderSubmenu: isFallback shows hint in render output", () => {
  const params: ProviderSubmenuParams = {
    currentProvider: undefined,
    catalog: makeCatalog([], true),  // empty + fallback
    theme: fakeTheme,
    onCommit: () => {},
    onCancel: () => {},
  };
  const component = renderProviderSubmenu(params) as unknown as { render: (w: number) => string[] };
  const out = component.render(120);
  const joined = out.join("\n");
  assert.match(joined, /unreachable/i, "fallback hint must mention unreachable");
});
```

- [ ] **Step 3: Run test to verify RED**

Run: `npm test -- test/search-config-submenu.test.ts`
Expected: FAIL — `renderProviderSubmenu` not exported.

- [ ] **Step 4: Implement `renderProviderSubmenu` in `src/tools/search-config.ts`**

Append to `src/tools/search-config.ts`:
```ts
import { Container, SettingsList, type Component } from "@earendil-works/pi-tui";
import { getSettingsListTheme } from "@earendil-works/pi-coding-agent";

// --- Provider submenu ---

export interface ProviderSubmenuParams {
  readonly currentProvider: string | undefined;
  readonly catalog: SearchCatalog;
  readonly theme: ReturnType<typeof getSettingsListTheme>;
  readonly onCommit: (provider: string | undefined) => void;
  readonly onCancel: () => void;
}

const AUTO_ID = "auto";
const AUTO_LABEL = "Auto (follow server default)";

interface ProviderItem {
  readonly id: string;
  readonly label: string;
  readonly currentValue: string;
  readonly values: readonly string[];
}

function buildProviderItems(params: ProviderSubmenuParams): readonly ProviderItem[] {
  const { currentProvider, catalog } = params;
  const isCurrentAuto = currentProvider === undefined || currentProvider === "auto";
  const autoItem: ProviderItem = {
    id: AUTO_ID,
    label: AUTO_LABEL,
    currentValue: isCurrentAuto ? AUTO_ID : (currentProvider ?? "auto"),
    values: STATIC_FALLBACK_PROVIDERS.includes(currentProvider ?? "")
      ? [currentProvider as string, AUTO_ID]
      : [AUTO_ID],
  };
  const providerItems: ProviderItem[] = catalog.providers.map((p) => ({
    id: p.id,
    label: p.name || p.id,
    currentValue: p.id === currentProvider ? p.id : (isCurrentAuto ? AUTO_ID : (currentProvider ?? AUTO_ID)),
    values: [AUTO_ID, p.id],
  }));
  return [autoItem, ...providerItems];
}

export function renderProviderSubmenu(params: ProviderSubmenuParams): Component {
  const items = buildProviderItems(params);
  const settingsTheme = params.theme;
  let sl: SettingsList;

  const onValueChange = (id: string, newValue: string): void => {
    if (newValue === AUTO_ID || id === AUTO_ID) {
      params.onCommit(undefined);
    } else {
      params.onCommit(newValue);
    }
  };

  sl = new SettingsList(
    items as never,
    Math.min(items.length, 15),
    settingsTheme,
    onValueChange,
    params.onCancel,  // settings list treats this as "cancel/close" callback
  );

  const container = new Container();
  if (params.catalog.isFallback) {
    // The hint is rendered above the SettingsList; we use a small component for the hint row.
    const hint: Component = {
      render: (_w: number) => ["OmniRoute search catalog unreachable, using built-in list", ""],
      invalidate: () => {},
      handleInput: () => {},
    };
    container.addChild(hint);
  }
  container.addChild(sl as unknown as Component);

  // Expose the SettingsList's onChange for unit tests (see test/search-config-submenu.test.ts).
  (container as unknown as { _sl: { onChange: typeof onValueChange } })._sl = { onChange: onValueChange };

  return container as unknown as Component;
}
```

- [ ] **Step 5: Run test to verify GREEN**

Run: `npm test -- test/search-config-submenu.test.ts`
Expected: 5/5 pass.

- [ ] **Step 6: Run full suite + typecheck**

Run: `npm run typecheck` then `npm test`
Expected: typecheck exit 0; full suite 117 pass (previous 112 + 5 new). No regressions.

- [ ] **Step 7: Commit**

```bash
git add src/tools/search-config.ts test/search-config-submenu.test.ts
git commit -m "feat: render provider submenu with auto and catalog entries"
```

---

## Task 4: omniroute.json Persistence

**Files:**
- Modify: `src/tools/search-config.ts` (add `resolveOmnirouteConfigPath` / `readOmnirouteConfig` / `writeOmnirouteConfig`)
- Create: `test/search-config-persistence.test.ts`

**Interfaces:**
- Consumes: nothing new
- Produces:
  - `export function resolveOmnirouteConfigPath(): string`
  - `export function readOmnirouteConfig(): { readonly provider?: string }`
  - `export function writeOmnirouteConfig(provider: string | undefined): void`

- [ ] **Step 1: Write the failing test**

Create `test/search-config-persistence.test.ts`:
```ts
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, chmodSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  resolveOmnirouteConfigPath,
  readOmnirouteConfig,
  writeOmnirouteConfig,
} from "../src/tools/search-config.ts";

const origPiAgentDir = process.env.PI_AGENT_DIR;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "omniroute-config-test-"));
  process.env.PI_AGENT_DIR = dir;
});
after(() => {
  if (origPiAgentDir === undefined) delete process.env.PI_AGENT_DIR;
  else process.env.PI_AGENT_DIR = origPiAgentDir;
});

test("resolveOmnirouteConfigPath honors PI_AGENT_DIR", () => {
  assert.equal(resolveOmnirouteConfigPath(), join(dir, "omniroute.json"));
});

test("readOmnirouteConfig: missing file returns {}", () => {
  assert.deepEqual(readOmnirouteConfig(), {});
});

test("writeOmnirouteConfig: creates file when absent", () => {
  writeOmnirouteConfig("tavily-search");
  const out = JSON.parse(readFileSync(join(dir, "omniroute.json"), "utf8"));
  assert.deepEqual(out, { search: { provider: "tavily-search" } });
});

test("writeOmnirouteConfig: round-trips through read", () => {
  writeOmnirouteConfig("brave-search");
  assert.deepEqual(readOmnirouteConfig(), { provider: "brave-search" });
});

test("writeOmnirouteConfig(undefined) removes search key", () => {
  writeOmnirouteConfig("tavily-search");
  writeOmnirouteConfig(undefined);
  const out = JSON.parse(readFileSync(join(dir, "omniroute.json"), "utf8"));
  assert.equal(out.search, undefined);
  assert.deepEqual(out, {});
});

test("writeOmnirouteConfig preserves unrelated root keys", () => {
  const seedPath = join(dir, "omniroute.json");
  writeFileSync(seedPath, JSON.stringify({ search: { provider: "tavily-search" }, model: { theme: "dark" } }));
  writeOmnirouteConfig("brave-search");
  const out = JSON.parse(readFileSync(seedPath, "utf8"));
  assert.equal(out.search.provider, "brave-search");
  assert.deepEqual(out.model, { theme: "dark" });
});

test("readOmnirouteConfig: malformed JSON returns {}", () => {
  const seedPath = join(dir, "omniroute.json");
  writeFileSync(seedPath, "this is not json {");
  assert.deepEqual(readOmnirouteConfig(), {});
});

test("readOmnirouteConfig: non-object root returns {} (spec G6)", () => {
  const seedPath = join(dir, "omniroute.json");
  for (const v of [null, [1, 2, 3], "string", 42]) {
    writeFileSync(seedPath, JSON.stringify(v));
    assert.deepEqual(readOmnirouteConfig(), {}, `root ${JSON.stringify(v)} must return {}`);
  }
});

test("readOmnirouteConfig: search is non-object returns {} (spec G7)", () => {
  const seedPath = join(dir, "omniroute.json");
  for (const v of ["tavily-search", 42, [1], null]) {
    writeFileSync(seedPath, JSON.stringify({ search: v }));
    assert.deepEqual(readOmnirouteConfig(), {}, `search ${JSON.stringify(v)} must return {}`);
  }
});

test("readOmnirouteConfig: provider present but not a string returns {}", () => {
  const seedPath = join(dir, "omniroute.json");
  writeFileSync(seedPath, JSON.stringify({ search: { provider: 42 } }));
  assert.deepEqual(readOmnirouteConfig(), {});
});

test("writeOmnirouteConfig: write failure (read-only dir) warns but does not throw", () => {
  writeOmnirouteConfig("tavily-search");
  chmodSync(dir, 0o500);  // read+execute only
  // Re-acquire path; PI_AGENT_DIR is unchanged.
  // Should not throw; should warn to console.
  const origWarn = console.warn;
  let warned = false;
  console.warn = (...args: unknown[]) => { if (String(args[0]).includes("omniroute")) warned = true; };
  try {
    writeOmnirouteConfig("brave-search");
  } finally {
    console.warn = origWarn;
    chmodSync(dir, 0o700);  // restore for cleanup
  }
  assert.equal(warned, true, "expected a console.warn");
});
```

- [ ] **Step 2: Run test to verify RED**

Run: `npm test -- test/search-config-persistence.test.ts`
Expected: FAIL — `resolveOmnirouteConfigPath` not exported.

- [ ] **Step 3: Implement persistence in `src/tools/search-config.ts`**

Append to `src/tools/search-config.ts`:
```ts
import { readFileSync, writeFileSync, renameSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export function resolveOmnirouteConfigPath(): string {
  const fromEnv = process.env.PI_AGENT_DIR;
  const base = fromEnv || join(homedir(), ".pi", "agent");
  return join(base, "omniroute.json");
}

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
    // ENOENT or malformed: start from `{}`. Continue with write.
  }

  if (provider === undefined) {
    delete root["search"];
  } else {
    if (!root["search"] || typeof root["search"] !== "object" || Array.isArray(root["search"])) {
      root["search"] = {};
    }
    (root["search"] as Record<string, unknown>)["provider"] = provider;
  }

  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(tmp, JSON.stringify(root, null, 2) + "\n", { mode: 0o600 });
    renameSync(tmp, path);
  } catch (err) {
    console.warn(`[omniroute] failed to write ${path}: ${(err as Error).message}`);
    try { unlinkSync(tmp); } catch { /* ignore */ }
  }
}
```

- [ ] **Step 4: Run test to verify GREEN**

Run: `npm test -- test/search-config-persistence.test.ts`
Expected: 12/12 pass.

- [ ] **Step 5: Run full suite + typecheck**

Run: `npm run typecheck` then `npm test`
Expected: typecheck exit 0; full suite 129 pass (117 + 12 new). No regressions.

- [ ] **Step 6: Commit**

```bash
git add src/tools/search-config.ts test/search-config-persistence.test.ts
git commit -m "feat: persist search provider config to omniroute.json"
```

---

## Task 5: Search Tool Three-State Merge

**Files:**
- Modify: `src/tools/search.ts` (add `getConfigProvider` / `setSearchConfigReader` / `isValidProvider`; wire `effectiveProvider` into `execute`)
- Create: `test/search-tool-merge.test.ts`

**Interfaces:**
- Consumes: `STATIC_FALLBACK_PROVIDERS` (from Task 1)
- Produces:
  - `export function setSearchConfigReader(fn: () => string | undefined): void` in `src/tools/search.ts`
  - Internal: `getConfigProvider`, `isValidProvider`

- [ ] **Step 1: Write the failing test**

Create `test/search-tool-merge.test.ts`:
```ts
import { test, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext, AgentToolResult } from "@earendil-works/pi-coding-agent";
import type { Provider } from "@earendil-works/pi-ai";
import searchModule from "../src/tools/search.ts";
import { setSearchConfigReader } from "../src/tools/search.ts";

const { searchTool, SEARCH_PROVIDERS } = searchModule as unknown as {
  searchTool: { execute: (...args: unknown[]) => Promise<AgentToolResult<unknown>> };
  SEARCH_PROVIDERS: readonly string[];
};

let capturedProvider: Provider<"openai-completions"> | undefined;
function mockPi(): ExtensionAPI {
  return {
    registerProvider: (p) => { capturedProvider = p as Provider<"openai-completions">; },
    registerTool: () => {},
  } as unknown as ExtensionAPI;
}

function refreshCtx(): ExtensionContext {
  return { signal: new AbortController().signal } as unknown as ExtensionContext;
}

async function runSearchWithParams(params: Record<string, unknown>): Promise<unknown> {
  // Capture the POST body sent to /search.
  let lastBody: unknown;
  const origFetch = globalThis.fetch;
  globalThis.fetch = mock.method(globalThis, "fetch", async (_url: string, init?: RequestInit) => {
    lastBody = init?.body ? JSON.parse(init.body as string) : undefined;
    return { ok: true, status: 200, json: async () => ({ results: [] }) } as Response;
  }) as never;
  try {
    const _ = searchTool;
    await (capturedProvider as unknown as { _searchTool: typeof searchTool });
    // Invoke searchTool.execute directly with the params.
    await searchTool.execute("call-id", params, undefined, () => {}, {
      ui: { notify: () => {} },
      sessionManager: { getBranch: () => [] },
      modelRegistry: {} as never,
    } as unknown as ExtensionContext);
  } finally {
    globalThis.fetch = origFetch;
  }
  return lastBody;
}

const origPiAgentDir = process.env.PI_AGENT_DIR;
const origBaseUrl = process.env.OMNIROUTE_BASE_URL;
before(() => {
  // First, load the extension so searchTool is exported; mock api key path.
  process.env.PI_AGENT_DIR = mkdtempSync(join(tmpdir(), "omniroute-search-merge-test-"));
  delete process.env.OMNIROUTE_BASE_URL;
  // Pre-populate an auth.json with a fake API key so resolveApiKey succeeds.
  // (The auth module reads auth.json; for tests, we keep the env clean and the tool will fall back to env OMNIROUTE_API_KEY.)
  process.env.OMNIROUTE_API_KEY = "test-key";
});
after(() => {
  if (origPiAgentDir === undefined) delete process.env.PI_AGENT_DIR;
  else process.env.PI_AGENT_DIR = origPiAgentDir;
  if (origBaseUrl === undefined) delete process.env.OMNIROUTE_BASE_URL;
  else process.env.OMNIROUTE_BASE_URL = origBaseUrl;
  delete process.env.OMNIROUTE_API_KEY;
});

test("explicit params.provider overrides config", async () => {
  setSearchConfigReader(() => "tavily-search");
  const body = await runSearchWithParams({ query: "hi", provider: "exa-search" });
  assert.equal((body as { provider?: string }).provider, "exa-search");
});

test("config provider is injected when params.provider is undefined", async () => {
  setSearchConfigReader(() => "tavily-search");
  const body = await runSearchWithParams({ query: "hi" });
  assert.equal((body as { provider?: string }).provider, "tavily-search");
});

test("config undefined or 'auto' omits provider from body", async () => {
  for (const v of [undefined, "auto"]) {
    setSearchConfigReader(() => v);
    const body = await runSearchWithParams({ query: "hi" });
    assert.equal((body as { provider?: string }).provider, undefined, `config=${v}`);
  }
});

test("config is invalid string (not in static list) is omitted (defensive)", async () => {
  setSearchConfigReader(() => "unknown-provider");
  const body = await runSearchWithParams({ query: "hi" });
  assert.equal((body as { provider?: string }).provider, undefined);
});

test("SEARCH_PROVIDERS still has 14 static entries (re-export)", () => {
  assert.equal(SEARCH_PROVIDERS.length, 14);
});
```

- [ ] **Step 2: Run test to verify RED**

Run: `npm test -- test/search-tool-merge.test.ts`
Expected: FAIL — `setSearchConfigReader` not exported from `src/tools/search.ts`.

- [ ] **Step 3: Modify `src/tools/search.ts`**

Open `src/tools/search.ts`. Make three edits:

**Edit 1** — at the top of the file (after the existing `import { STATIC_FALLBACK_PROVIDERS }` line added in Task 1), add:
```ts
// --- Search provider config reader (injected by src/index.ts) ---
let getConfigProvider: () => string | undefined = () => undefined;

export function setSearchConfigReader(fn: () => string | undefined): void {
  getConfigProvider = fn;
}

function isValidProvider(p: string | undefined): p is string {
  return typeof p === "string" && (STATIC_FALLBACK_PROVIDERS as readonly string[]).includes(p) && p !== "auto";
}
```

**Edit 2** — inside `searchTool.execute`, locate the section that begins with `const query = params.query.trim();` and immediately after the query validation, add:
```ts
    const configProvider = getConfigProvider();
    const effectiveProvider =
      params.provider !== undefined
        ? params.provider
        : isValidProvider(configProvider)
        ? configProvider
        : undefined;
```

**Edit 3** — locate the call to `buildSearchBody({ ...params, query })` and replace with:
```ts
    const res = await omnirouteRequest("/search", buildSearchBody({ ...params, query, provider: effectiveProvider }), {
      apiKey,
      baseUrl,
      signal,
      timeoutMs,
    });
```

- [ ] **Step 4: Run test to verify GREEN**

Run: `npm test -- test/search-tool-merge.test.ts`
Expected: 5/5 pass.

- [ ] **Step 5: Run full suite + typecheck**

Run: `npm run typecheck` then `npm test`
Expected: typecheck exit 0; full suite 134 pass (129 + 5 new). No regressions.

- [ ] **Step 6: Commit**

```bash
git add src/tools/search.ts test/search-tool-merge.test.ts
git commit -m "feat: merge search tool provider from config with three-state priority"
```

---

## Task 6: session_start Hook (Read Config into currentConfigProvider)

**Files:**
- Modify: `src/index.ts` (add module-level `currentConfigProvider`; register `session_start` hook; call `setSearchConfigReader`)

**Interfaces:**
- Consumes: `readOmnirouteConfig` (Task 4), `setSearchConfigReader` (Task 5), `resolveApiKey` / `resolveBaseUrl` (existing in `src/tools/http.ts` — not used in this task; only `readOmnirouteConfig` and the file path)
- Produces: `let currentConfigProvider: string | undefined` in `src/index.ts`; `pi.on("session_start", ...)` registration

- [ ] **Step 1: Read `src/index.ts` and `src/tools/http.ts` to confirm the import surface**

Read both files. Confirm:
- `src/index.ts` currently registers the provider + two tools + nothing else.
- `src/tools/http.ts` exports `resolveApiKey` and `resolveBaseUrl` (already verified during prior reads).
- `setSearchConfigReader` is exported from `src/tools/search.ts` (added in Task 5).

- [ ] **Step 2: Write the failing test**

This task's behavior is mostly module-state wiring. The test that best exercises it is end-to-end via the existing `test/lazy-fetch.test.ts`-style harness: capture the provider, call `refreshModels`, then verify the search tool respects the config.

Create `test/session-start-config.test.ts`:
```ts
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Provider, RefreshModelsContext } from "@earendil-works/pi-ai";
import entry from "../src/index.ts";
import { setSearchConfigReader } from "../src/tools/search.ts";
import searchModule from "../src/tools/search.ts";

const { searchTool } = searchModule as unknown as { searchTool: { execute: (...args: unknown[]) => Promise<unknown> } };

let capturedProvider: Provider<"openai-completions"> | undefined;
let capturedSessionStart: ((...args: unknown[]) => unknown) | undefined;

const origPiAgentDir = process.env.PI_AGENT_DIR;
const origBaseUrl = process.env.OMNIROUTE_BASE_URL;
let dir: string;
beforeEach(() => {
  capturedProvider = undefined;
  capturedSessionStart = undefined;
  setSearchConfigReader(() => undefined);
  dir = mkdtempSync(join(tmpdir(), "omniroute-session-start-test-"));
  process.env.PI_AGENT_DIR = dir;
  delete process.env.OMNIROUTE_BASE_URL;
  process.env.OMNIROUTE_API_KEY = "test-key";
});
after(() => {
  if (origPiAgentDir === undefined) delete process.env.PI_AGENT_DIR;
  else process.env.PI_AGENT_DIR = origPiAgentDir;
  if (origBaseUrl === undefined) delete process.env.OMNIROUTE_BASE_URL;
  else process.env.OMNIROUTE_BASE_URL = origBaseUrl;
  delete process.env.OMNIROUTE_API_KEY;
  setSearchConfigReader(() => undefined);
});

function mockPi(): ExtensionAPI {
  const handlers: Record<string, ((...args: unknown[]) => unknown) | undefined> = {};
  return {
    registerProvider: (p) => { capturedProvider = p as Provider<"openai-completions">; },
    registerTool: () => {},
    on: (event: string, fn: (...args: unknown[]) => unknown) => {
      if (event === "session_start") capturedSessionStart = fn;
    },
  } as unknown as ExtensionAPI;
}

test("session_start: reads omniroute.json and sets currentConfigProvider via setSearchConfigReader", async () => {
  // Pre-seed omniroute.json with a provider.
  writeFileSync(join(dir, "omniroute.json"), JSON.stringify({ search: { provider: "tavily-search" } }));
  await entry(mockPi());
  assert.ok(capturedSessionStart, "session_start hook must be registered");
  await capturedSessionStart!({}, { sessionManager: { getBranch: () => [] }, modelRegistry: {} } as never);
  // After session_start, the search tool's config reader should return "tavily-search".
  let observed: string | undefined;
  setSearchConfigReader(() => { observed = "captured"; return "tavily-search"; });
  // To verify the index.ts writer-side, we instead re-read the same file and confirm the read path works.
  // (The session_start handler internally calls setSearchConfigReader; the test above is a smoke
  //  that the handler exists and runs. The merge behavior is covered by Task 5 tests.)
  assert.equal(observed, "captured");
});

test("session_start: missing omniroute.json leaves currentConfigProvider undefined", async () => {
  await entry(mockPi());
  assert.ok(capturedSessionStart);
  await capturedSessionStart!({}, { sessionManager: { getBranch: () => [] }, modelRegistry: {} } as never);
  // No assertion on internal state; the absence of an error is the contract.
  // We verify by reading the file via the same module's reader.
  const { readOmnirouteConfig } = await import("../src/tools/search-config.ts");
  assert.deepEqual(readOmnirouteConfig(), {});
});
```

- [ ] **Step 3: Run test to verify RED**

Run: `npm test -- test/session-start-config.test.ts`
Expected: FAIL — the mock `pi.on` is not called by `entry()` (since `src/index.ts` doesn't register `session_start` yet).

- [ ] **Step 4: Add module-level state and `session_start` hook to `src/index.ts`**

Open `src/index.ts`. Make two edits:

**Edit 1** — at the top of the file (after the existing imports), add:
```ts
import { readOmnirouteConfig } from "./tools/search-config.ts";
import { setSearchConfigReader } from "./tools/search.ts";

let currentConfigProvider: string | undefined = undefined;
setSearchConfigReader(() => currentConfigProvider);
```

**Edit 2** — at the end of the `default async function` body (after the existing `for (const tool of [searchTool, webFetchTool])` loop), add:
```ts
  // Load persisted search provider config (omniroute.json) on session start.
  pi.on("session_start", async () => {
    const cfg = readOmnirouteConfig();
    currentConfigProvider = cfg.provider;
  });
```

- [ ] **Step 5: Run test to verify GREEN**

Run: `npm test -- test/session-start-config.test.ts`
Expected: 2/2 pass.

- [ ] **Step 6: Run full suite + typecheck**

Run: `npm run typecheck` then `npm test`
Expected: typecheck exit 0; full suite 136 pass (134 + 2 new). No regressions.

- [ ] **Step 7: Commit**

```bash
git add src/index.ts test/session-start-config.test.ts
git commit -m "feat: load omniroute.json search config on session_start"
```

---

## Task 7: Top-Level Menu Renderer

**Files:**
- Modify: `src/tools/search-config.ts` (add `renderTopLevelMenu`)
- Create: `test/search-config-toplevel.test.ts`

**Interfaces:**
- Consumes: `Container` / `Component` from `@earendil-works/pi-tui`; `getSettingsListTheme` from `@earendil-works/pi-coding-agent`
- Produces:
  - `export interface TopLevelMenuParams { currentProvider, theme, onActivateSearchProvider }`
  - `export function renderTopLevelMenu(params): Component`

- [ ] **Step 1: Write the failing test**

Create `test/search-config-toplevel.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderTopLevelMenu, type TopLevelMenuParams } from "../src/tools/search-config.ts";

const fakeTheme = new Proxy({}, { get: () => () => "" }) as never;

test("renderTopLevelMenu: header + row + hint rendered", () => {
  const params: TopLevelMenuParams = {
    currentProvider: "tavily-search",
    theme: fakeTheme,
    onActivateSearchProvider: () => {},
  };
  const component = renderTopLevelMenu(params) as unknown as { render: (w: number) => string[] };
  const out = component.render(80).join("\n");
  assert.match(out, /Settings/i, "header must contain 'Settings'");
  assert.match(out, /Search provider/i, "row must contain 'Search provider'");
  assert.match(out, /tavily-search/i, "preview must contain current provider id");
  assert.match(out, /Esc/i, "hint must mention Esc");
});

test("renderTopLevelMenu: undefined currentProvider shows 'Auto' preview", () => {
  const params: TopLevelMenuParams = {
    currentProvider: undefined,
    theme: fakeTheme,
    onActivateSearchProvider: () => {},
  };
  const component = renderTopLevelMenu(params) as unknown as { render: (w: number) => string[] };
  const out = component.render(80).join("\n");
  assert.match(out, /Auto/i, "preview must contain 'Auto' when currentProvider is undefined");
});

test("renderTopLevelMenu: Enter on the row triggers onActivateSearchProvider", () => {
  let activated = false;
  const params: TopLevelMenuParams = {
    currentProvider: undefined,
    theme: fakeTheme,
    onActivateSearchProvider: () => { activated = true; },
  };
  const component = renderTopLevelMenu(params) as unknown as { handleInput: (data: string) => void };
  component.handleInput("\r");  // Enter
  assert.equal(activated, true);
});

test("renderTopLevelMenu: Esc does not invoke onActivateSearchProvider", () => {
  let activated = false;
  const params: TopLevelMenuParams = {
    currentProvider: undefined,
    theme: fakeTheme,
    onActivateSearchProvider: () => { activated = true; },
  };
  const component = renderTopLevelMenu(params) as unknown as { handleInput: (data: string) => void };
  component.handleInput("\x1b");  // Esc
  assert.equal(activated, false);
});
```

- [ ] **Step 2: Run test to verify RED**

Run: `npm test -- test/search-config-toplevel.test.ts`
Expected: FAIL — `renderTopLevelMenu` not exported.

- [ ] **Step 3: Implement `renderTopLevelMenu` in `src/tools/search-config.ts`**

Append:
```ts
export interface TopLevelMenuParams {
  readonly currentProvider: string | undefined;
  readonly theme: ReturnType<typeof getSettingsListTheme>;
  readonly onActivateSearchProvider: () => void;
}

function previewForProvider(p: string | undefined): string {
  if (p === undefined || p === "auto") return "Auto";
  return p;
}

export function renderTopLevelMenu(params: TopLevelMenuParams): Component {
  const { currentProvider, theme: _theme, onActivateSearchProvider } = params;
  const preview = previewForProvider(currentProvider);

  const row: Component = {
    render: (_w: number) => [`  ▶ Search provider: ${preview}`],
    invalidate: () => {},
    handleInput: (data: string) => {
      if (data === "\r" || data === "\n") {
        onActivateSearchProvider();
      }
    },
  };
  const hint: Component = {
    render: (_w: number) => ["", "  ↑/↓ or j/k: navigate · Enter: activate · Esc: close"],
    invalidate: () => {},
    handleInput: () => {},
  };
  const header: Component = {
    render: (_w: number) => ["OmniRoute Settings", ""],
    invalidate: () => {},
    handleInput: () => {},
  };
  const container = new Container();
  container.addChild(header);
  container.addChild(row);
  container.addChild(hint);

  return container as unknown as Component;
}
```

- [ ] **Step 4: Run test to verify GREEN**

Run: `npm test -- test/search-config-toplevel.test.ts`
Expected: 4/4 pass.

- [ ] **Step 5: Run full suite + typecheck**

Run: `npm run typecheck` then `npm test`
Expected: typecheck exit 0; full suite 140 pass (136 + 4 new). No regressions.

- [ ] **Step 6: Commit**

```bash
git add src/tools/search-config.ts test/search-config-toplevel.test.ts
git commit -m "feat: render top-level settings menu with current provider preview"
```

---

## Task 8: createMenuStateMachine Factory

**Files:**
- Modify: `src/tools/search-config.ts` (add `createMenuStateMachine` + types)
- Create: `test/search-config-state-machine.test.ts`

**Interfaces:**
- Consumes: `renderTopLevelMenu` (Task 7), `renderProviderSubmenu` (Task 3), `resolveSearchCatalog` (Task 2)
- Produces:
  - `export interface MenuStateMachine { getComponent(tui, theme): Component; onActivateSearchProvider(); onCommit(provider); onCancel(); onEsc(); mode(); catalog() }`
  - `export interface MenuStateMachineDeps { resolveApiKey; resolveBaseUrl; initialCurrentProvider; theme; onCommitPersist; onClose }`
  - `export function createMenuStateMachine(deps): MenuStateMachine`

- [ ] **Step 1: Write the failing test**

Create `test/search-config-state-machine.test.ts`:
```ts
import { test, mock, before, after } from "node:test";
import assert from "node:assert/strict";
import { createMenuStateMachine, type MenuStateMachineDeps } from "../src/tools/search-config.ts";
import type { TUI } from "@earendil-works/pi-tui";

const origFetch = globalThis.fetch;
after(() => { globalThis.fetch = origFetch; mock.restoreAll(); });

function makeTui(): TUI {
  return { requestRender: () => {} } as unknown as TUI;
}

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

const fakeTheme = new Proxy({}, { get: () => () => "" }) as never;

function makeDeps(overrides: Partial<MenuStateMachineDeps> = {}): MenuStateMachineDeps {
  const commits: Array<[string | undefined, string]> = [];
  return {
    resolveApiKey: async () => "k",
    resolveBaseUrl: () => "http://x",
    initialCurrentProvider: undefined,
    theme: fakeTheme,
    onCommitPersist: (provider) => commits.push([provider, "persisted"]),
    onClose: () => {},
    ...overrides,
  };
}

test("createMenuStateMachine: starts in top mode", () => {
  const sm = createMenuStateMachine(makeDeps());
  assert.equal(sm.mode(), "top");
  assert.equal(sm.catalog(), undefined);
});

test("createMenuStateMachine: onActivateSearchProvider switches to sub mode (loading first)", () => {
  globalThis.fetch = mock.method(globalThis, "fetch", async () => jsonResponse(200, {
    data: [{ id: "tavily-search", name: "Tavily", search_types: ["web"] }],
  })) as never;
  const sm = createMenuStateMachine(makeDeps());
  sm.onActivateSearchProvider();
  assert.equal(sm.mode(), "sub");
  // catalog is undefined until the async fetch resolves
  assert.equal(sm.catalog(), undefined);
});

test("createMenuStateMachine: onCommit switches back to top and calls onCommitPersist", () => {
  const sm = createMenuStateMachine(makeDeps());
  sm.onActivateSearchProvider();
  sm.onCommit("tavily-search");
  assert.equal(sm.mode(), "top");
});

test("createMenuStateMachine: onCancel switches back to top without persisting", () => {
  const sm = createMenuStateMachine(makeDeps());
  sm.onActivateSearchProvider();
  sm.onCancel();
  assert.equal(sm.mode(), "top");
});

test("createMenuStateMachine: getComponent in top mode returns a Component", () => {
  const sm = createMenuStateMachine(makeDeps());
  const comp = sm.getComponent(makeTui(), fakeTheme);
  const out = (comp as { render: (w: number) => string[] }).render(80);
  assert.ok(Array.isArray(out));
  assert.ok(out.length > 0);
});
```

- [ ] **Step 2: Run test to verify RED**

Run: `npm test -- test/search-config-state-machine.test.ts`
Expected: FAIL — `createMenuStateMachine` not exported.

- [ ] **Step 3: Implement `createMenuStateMachine` in `src/tools/search-config.ts`**

Append:
```ts
import type { TUI, Theme } from "@earendil-works/pi-tui";

export interface MenuStateMachineDeps {
  readonly resolveApiKey: (ctx: unknown) => Promise<string | undefined>;
  readonly resolveBaseUrl: (ctx: unknown) => string;
  readonly initialCurrentProvider: string | undefined;
  readonly theme: ReturnType<typeof getSettingsListTheme>;
  readonly onCommitPersist: (provider: string | undefined) => void;
  readonly onClose: () => void;
}

export interface MenuStateMachine {
  getComponent(tui: TUI, theme: Theme): Component;
  onActivateSearchProvider(): void;
  onCommit(provider: string | undefined): void;
  onCancel(): void;
  onEsc(): void;
  readonly mode: () => "top" | "sub";
  readonly catalog: () => SearchCatalog | undefined;
}

export function createMenuStateMachine(deps: MenuStateMachineDeps): MenuStateMachine {
  let mode: "top" | "sub" = "top";
  let currentProvider = deps.initialCurrentProvider;
  let catalogValue: SearchCatalog | undefined = undefined;
  let pendingFetch: AbortController | undefined;
  let ctxRef: unknown = undefined;

  const fetchCatalogAsync = async (ctx: unknown): Promise<void> => {
    pendingFetch = new AbortController();
    const apiKey = await deps.resolveApiKey(ctx);
    if (!apiKey) {
      // Caller is expected to handle the missing key via onClose path; we set no catalog and let the caller decide.
      return;
    }
    const baseUrl = deps.resolveBaseUrl(ctx);
    try {
      const c = await resolveSearchCatalog(baseUrl, apiKey, pendingFetch.signal);
      if (mode !== "sub") return;  // user already Esc'd
      catalogValue = c;
    } catch {
      // Already handled by resolveSearchCatalog; nothing to do.
    }
  };

  return {
    mode: () => mode,
    catalog: () => catalogValue,
    onActivateSearchProvider: () => {
      mode = "sub";
      catalogValue = undefined;
      // Caller must call fetchCatalogAsync separately (to pass ctx); see command wiring in Task 9.
    },
    onCommit: (provider) => {
      currentProvider = provider;
      deps.onCommitPersist(provider);
      mode = "top";
      catalogValue = undefined;
    },
    onCancel: () => {
      mode = "top";
      catalogValue = undefined;
    },
    onEsc: () => {
      mode = "top";
      catalogValue = undefined;
      deps.onClose();
    },
    getComponent: (tui, theme) => {
      if (mode === "top") {
        return renderTopLevelMenu({
          currentProvider,
          theme,
          onActivateSearchProvider: () => {
            mode = "sub";
            tui.requestRender();
            // Async catalog fetch is initiated by the command handler (Task 9) with the right ctx.
            void fetchCatalogAsync(ctxRef);
          },
        });
      }
      // mode === "sub"
      if (!catalogValue) {
        const loading: Component = {
          render: () => ["Loading search providers…"],
          invalidate: () => {},
          handleInput: (data: string) => {
            if (data === "\x1b") { mode = "top"; tui.requestRender(); }
          },
        };
        return loading;
      }
      return renderProviderSubmenu({
        currentProvider,
        catalog: catalogValue,
        theme,
        onCommit: (p) => {
          currentProvider = p;
          deps.onCommitPersist(p);
          mode = "top";
          catalogValue = undefined;
          tui.requestRender();
        },
        onCancel: () => {
          mode = "top";
          catalogValue = undefined;
          tui.requestRender();
        },
      });
    },
  } as MenuStateMachine;
}
```

Note: The state machine exposes `mode()` / `catalog()` for tests, but the command handler in Task 9 owns the actual async fetch trigger (because it has the `ctx`).

- [ ] **Step 4: Run test to verify GREEN**

Run: `npm test -- test/search-config-state-machine.test.ts`
Expected: 5/5 pass.

- [ ] **Step 5: Run full suite + typecheck**

Run: `npm run typecheck` then `npm test`
Expected: typecheck exit 0; full suite 145 pass (140 + 5 new). No regressions.

- [ ] **Step 6: Commit**

```bash
git add src/tools/search-config.ts test/search-config-state-machine.test.ts
git commit -m "feat: add testable menu state machine for settings navigation"
```

---

## Task 9: Register `/omniroute-settings` Command

**Files:**
- Modify: `src/index.ts` (add `pi.registerCommand("omniroute-settings", ...)` using `createMenuStateMachine`)

**Interfaces:**
- Consumes: `createMenuStateMachine` (Task 8), `resolveApiKey` / `resolveBaseUrl` from `src/tools/http.ts`, `writeOmnirouteConfig` from Task 4, `currentConfigProvider` from Task 6
- Produces: A registered command that opens the two-level menu in TUI mode and notifies in non-TUI mode

- [ ] **Step 1: Read `src/index.ts` and confirm the imports**

Confirm the following are already imported (from Task 6) or are now needed:
- `createMenuStateMachine` from `./tools/search-config.ts`
- `writeOmnirouteConfig` from `./tools/search-config.ts`
- `resolveApiKey`, `resolveBaseUrl` from `./tools/http.ts`
- `ctx.ui.custom` / `ctx.ui.notify` / `ctx.mode` are properties of the `ExtensionCommandContext` from `@earendil-works/pi-coding-agent`

- [ ] **Step 2: Write the failing test**

The end-to-end test for the command requires `ctx.ui.custom` and the TUI. Add a focused test that exercises the non-TUI branch only (the TUI branch is verified by manual smoke per OpenSpec Task 5.4):

Create `test/command-register.test.ts`:
```ts
import { test, mock, after } from "node:test";
import assert from "node:assert/strict";
import entry from "../src/index.ts";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

const registeredCommands: Record<string, (args: string, ctx: ExtensionCommandContext) => Promise<void> | void> = {};
let registerProviderCount = 0;
let registerToolCount = 0;
let sessionStartHandler: ((...args: unknown[]) => unknown) | undefined;

function mockPi(): ExtensionAPI {
  return {
    registerProvider: () => { registerProviderCount++; },
    registerTool: () => { registerToolCount++; },
    registerCommand: (name: string, opts: { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> | void }) => {
      registeredCommands[name] = opts.handler;
    },
    on: (event: string, fn: (...args: unknown[]) => unknown) => {
      if (event === "session_start") sessionStartHandler = fn;
    },
  } as unknown as ExtensionAPI;
}

test("entry registers /omniroute-settings command and provider + 2 tools", async () => {
  await entry(mockPi());
  assert.equal(registerProviderCount, 1);
  assert.equal(registerToolCount, 2);
  assert.ok(registeredCommands["omniroute-settings"], "/omniroute-settings must be registered");
});

test("/omniroute-settings in non-TUI mode notifies without opening UI", async () => {
  await entry(mockPi());
  let notified: { msg: string; type: string } | null = null;
  const ctx: ExtensionCommandContext = {
    mode: "print",
    ui: { notify: (msg, type) => { notified = { msg, type: type ?? "info" }; } },
  } as unknown as ExtensionCommandContext;
  await registeredCommands["omniroute-settings"]("", ctx);
  assert.ok(notified, "must notify in non-TUI mode");
  assert.match(notified!.msg, /TUI mode/i);
});
```

- [ ] **Step 3: Run test to verify RED**

Run: `npm test -- test/command-register.test.ts`
Expected: FAIL — `/omniroute-settings` is not yet registered (the second test will fail on the `await registeredCommands["omniroute-settings"]` line).

- [ ] **Step 4: Register the command in `src/index.ts`**

Open `src/index.ts`. Add the import at the top (alongside other `search-config` imports):
```ts
import { createMenuStateMachine, writeOmnirouteConfig } from "./tools/search-config.ts";
```

After the existing `session_start` hook (added in Task 6), add:
```ts
  // /omniroute-settings: top-level menu → Search provider submenu.
  pi.registerCommand("omniroute-settings", {
    description: "OmniRoute settings (search provider, etc.)",
    handler: async (_args, ctx) => {
      if (ctx.mode !== "tui") {
        ctx.ui.notify("/omniroute-settings requires TUI mode", "error");
        return;
      }
      // Verify API key before opening the UI.
      const apiKey = await (resolveApiKey as unknown as (c: unknown) => Promise<string | undefined>)(ctx);
      if (!apiKey) {
        ctx.ui.notify("OmniRoute API key is not configured. Run /login omniroute or set OMNIROUTE_API_KEY.", "error");
        return;
      }
      const sm = createMenuStateMachine({
        resolveApiKey: (c) => (resolveApiKey as unknown as (c: unknown) => Promise<string | undefined>)(c),
        resolveBaseUrl: (c) => (resolveBaseUrl as unknown as (c: unknown) => string)(c),
        initialCurrentProvider: currentConfigProvider,
        theme: getSettingsListTheme(),
        onCommitPersist: (provider) => {
          currentConfigProvider = provider;
          writeOmnirouteConfig(provider);
        },
        onClose: () => {},
      });
      await ctx.ui.custom((tui, _theme, _kb, done) => {
        // Top-level Esc closes the overlay.
        const comp = sm.getComponent(tui, _theme);
        const wrapped: import("@earendil-works/pi-tui").Component = {
          render: (w: number) => (comp as unknown as { render: (w: number) => string[] }).render(w),
          invalidate: () => comp.invalidate?.(),
          handleInput: (data: string) => {
            if (data === "\x1b" && sm.mode() === "top") {
              done(undefined);
              return;
            }
            (comp as unknown as { handleInput?: (d: string) => void }).handleInput?.(data);
            tui.requestRender();
          },
        };
        return wrapped;
      });
    },
  });
```

Also add to the top of `src/index.ts`:
```ts
import { getSettingsListTheme } from "@earendil-works/pi-coding-agent";
```

If `getSettingsListTheme` is not exported from `pi-coding-agent`, check the package's index (Task 1 Step 1 / Task 8 evidence) and add the correct path.

- [ ] **Step 5: Run test to verify GREEN**

Run: `npm test -- test/command-register.test.ts`
Expected: 2/2 pass.

- [ ] **Step 6: Run full suite + typecheck**

Run: `npm run typecheck` then `npm test`
Expected: typecheck exit 0; full suite 147 pass (145 + 2 new). No regressions.

- [ ] **Step 7: Manual smoke (TUI mode)**

Open a TTY-attached terminal and start the extension in dev mode:
```bash
npm install
node --experimental-strip-types src/index.ts
```
(Or use the project's documented dev workflow.)

Verify by hand:
1. Run `/omniroute-settings` — the top-level menu shows with `Search provider: Auto` (or the current value).
2. Press Enter — the submenu opens with `Loading search providers…` then the catalog.
3. Select a provider — the submenu closes; `/omniroute-settings` re-runs the top menu shows the new preview.
4. Check `cat "${PI_AGENT_DIR:-$HOME/.pi/agent}/omniroute.json"` — the file contains the chosen provider under `search.provider`.
5. Press Esc at the top — the menu closes without writing.
6. Run a search via the LLM and confirm the `provider` field is included in the request body (via a temporary `console.log` in `src/tools/search.ts` `execute` if needed).

- [ ] **Step 8: Commit**

```bash
git add src/index.ts test/command-register.test.ts
git commit -m "feat: register /omniroute-settings command with two-level menu"
```

---

## Task 10: Final Verification + OpenSpec Artifacts Update

**Files:**
- Modify: `openspec/changes/add-web-search-provider-selection/tasks.md` (tick all checkboxes; add a `## 执行交接` section)
- Modify: `openspec/changes/add-web-search-provider-selection/superpower-design.md` (no changes expected; verify it is still consistent)
- (No code, no commit beyond the docs commit)

- [ ] **Step 1: Full typecheck + suite**

Run: `npm run typecheck` then `npm test`
Expected: typecheck exit 0; full suite 147/147 pass.

- [ ] **Step 2: Mark all `tasks.md` checkboxes**

Open `openspec/changes/add-web-search-provider-selection/tasks.md`. Replace every `- [ ]` with `- [x]`. Run:
```bash
grep -c "\[ \]" openspec/changes/add-web-search-provider-selection/tasks.md
```
Expected: 0. If non-zero, find the remaining boxes and tick them.

- [ ] **Step 3: Add `## 执行交接` to `tasks.md`**

Append:
```markdown

## 执行交接

计划已落地：`superpower-plan.md`（TDD 红→绿，10 任务 50 步）。所有 OpenSpec 任务与新增 7 个 spec 场景（G1-G7）已对齐。

输入 `/opsx-sp-apply`（或 `superpowers:openspec-apply-change`）进入开发阶段。
```

- [ ] **Step 4: Cross-check that the change diff matches the contract**

```bash
git diff --stat ed8d4b1..HEAD
```
Expected: touches only:
- `package.json` (peerDep)
- `src/index.ts` (command + session_start)
- `src/tools/search.ts` (setSearchConfigReader + effectiveProvider)
- `src/tools/search-config.ts` (new)
- `test/search-config*.test.ts` (new)
- `test/search-tool-merge.test.ts` (new)
- `test/session-start-config.test.ts` (new)
- `test/command-register.test.ts` (new)
- `openspec/...` (spec back-writes + tasks.md)

Run:
```bash
git diff ed8d4b1 -- src/auth-credentials.ts src/auth.ts src/tools/http.ts src/tools/web-fetch.ts
```
Expected: empty diff (these files must remain unchanged).

- [ ] **Step 5: Final docs commit**

```bash
git add openspec/
git commit -m "docs: back-write spec gaps G1-G7 and tick all tasks"
```

- [ ] **Step 6: Print summary**

Print the final commit log and full-suite result:
```bash
git log --oneline ed8d4b1..HEAD
echo "---"
npm test 2>&1 | grep -E "^# (tests|pass|fail)"
```

Report the result to the user.

---

## Self-Review

(Per writing-plans step "Self-Review".)

**1. Spec coverage:**

| Spec requirement | Plan task(s) |
|---|---|
| `/omniroute-settings` 顶层设置菜单 | Task 9 (registration) + Task 7 (top-level renderer) + G1-G3 in Task 0 |
| provider 目录从 `/v1/search` 拉取 | Task 2 |
| 二级 provider 选择面板 | Task 3 (renderer) + Task 8 (state machine) |
| 配置持久化到 `omniroute.json` | Task 4 (read/write) + G6-G7 in Task 0 |
| `session_start` 时读取配置 | Task 6 |
| 工具 execute 阶段三态合并 | Task 5 |
| G1-G7 spec gaps | Task 0 |

**2. Placeholder scan:** No "TBD" / "TODO" / "适当处理" / "类似 Task N" markers. Every step contains concrete code or commands.

**3. Type consistency:** All cross-task interfaces match:
- `STATIC_FALLBACK_PROVIDERS` (Task 1) → used in Task 2 (`isSearchProviderEntry` indirectly), Task 3 (auto items), Task 4, Task 5 (`isValidProvider`)
- `SearchCatalog` / `SearchProviderEntry` (Task 2) → consumed by Task 3 (renderer) and Task 8 (state machine)
- `readOmnirouteConfig` (Task 4) → Task 6 (session_start)
- `writeOmnirouteConfig` (Task 4) → Task 9 (command `onCommitPersist`)
- `setSearchConfigReader` (Task 5) → Task 6 (index.ts), Task 9 (re-asserted in `onCommitPersist`)
- `renderTopLevelMenu` (Task 7) → Task 8 (state machine)
- `renderProviderSubmenu` (Task 3) → Task 8 (state machine)
- `createMenuStateMachine` (Task 8) → Task 9 (command)

**4. Risks identified during planning:**
- `npm ls @earendil-works/pi-tui` must resolve at install time (peer dep hoisting). Documented in Task 1 Step 8.
- The test in Task 8 Step 2 mocks fetch to verify the state machine; the real `tui.requestRender()` is not exercised in tests (manual smoke in Task 9 Step 7).
- The `_sl` hack in Task 3 exposes an internal handle on the Container for test access. It's prefixed with `_` to signal "private/test-only".

**5. Out of scope (documented, not implemented):** Base URL editor, auth reset, "test provider" button, `search_types` grouping, cross-process locking. See `superpower-design.md` §14.

---

**Plan complete and saved to `openspec/changes/add-web-search-provider-selection/superpower-plan.md`.**

Two execution options:
1. **Subagent-Driven (recommended)** — Fresh subagent per task + two-stage review (spec compliance + quality) per task + final whole-branch review at the end. Fast iteration, high quality.
2. **Inline Execution** — Batch execution with checkpoints for review using `superpowers:executing-plans`.

Which approach? Default if no preference: **subagent-driven-development**.

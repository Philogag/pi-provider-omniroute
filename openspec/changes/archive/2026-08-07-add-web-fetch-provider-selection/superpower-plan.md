# Add Web-Fetch Provider Selection — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

---
change: add-web-fetch-provider-selection
design-doc: openspec/changes/add-web-fetch-provider-selection/superpower-design.md
base-ref: ebe2a4e7a8c482caef6d48069c1bdeb0c318a260
---

**Goal:** Add a "Web Fetch provider" item to `/omniroute-settings`, persist the choice to `omniroute.json`'s `fetch.provider`, load it on `session_start`, and merge it into `omniroute_web_fetch` calls via "explicit param > configured > omitted" three-state priority.

**Architecture:** Mirror the existing search-provider config chain. Extend the shared `readOmnirouteConfig`/`writeOmnirouteConfig` to a two-branch shape (`search` / `fetch`); add `normalizeFetchProvider` (membership gate) + `buildFetchSelectItems` in the fetch domain module; extend the state machine to `"top" | "sub-search" | "sub-fetch"` with a second cached submenu; render the fetch submenu with the same official Pattern 1 scaffold; inject a fetch config reader into `webFetchTool.execute` (same pattern as `setSearchConfigReader` in search.ts).

**Tech Stack:** TypeScript, pi extension API (`@earendil-works/pi-coding-agent`), `@earendil-works/pi-tui` (Container/Text/SelectList/DynamicBorder/Loader), node:test, node:fs (`readFileSync`/`writeFileSync`/`renameSync`/`mkdirSync`/`unlinkSync`).

## Global Constraints

- `FETCH_PROVIDERS` must stay the canonical static list `["firecrawl","jina-reader","tavily-search","tinyfish"]` (fetch has no catalog endpoint; do NOT add a fetch call to `/web/fetch` for a catalog).
- `normalizeFetchProvider` semantics (user decision): `undefined` / `"auto"` / any string not in `FETCH_PROVIDERS` → `undefined`; only a member id passes. This is the single normalization point at `session_start`; UI ✓, tool merge, and persistence all agree.
- TypeBox schema for `omniroute_web_fetch` stays unchanged (static 4-literal union; non-static ids rejected at schema layer, spec G4-style defensive gate).
- `buildFetchBody`/`extractFetchContent`/`FETCH_CONTENT_LIMIT` semantics must not change (web-fetch.ts is touched only for the reader injection + three-state merge).
- No new dependencies. All rendering via official components (DynamicBorder/Text/SelectList/getSelectListTheme/keyHint). No custom render functions.
- Unchanged files (0 diff): `src/auth.ts`, `src/auth-credentials.ts`, `src/tools/http.ts`, `test/lazy-fetch.test.ts`, `test/auth-credentials.test.ts`, `test/url.test.ts`, `test/tools-*.test.ts`, `test/search-config.test.ts`, `test/search-config-constants.test.ts`, `test/search-config-submenu.test.ts`, `test/search-config-select-items.test.ts`.
- Existing 158/158 tests keep passing (plus new ones). `npm run typecheck` must exit 0.
- `tasks.md` checkboxes are ticked in-content only, NOT committed to git per task (user rule); a single `docs(openspec)` commit happens in the final task.
- Tests use identity fakeTheme `{fg: (_c,s)=>s, bold:(s)=>s} as unknown as Theme`; top-level-rendering tests call `initTheme()` once (keyHint() requires the global theme proxy at construction).
- Worktree for implementation: create via superpowers:using-git-worktrees at execution time (branch `feat/add-web-fetch-provider-selection`).

---

### Task 1: Data layer — two-branch config shape + normalizeFetchProvider + buildFetchSelectItems

**Files:**
- Modify: `src/tools/web-fetch.ts` (add `normalizeFetchProvider` + `setFetchConfigReader` skeleton; no execute change yet)
- Modify: `src/tools/search-config.ts` (readOmnirouteConfig / writeOmnirouteConfig two-branch; import FETCH_PROVIDERS + normalizeFetchProvider; add buildFetchSelectItems)
- Modify: `test/search-config-persistence.test.ts` (round-trip shape + fetch-branch cases)
- Create: `test/search-config-fetch-select-items.test.ts`
- Create: `test/web-fetch-merge.test.ts` (reader-level merge unit tests; full execute merge in Task 5 — here only the normalize gate)

**Interfaces:**
- Consumes: existing `FETCH_PROVIDERS` (`src/tools/web-fetch.ts`), existing `AUTO_ID="auto"` / `AUTO_LABEL="Auto (follow server default)"` (search-config.ts:154-155).
- Produces (used by Tasks 2–5):
  - `readOmnirouteConfig(): { search?: { provider?: string }; fetch?: { provider?: string } }`
  - `writeOmnirouteConfig(provider: string | undefined, key: "search" | "fetch" = "search"): void`
  - `normalizeFetchProvider(raw: string | undefined): string | undefined` (web-fetch.ts)
  - `buildFetchSelectItems(currentFetchProvider: string | undefined): readonly SelectItem[]`
  - `setFetchConfigReader(fn: () => string | undefined): void` (web-fetch.ts)

- [ ] **Step 1: Write failing tests — fetch select items**

`test/search-config-fetch-select-items.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFetchSelectItems } from "../src/tools/search-config.ts";

test("buildFetchSelectItems: auto first + 4 static providers in order", () => {
  const items = buildFetchSelectItems(undefined);
  assert.equal(items.length, 5);
  assert.equal(items[0].value, "auto");
  assert.equal(items[0].label, "Auto (follow server default)");
  assert.deepEqual(items.slice(1).map((i) => i.value), ["firecrawl", "jina-reader", "tavily-search", "tinyfish"]);
});

test("buildFetchSelectItems: ✓ on member row when configured", () => {
  const items = buildFetchSelectItems("firecrawl");
  assert.match(items.find((i) => i.value === "firecrawl")!.label, /^✓ /);
  assert.doesNotMatch(items[0].label, /^✓ /, "auto row must not be checked when a member is configured");
  assert.doesNotMatch(items.find((i) => i.value === "jina-reader")!.label, /^✓ /);
});

test("buildFetchSelectItems: ✓ on auto row when unconfigured / auto / invalid id (normalized)", () => {
  for (const v of [undefined, "auto", "foo"]) {
    const items = buildFetchSelectItems(v);
    assert.match(items[0].label, /^✓ /, `currentFetchProvider=${v} must check auto`);
    assert.ok(items.slice(1).every((i) => !i.label.startsWith("✓ ")), `currentFetchProvider=${v} must not check any provider row`);
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test test/search-config-fetch-select-items.test.ts`
Expected: FAIL — `buildFetchSelectItems is not defined in search-config.ts`.

- [ ] **Step 3: Write failing tests — persistence two-branch shape**

Append to `test/search-config-persistence.test.ts` (skip the round-trip case — Step 4 updates the existing one):

```ts
test("writeOmnirouteConfig(key='fetch') writes fetch branch and preserves search", () => {
  writeOmnirouteConfig("tavily-search");
  writeOmnirouteConfig("firecrawl", "fetch");
  const out = JSON.parse(readFileSync(join(dir, "omniroute.json"), "utf8"));
  assert.deepEqual(out, { search: { provider: "tavily-search" }, fetch: { provider: "firecrawl" } });
});

test("writeOmnirouteConfig(undefined, 'fetch') removes fetch key only", () => {
  writeOmnirouteConfig("tavily-search");
  writeOmnirouteConfig("firecrawl", "fetch");
  writeOmnirouteConfig(undefined, "fetch");
  const out = JSON.parse(readFileSync(join(dir, "omniroute.json"), "utf8"));
  assert.deepEqual(out, { search: { provider: "tavily-search" } });
});

test("readOmnirouteConfig: reads both branches independently", () => {
  const seedPath = join(dir, "omniroute.json");
  writeFileSync(seedPath, JSON.stringify({ search: { provider: "tavily-search" }, fetch: { provider: "firecrawl" } }));
  assert.deepEqual(readOmnirouteConfig(), { search: { provider: "tavily-search" }, fetch: { provider: "firecrawl" } });
});

test("readOmnirouteConfig: non-object fetch warns once but search is still read", () => {
  const seedPath = join(dir, "omniroute.json");
  writeFileSync(seedPath, JSON.stringify({ search: { provider: "tavily-search" }, fetch: 42 }));
  const origWarn = console.warn;
  let warns = 0;
  console.warn = () => { warns += 1; };
  let cfg: unknown;
  try {
    cfg = readOmnirouteConfig();
  } finally {
    console.warn = origWarn;
  }
  assert.equal(warns, 1, "exactly one warn for non-object fetch");
  assert.deepEqual(cfg, { search: { provider: "tavily-search" } });
});
```

- [ ] **Step 4: Fix the existing round-trip assertion**

In `test/search-config-persistence.test.ts`, update:

```ts
test("writeOmnirouteConfig: round-trips through read", () => {
  writeOmnirouteConfig("brave-search");
  assert.deepEqual(readOmnirouteConfig(), { search: { provider: "brave-search" } });
});
```

(The old `{ provider: "brave-search" }` shape assertion now fails because the return type gained the branch key.)

- [ ] **Step 5: Run tests to verify they fail**

Run: `npx tsx --test test/search-config-persistence.test.ts test/search-config-fetch-select-items.test.ts`
Expected: FAIL — new shape assertions mismatch (round-trip, branch cases), `buildFetchSelectItems` missing.

(New test count in this file: 4 additions + 1 modified = 5; totals in Task 6 already account for this.)

- [ ] **Step 6: Implement two-branch config in `src/tools/search-config.ts`**

Replace `readOmnirouteConfig` and `writeOmnirouteConfig`:

```ts
export interface OmnirouteConfigShape {
  readonly search?: { readonly provider?: string };
  readonly fetch?: { readonly provider?: string };
}

export function readOmnirouteConfig(): OmnirouteConfigShape {
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
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    console.warn(`[omniroute] ${path} root is not a plain object; treating as empty config`);
    return {};
  }
  const root = parsed as Record<string, unknown>;
  const result: OmnirouteConfigShape = {};
  for (const key of ["search", "fetch"] as const) {
    const branch = root[key];
    if (branch === undefined) continue;
    if (!branch || typeof branch !== "object" || Array.isArray(branch)) {
      console.warn(`[omniroute] ${path} \`${key}\` field is not a plain object; treating as empty config`);
      continue;
    }
    const provider = (branch as Record<string, unknown>)["provider"];
    if (typeof provider !== "string") {
      console.warn(`[omniroute] ${path} \`${key}.provider\` is not a string; treating as empty config`);
      continue;
    }
    result[key] = { provider };
  }
  return result;
}

export function writeOmnirouteConfig(provider: string | undefined, key: "search" | "fetch" = "search"): void {
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
    delete root[key];
  } else {
    if (!root[key] || typeof root[key] !== "object" || Array.isArray(root[key])) {
      root[key] = {};
    }
    (root[key] as Record<string, unknown>)["provider"] = provider;
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

- [ ] **Step 7: Implement normalizeFetchProvider + reader in `src/tools/web-fetch.ts`**

Add after the `FETCH_PROVIDERS` constant (no execute change yet):

```ts
export function normalizeFetchProvider(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  return (FETCH_PROVIDERS as readonly string[]).includes(raw) ? raw : undefined;
}

// --- Fetch provider config reader (injected by src/index.ts; same pattern as search.ts) ---
let getFetchConfigProvider: () => string | undefined = () => undefined;

export function setFetchConfigReader(fn: () => string | undefined): void {
  getFetchConfigProvider = fn;
}
```

- [ ] **Step 8: Implement buildFetchSelectItems in `src/tools/search-config.ts`**

Add the import (top of file, next to the pi-tui imports) and the function (near `buildSelectItems`):

```ts
import { FETCH_PROVIDERS, normalizeFetchProvider } from "./web-fetch.ts";
```

```ts
export function buildFetchSelectItems(currentFetchProvider: string | undefined): readonly SelectItem[] {
  const normalized = normalizeFetchProvider(currentFetchProvider);
  const check = (active: boolean): string => (active ? "✓ " : "");
  const isCurrentAuto = normalized === undefined;
  const autoItem: SelectItem = {
    value: AUTO_ID,
    label: `${check(isCurrentAuto)}${AUTO_LABEL}`,
  };
  const providerItems: SelectItem[] = FETCH_PROVIDERS.map((id) => ({
    value: id,
    label: `${check(id === normalized)}${id}`,
  }));
  return [autoItem, ...providerItems];
}
```

- [ ] **Step 9: Run all affected tests**

Run: `npx tsx --test test/search-config-persistence.test.ts test/search-config-fetch-select-items.test.ts`
Expected: PASS (new tests + updated round-trip; pre-existing persistence tests `{}` / warn-count assertions still pass — the loop only sets keys that exist).

- [ ] **Step 10: Add reader-gate unit tests (Task 5 prelude) — `test/web-fetch-merge.test.ts`**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeFetchProvider, FETCH_PROVIDERS } from "../src/tools/web-fetch.ts";

test("FETCH_PROVIDERS is the canonical static 4", () => {
  assert.deepEqual([...FETCH_PROVIDERS], ["firecrawl", "jina-reader", "tavily-search", "tinyfish"]);
});

test("normalizeFetchProvider: member id passes through", () => {
  for (const id of FETCH_PROVIDERS) {
    assert.equal(normalizeFetchProvider(id), id);
  }
});

test("normalizeFetchProvider: undefined / auto / invalid id -> undefined", () => {
  for (const v of [undefined, "auto", "unknown-provider", ""]) {
    assert.equal(normalizeFetchProvider(v), undefined, `raw=${String(v)}`);
  }
});
```

- [ ] **Step 11: Run the new merge test file**

Run: `npx tsx --test test/web-fetch-merge.test.ts`
Expected: PASS.

- [ ] **Step 12: Full check + commit**

Run: `npm run typecheck && npm test`
Expected: typecheck exit 0; 158 existing + 3 select-items + 4 persistence + 3 merge = 168 passing, 0 failing.

```bash
git add src/tools/web-fetch.ts src/tools/search-config.ts test/search-config-persistence.test.ts test/search-config-fetch-select-items.test.ts test/web-fetch-merge.test.ts
git commit -m "feat: two-branch omniroute config + fetch provider select items + normalize gate"
```

---

### Task 2: State machine — three modes + second cached submenu

**Files:**
- Modify: `src/tools/search-config.ts` (`createMenuStateMachine`, `MenuStateMachineDeps`, `MenuStateMachine`)
- Modify: `test/search-config-state-machine.test.ts`

**Interfaces:**
- Consumes: Task 1 — `buildFetchSelectItems`, `normalizeFetchProvider`, `readOmnirouteConfig` shape.
- Produces (used by Tasks 3–4):
  - `MenuMode = "top" | "sub-search" | "sub-fetch"`
  - `MenuStateMachineDeps` gains `readonly initialFetchProvider: string | undefined;` and `readonly onCommitFetchPersist: (provider: string | undefined) => void;`
  - `MenuStateMachine.mode: () => "top" | "sub-search" | "sub-fetch"`
  - `MenuStateMachine.onActivateFetchProvider(): void`

- [ ] **Step 1: Update failing tests in `test/search-config-state-machine.test.ts`**

Update `makeDeps` to provide the two new deps, and add fetch-branch tests:

```ts
function makeDeps(overrides: Partial<MenuStateMachineDeps> = {}): MenuStateMachineDeps {
  const commits: Array<[string | undefined, string]> = [];
  return {
    resolveApiKey: async () => "k",
    resolveBaseUrl: () => "http://x",
    initialCurrentProvider: undefined,
    initialFetchProvider: undefined,
    onCommitPersist: (provider) => commits.push([provider, "persisted"]),
    onCommitFetchPersist: () => {},
    onClose: () => {},
    ...overrides,
  };
}
```

Fix the mode assertion (was `"sub"`):

```ts
test("createMenuStateMachine: onActivateSearchProvider switches to sub-search mode (loading first)", () => {
  globalThis.fetch = mock.method(globalThis, "fetch", async () => jsonResponse(200, {
    data: [{ id: "tavily-search", name: "Tavily", search_types: ["web"] }],
  })) as never;
  const sm = createMenuStateMachine(makeDeps());
  sm.onActivateSearchProvider();
  assert.equal(sm.mode(), "sub-search");
  // catalog is undefined until the async fetch resolves
  assert.equal(sm.catalog(), undefined);
});
```

Append:

```ts
test("createMenuStateMachine: onActivateFetchProvider switches to sub-fetch mode", () => {
  const sm = createMenuStateMachine(makeDeps());
  sm.onActivateFetchProvider();
  assert.equal(sm.mode(), "sub-fetch");
  assert.equal(sm.catalog(), undefined);
});

test("createMenuStateMachine: fetch commit calls onCommitFetchPersist and returns to top", () => {
  const persisted: Array<string | undefined> = [];
  const sm = createMenuStateMachine(makeDeps({ onCommitFetchPersist: (p) => persisted.push(p) }));
  sm.onActivateFetchProvider();
  sm.onCommit("firecrawl");
  assert.deepEqual(persisted, ["firecrawl"]);
  assert.equal(sm.mode(), "top");
});

test("createMenuStateMachine: fetch cancel returns to top without persisting", () => {
  let persisted = false;
  const sm = createMenuStateMachine(makeDeps({ onCommitFetchPersist: () => { persisted = true; } }));
  sm.onActivateFetchProvider();
  sm.onCancel();
  assert.equal(sm.mode(), "top");
  assert.equal(persisted, false);
});

test("createMenuStateMachine: fetch submenu instance is cached across renders and recreated after reset", () => {
  const sm = createMenuStateMachine(makeDeps({ initialFetchProvider: "firecrawl" }));
  const tui = makeTui();
  sm.onActivateFetchProvider();
  const first = sm.getComponent(tui, fakeTheme);
  const second = sm.getComponent(tui, fakeTheme);
  assert.equal(first, second, "fetch submenu must be the same cached instance across renders");
  sm.onCommit("jina-reader");
  assert.equal(sm.mode(), "top");
  sm.onActivateFetchProvider();
  const third = sm.getComponent(tui, fakeTheme);
  assert.notEqual(third, first, "fetch submenu must be recreated after commit + re-activation");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test test/search-config-state-machine.test.ts`
Expected: FAIL — `"sub"` assertion mismatch + missing deps/fields (TS errors on `MenuStateMachineDeps`).

- [ ] **Step 3: Implement the three-mode state machine in `src/tools/search-config.ts`**

Update the interfaces:

```ts
export interface MenuStateMachineDeps {
  readonly resolveApiKey: () => Promise<string | undefined>;
  readonly resolveBaseUrl: () => string;
  readonly initialCurrentProvider: string | undefined;
  readonly initialFetchProvider: string | undefined;
  readonly onCommitPersist: (provider: string | undefined) => void;
  readonly onCommitFetchPersist: (provider: string | undefined) => void;
  readonly onClose: () => void;
}

export interface MenuStateMachine {
  getComponent(tui: TUI, theme: Theme): Component;
  onActivateSearchProvider(): void;
  onActivateFetchProvider(): void;
  onCommit(provider: string | undefined): void;
  onCancel(): void;
  onEsc(): void;
  readonly mode: () => "top" | "sub-search" | "sub-fetch";
  readonly catalog: () => SearchCatalog | undefined;
}
```

Inside `createMenuStateMachine`, change the state fields:

```ts
let mode: "top" | "sub-search" | "sub-fetch" = "top";
let currentProvider = deps.initialCurrentProvider;
let currentFetchProvider = deps.initialFetchProvider;
let catalogValue: SearchCatalog | undefined = undefined;
let pendingFetch: AbortController | undefined;
let cachedSubmenu: Component | undefined = undefined;
let cachedFetchSubmenu: Component | undefined = undefined;
```

Update `fetchCatalogAsync`'s staleness guard (`mode !== "sub"` → `mode !== "sub-search"`):

```ts
if (pendingFetch !== controller || mode !== "sub-search") return;
```

Update the returned object:

```ts
return {
  mode: () => mode,
  catalog: () => catalogValue,
  onActivateSearchProvider: () => {
    mode = "sub-search";
    catalogValue = undefined;
    cachedSubmenu = undefined;
  },
  onActivateFetchProvider: () => {
    mode = "sub-fetch";
    cachedFetchSubmenu = undefined;
  },
  onCommit: (provider) => {
    pendingFetch?.abort();
    if (mode === "sub-fetch") {
      cachedFetchSubmenu = undefined;
      currentFetchProvider = provider;
      deps.onCommitFetchPersist(provider);
    } else {
      cachedSubmenu = undefined;
      currentProvider = provider;
      deps.onCommitPersist(provider);
    }
    mode = "top";
    catalogValue = undefined;
  },
  onCancel: () => {
    cachedSubmenu = undefined;
    cachedFetchSubmenu = undefined;
    pendingFetch?.abort();
    mode = "top";
    catalogValue = undefined;
  },
  onEsc: () => {
    cachedSubmenu = undefined;
    cachedFetchSubmenu = undefined;
    pendingFetch?.abort();
    mode = "top";
    catalogValue = undefined;
    deps.onClose();
  },
  // getComponent: see Step 5 (renderFetchSubmenu arrives in Task 3; wire the
  // sub-fetch branch now with a minimal placeholder replaced in Task 3).
  getComponent: (tui: TUI, theme: Theme) => {
    if (mode === "top") {
      return renderTopLevelMenu({
        currentProvider,
        theme,
        onActivateSearchProvider: () => {
          mode = "sub-search";
          cachedSubmenu = undefined;
          tui.requestRender();
          void fetchCatalogAsync(tui);
        },
        onClose: () => {
          cachedSubmenu = undefined;
          pendingFetch?.abort();
          mode = "top";
          deps.onClose();
        },
        requestRender: () => tui.requestRender(),
      });
    }
    if (mode === "sub-search") {
      // …existing loading/catalog/cachedSubmenu logic unchanged…
    }
    // mode === "sub-fetch"
    if (cachedFetchSubmenu) return cachedFetchSubmenu;
    cachedFetchSubmenu = renderFetchSubmenu({
      currentFetchProvider,
      theme,
      requestRender: () => tui.requestRender(),
      onCommit: (p) => {
        cachedFetchSubmenu = undefined;
        currentFetchProvider = p;
        deps.onCommitFetchPersist(p);
        mode = "top";
        tui.requestRender();
      },
      onCancel: () => {
        cachedFetchSubmenu = undefined;
        mode = "top";
        tui.requestRender();
      },
    });
    return cachedFetchSubmenu;
  },
} as MenuStateMachine;
```

- [ ] **Step 4: Stub `renderFetchSubmenu` (real implementation in Task 3)**

Add a minimal stub so Task 2 compiles (replace in Task 3):

```ts
// Temporarily minimal — full official Pattern 1 implementation in Task 3.
export function renderFetchSubmenu(_params: FetchSubmenuParams): Component {
  return new Container() as unknown as Component;
}
```

Declare the params interface:

```ts
export interface FetchSubmenuParams {
  readonly currentFetchProvider: string | undefined;
  readonly theme: Theme;
  readonly onCommit: (provider: string | undefined) => void;
  readonly onCancel: () => void;
  readonly requestRender?: () => void;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx tsx --test test/search-config-state-machine.test.ts`
Expected: PASS (5 existing + 4 new fetch tests).

- [ ] **Step 6: Full check + commit**

Run: `npm run typecheck && npm test`
Expected: typecheck exit 0; all pass (submenu/toplevel tests unchanged).

```bash
git add src/tools/search-config.ts test/search-config-state-machine.test.ts
git commit -m "feat: three-mode settings state machine with fetch submenu cache"
```

---

### Task 3: Render — fetch submenu (official Pattern 1) + top-level two rows

**Files:**
- Modify: `src/tools/search-config.ts` (`renderFetchSubmenu` real implementation; `renderTopLevelMenu` two rows; `TopLevelMenuParams` gains `fetchPreview` + `onActivateFetchProvider`)
- Modify: `test/search-config-toplevel.test.ts` (params + fetch row assertions)
- Create: `test/search-config-fetch-submenu.test.ts`

**Interfaces:**
- Consumes: Task 1 `buildFetchSelectItems`; Task 2 `FetchSubmenuParams`, `MenuMode`.
- Produces (used by Task 4):
  - `renderFetchSubmenu(params: FetchSubmenuParams): Component` — full Pattern 1, exposes `_sl`
  - `TopLevelMenuParams` gains `readonly fetchPreview: string;` and `readonly onActivateFetchProvider: () => void;`
  - `renderTopLevelMenu` renders two rows (`value:"search"` / `value:"fetch"`) and dispatches onSelect by `item.value`

- [ ] **Step 1: Write failing tests — fetch submenu**

`test/search-config-fetch-submenu.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { initTheme, type Theme } from "@earendil-works/pi-coding-agent";
import { renderFetchSubmenu, type FetchSubmenuParams } from "../src/tools/search-config.ts";

// getSelectListTheme()/keyHint() 依赖全局 theme proxy —— 单测必须先初始化。幂等。
initTheme();

const fakeTheme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as unknown as Theme;

function makeParams(overrides: Partial<FetchSubmenuParams> = {}): FetchSubmenuParams {
  return {
    currentFetchProvider: undefined,
    theme: fakeTheme,
    onCommit: () => {},
    onCancel: () => {},
    ...overrides,
  };
}

function renderOutput(params: FetchSubmenuParams): string[] {
  const component = renderFetchSubmenu(params) as unknown as { render: (w: number) => string[] };
  return component.render(80);
}

test("renderFetchSubmenu: border top/bottom lines and title row", () => {
  const out = renderOutput(makeParams());
  const joined = out.join("\n");
  assert.match(out[0], /^─+$/, "first line must be the top border");
  assert.match(out[out.length - 1], /^─+$/, "last line must be the bottom border");
  assert.match(joined, /Web Fetch Provider/i, "title row must exist");
});

test("renderFetchSubmenu: renders the 5 static rows (auto + 4 providers)", () => {
  const out = renderOutput(makeParams({ currentFetchProvider: "firecrawl" }));
  const joined = out.join("\n");
  assert.match(joined, /Auto \(follow server default\)/);
  for (const id of ["firecrawl", "jina-reader", "tavily-search", "tinyfish"]) {
    assert.match(joined, new RegExp(id), `row for ${id} must exist`);
  }
});

test("renderFetchSubmenu: SelectItem rows have no value column", () => {
  const component = renderFetchSubmenu(makeParams()) as unknown as { _sl: { items: Array<{ value: string; label: string; currentValue?: unknown; values?: unknown[] }> } };
  for (const item of component._sl.items) {
    assert.equal(item.currentValue, undefined, `item ${item.value} must not carry currentValue`);
    assert.equal(item.values, undefined, `item ${item.value} must not carry values`);
  }
});

test("renderFetchSubmenu: ✓ marker on active provider row only", () => {
  const out = renderOutput(makeParams({ currentFetchProvider: "firecrawl" }));
  const joined = out.join("\n");
  assert.match(joined, /✓ firecrawl/, "active provider row must show ✓ prefix");
  assert.doesNotMatch(joined, /✓ jina-reader/, "inactive provider row must not show ✓");
});

test("renderFetchSubmenu: ✓ marker on auto row when unconfigured", () => {
  const out = renderOutput(makeParams());
  assert.match(out.join("\n"), /✓ Auto \(follow server default\)/, "auto row must be checked when unconfigured");
});

test("renderFetchSubmenu: Enter on provider row commits its value", () => {
  const calls: Array<[string, unknown?]> = [];
  const params = makeParams({ onCommit: (p) => calls.push(["commit", p]) });
  const component = renderFetchSubmenu(params) as unknown as { _sl: { onSelect?: (item: { value: string; label: string }) => void } };
  component._sl.onSelect?.({ value: "firecrawl", label: "firecrawl" });
  assert.deepEqual(calls, [["commit", "firecrawl"]]);
});

test("renderFetchSubmenu: Enter on auto row commits undefined", () => {
  const calls: Array<[string, unknown?]> = [];
  const params = makeParams({ onCommit: (p) => calls.push(["commit", p]) });
  const component = renderFetchSubmenu(params) as unknown as { _sl: { onSelect?: (item: { value: string; label: string }) => void } };
  component._sl.onSelect?.({ value: "auto", label: "Auto (follow server default)" });
  assert.deepEqual(calls, [["commit", undefined]]);
});

test("renderFetchSubmenu: Esc invokes onCancel", () => {
  const calls: Array<[string, unknown?]> = [];
  const params = makeParams({ onCancel: () => calls.push(["cancel"]) });
  const component = renderFetchSubmenu(params) as unknown as { handleInput: (data: string) => void };
  component.handleInput("\x1b");
  assert.deepEqual(calls, [["cancel"]]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test test/search-config-fetch-submenu.test.ts`
Expected: FAIL — stub renders empty Container, no rows/title/`_sl`.

- [ ] **Step 3: Write failing tests — top-level two rows**

Update `test/search-config-toplevel.test.ts` — `makeParams` gains the two new fields and fetch-row assertions:

```ts
function makeParams(overrides: Partial<TopLevelMenuParams> = {}): TopLevelMenuParams {
  return {
    currentProvider: "tavily-search",
    fetchPreview: "Auto",
    theme: fakeTheme,
    onActivateSearchProvider: () => {},
    onActivateFetchProvider: () => {},
    ...overrides,
  };
}

test("renderTopLevelMenu: renders both rows with previews", () => {
  const params = makeParams({ currentProvider: "tavily-search", fetchPreview: "firecrawl" });
  const component = renderTopLevelMenu(params) as unknown as { render: (w: number) => string[] };
  const joined = component.render(80).join("\n");
  assert.match(joined, /Search provider:\s+tavily-search/i);
  assert.match(joined, /Web Fetch provider:\s+firecrawl/i);
});

test("renderTopLevelMenu: Enter on fetch row activates fetch provider", () => {
  let activated = "";
  const params = makeParams({
    onActivateSearchProvider: () => { activated = "search"; },
    onActivateFetchProvider: () => { activated = "fetch"; },
  });
  const component = renderTopLevelMenu(params) as unknown as { _sl: { onSelect?: (item: { value: string; label: string }) => void } };
  component._sl.onSelect?.({ value: "fetch", label: "Web Fetch provider: Auto" });
  assert.equal(activated, "fetch");
});
```

(The pre-existing `Enter triggers onActivateSearchProvider` test keeps passing: SelectList starts at selectedIndex 0 = the search row, and Enter fires onSelect with the search item.)

- [ ] **Step 4: Run tests to verify they fail**

Run: `npx tsx --test test/search-config-toplevel.test.ts`
Expected: FAIL — TS error (missing `fetchPreview`/`onActivateFetchProvider` in params) + no fetch row rendered.

- [ ] **Step 5: Implement `renderFetchSubmenu` (replace the Task 2 stub) in `src/tools/search-config.ts`**

```ts
export function renderFetchSubmenu(params: FetchSubmenuParams): Component {
  const items = buildFetchSelectItems(params.currentFetchProvider);
  const { theme } = params;
  const selectList = new SelectList([...items], Math.min(items.length, 15), getSelectListTheme());
  selectList.onSelect = (item: SelectItem): void => {
    if (item.value === AUTO_ID) {
      params.onCommit(undefined);
    } else {
      params.onCommit(item.value);
    }
  };
  selectList.onCancel = params.onCancel;

  const container = new Container();
  container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
  container.addChild(new Text(theme.fg("accent", theme.bold("Web Fetch Provider")), 1, 0));
  container.addChild(selectList as unknown as Component);
  container.addChild(new Text(theme.fg("dim", keyHint("tui.select.up", "navigate") + " · " + keyHint("tui.select.confirm", "select") + " · " + keyHint("tui.select.cancel", "back")), 1, 0));
  container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

  // A bare Container does not forward input; route keypresses to the SelectList.
  (container as unknown as { handleInput: (data: string) => void }).handleInput = (data: string): void => {
    selectList.handleInput(data);
    params.requestRender?.();
  };

  // Expose the SelectList for unit tests.
  (container as unknown as { _sl: SelectList })._sl = selectList;

  return container as unknown as Component;
}
```

- [ ] **Step 6: Implement the two-row `renderTopLevelMenu` in `src/tools/search-config.ts`**

Update the params interface and the function:

```ts
export interface TopLevelMenuParams {
  readonly currentProvider: string | undefined;
  readonly fetchPreview: string;                     // "Auto" or provider id
  readonly theme: Theme;
  readonly onActivateSearchProvider: () => void;
  readonly onActivateFetchProvider: () => void;
  readonly onClose?: () => void;
  readonly requestRender?: () => void;
}

export function renderTopLevelMenu(params: TopLevelMenuParams): Component {
  const { currentProvider, fetchPreview, theme } = params;
  const preview = previewForProvider(currentProvider);
  const items: SelectItem[] = [
    { value: "search", label: `Search provider: ${preview}` },
    { value: "fetch", label: `Web Fetch provider: ${fetchPreview}` },
  ];
  const selectList = new SelectList(items, items.length, getSelectListTheme());
  selectList.onSelect = (item: SelectItem): void => {
    if (item.value === "fetch") {
      params.onActivateFetchProvider();
    } else {
      params.onActivateSearchProvider();
    }
  };
  selectList.onCancel = () => params.onClose?.();

  const container = new Container();
  container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
  container.addChild(new Text(theme.fg("accent", theme.bold("OmniRoute Settings")), 1, 0));
  container.addChild(selectList as unknown as Component);
  container.addChild(new Text(theme.fg("dim", keyHint("tui.select.confirm", "activate") + " · " + keyHint("tui.select.cancel", "close")), 1, 0));
  container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

  (container as unknown as { handleInput: (data: string) => void }).handleInput = (data: string): void => {
    selectList.handleInput(data);
    params.requestRender?.();
  };
  return container as unknown as Component;
}
```

- [ ] **Step 7: Wire the top-level onActivateFetchProvider + fetchPreview in the state machine**

In `createMenuStateMachine`'s `getComponent` top branch, pass the new fields:

```ts
return renderTopLevelMenu({
  currentProvider,
  fetchPreview: previewForProvider(currentFetchProvider),
  theme,
  onActivateSearchProvider: () => {
    mode = "sub-search";
    cachedSubmenu = undefined;
    tui.requestRender();
    void fetchCatalogAsync(tui);
  },
  onActivateFetchProvider: () => {
    mode = "sub-fetch";
    cachedFetchSubmenu = undefined;
    tui.requestRender();
  },
  onClose: () => {
    cachedSubmenu = undefined;
    cachedFetchSubmenu = undefined;
    pendingFetch?.abort();
    mode = "top";
    deps.onClose();
  },
  requestRender: () => tui.requestRender(),
});
```

(`previewForProvider` already returns `"Auto"` for `undefined`/`"auto"`, which matches the fetch preview rule since `currentFetchProvider` is normalized at load — it can only be a member id or `undefined`.)

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx tsx --test test/search-config-fetch-submenu.test.ts test/search-config-toplevel.test.ts test/search-config-state-machine.test.ts`
Expected: PASS.

- [ ] **Step 9: Full check + commit**

Run: `npm run typecheck && npm test`
Expected: typecheck exit 0; all pass.

```bash
git add src/tools/search-config.ts test/search-config-toplevel.test.ts test/search-config-fetch-submenu.test.ts
git commit -m "feat: official fetch submenu + two-row top-level settings menu"
```

---

### Task 4: Wiring — index.ts session_start + fetch reader + fetch preview

**Files:**
- Modify: `src/index.ts` (fetch reader injection, session_start, handler deps, command description)
- Create: `test/session-start-fetch-config.test.ts`

**Interfaces:**
- Consumes: Task 1 `normalizeFetchProvider`, `setFetchConfigReader`, two-branch `readOmnirouteConfig`; Task 2 `initialFetchProvider` + `onCommitFetchPersist` deps.
- Produces: module-level `currentFetchProvider` in index.ts; `setFetchConfigReader(() => currentFetchProvider)` wired; `session_start` sets both `currentConfigProvider` and `currentFetchProvider`.

- [ ] **Step 1: Write failing tests — session_start fetch loading**

`test/session-start-fetch-config.test.ts` (mirrors `session-start-config.test.ts`):

```ts
// Verifies that src/index.ts wires session_start into the fetch tool's config
// reader: on session start it reads omniroute.json's fetch.provider, normalizes
// it, and makes webFetchTool's effective provider come from that persisted
// config (when no explicit provider is passed).
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Provider } from "@earendil-works/pi-ai";
import entry from "../src/index.ts";
import { webFetchTool, setFetchConfigReader } from "../src/tools/web-fetch.ts";
import { searchTool, setSearchConfigReader } from "../src/tools/search.ts";

let capturedProvider: Provider<"openai-completions"> | undefined;
let capturedSessionStart: ((...args: unknown[]) => unknown) | undefined;

const origPiAgentDir = process.env.PI_AGENT_DIR;
let dir: string;

beforeEach(() => {
  capturedProvider = undefined;
  capturedSessionStart = undefined;
  dir = mkdtempSync(join(tmpdir(), "omniroute-session-start-fetch-test-"));
  process.env.PI_AGENT_DIR = dir;
});

after(() => {
  if (origPiAgentDir === undefined) delete process.env.PI_AGENT_DIR;
  else process.env.PI_AGENT_DIR = origPiAgentDir;
  setFetchConfigReader(() => undefined);
  setSearchConfigReader(() => undefined);
});

function mockPi(): ExtensionAPI {
  const handlers: Record<string, ((...args: unknown[]) => unknown) | undefined> = {};
  return {
    registerProvider: (p: Provider) => {
      capturedProvider = p as Provider<"openai-completions">;
    },
    registerTool: () => {},
    on: (event: string, fn: (...args: unknown[]) => unknown) => {
      handlers[event] = fn;
      if (event === "session_start") capturedSessionStart = fn;
    },
  } as unknown as ExtensionAPI;
}

function fakeCtx(apiKey: string | undefined): ExtensionContext {
  return {
    model: undefined,
    modelRegistry: { getApiKeyForProvider: async () => apiKey },
  } as unknown as ExtensionContext;
}

async function effectiveProviderForFetch(): Promise<string | undefined> {
  const original = globalThis.fetch;
  let body: Record<string, unknown> = {};
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    body = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ markdown: "# ok" }), { status: 200 });
  }) as typeof fetch;
  try {
    await webFetchTool.execute(
      "call-1",
      { url: "https://example.com" } as never,
      undefined,
      undefined,
      fakeCtx("test-key"),
    );
  } finally {
    globalThis.fetch = original;
  }
  return body.provider as string | undefined;
}

function sessionCtx(): unknown {
  return {
    sessionManager: { getBranch: () => [] },
    modelRegistry: {},
  };
}

test("session_start: reads fetch.provider and webFetchTool uses it", async () => {
  writeFileSync(join(dir, "omniroute.json"), JSON.stringify({ fetch: { provider: "firecrawl" } }));
  await entry(mockPi());
  assert.ok(capturedSessionStart, "session_start hook must be registered");
  await capturedSessionStart!({}, sessionCtx() as never);
  assert.equal(await effectiveProviderForFetch(), "firecrawl");
});

test("session_start: invalid fetch.provider id is normalized to auto", async () => {
  writeFileSync(join(dir, "omniroute.json"), JSON.stringify({ fetch: { provider: "foo" } }));
  await entry(mockPi());
  await capturedSessionStart!({}, sessionCtx() as never);
  assert.equal(await effectiveProviderForFetch(), undefined);
});

test("session_start: fetch config does not leak into search tool", async () => {
  writeFileSync(join(dir, "omniroute.json"), JSON.stringify({ fetch: { provider: "firecrawl" } }));
  await entry(mockPi());
  await capturedSessionStart!({}, sessionCtx() as never);
  // search reader is untouched by fetch config (run searchTool directly).
  assert.equal(await effectiveProviderForFetch(), "firecrawl");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test test/session-start-fetch-config.test.ts`
Expected: FAIL — webFetchTool sends no provider (reader not wired) → `body.provider === undefined` instead of `"firecrawl"`.

- [ ] **Step 3: Implement wiring in `src/index.ts`**

Update the imports and module state:

```ts
import { searchTool, setSearchConfigReader } from "./tools/search.ts";
import { webFetchTool, setFetchConfigReader, normalizeFetchProvider } from "./tools/web-fetch.ts";
import { readOmnirouteConfig, createMenuStateMachine, writeOmnirouteConfig } from "./tools/search-config.ts";

let currentConfigProvider: string | undefined = undefined;
setSearchConfigReader(() => currentConfigProvider);

let currentFetchProvider: string | undefined = undefined;
setFetchConfigReader(() => currentFetchProvider);
```

Update `session_start`:

```ts
pi.on?.("session_start", async () => {
  const cfg = readOmnirouteConfig();
  currentConfigProvider = cfg.search?.provider;
  currentFetchProvider = normalizeFetchProvider(cfg.fetch?.provider);
});
```

Update the handler's state machine construction:

```ts
const sm = createMenuStateMachine({
  resolveApiKey: () => resolveApiKey(ctx),
  resolveBaseUrl: () => resolveBaseUrl(ctx),
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
  onClose: () => {},
});
```

Update the command description (optional, keeps docs accurate):

```ts
pi.registerCommand?.("omniroute-settings", {
  description: "OmniRoute settings (search / web-fetch provider)",
  handler: ...
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test test/session-start-fetch-config.test.ts test/session-start-config.test.ts`
Expected: PASS (both files; the existing search test still passes because `cfg.search?.provider` reads the same value as the old `cfg.provider`).

- [ ] **Step 5: Full check + commit**

Run: `npm run typecheck && npm test`
Expected: typecheck exit 0; all pass (including `test/command-register.test.ts` — its theme stub is unaffected; no new imports there).

```bash
git add src/index.ts test/session-start-fetch-config.test.ts
git commit -m "feat: load fetch provider config on session_start and wire fetch reader"
```

---

### Task 5: web-fetch tool — three-state provider merge

**Files:**
- Modify: `src/tools/web-fetch.ts` (`execute` merge)
- Modify: `test/web-fetch-merge.test.ts` (add execute-level merge tests)

**Interfaces:**
- Consumes: Task 1 `normalizeFetchProvider` + `getFetchConfigProvider` (module closure); Task 4 `setFetchConfigReader` wiring.
- Produces: `webFetchTool.execute` merges `params.provider ?? normalizeFetchProvider(getFetchConfigProvider())`.

- [ ] **Step 1: Write failing tests — execute-level merge**

Append to `test/web-fetch-merge.test.ts` (reuse the capture-body pattern; model on `test/search-tool-merge.test.ts`):

```ts
import { test, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionContext, AgentToolResult } from "@earendil-works/pi-coding-agent";
import { webFetchTool, setFetchConfigReader, normalizeFetchProvider, FETCH_PROVIDERS } from "../src/tools/web-fetch.ts";

const execTool = webFetchTool as unknown as {
  execute: (...args: unknown[]) => Promise<AgentToolResult<unknown>>;
};

async function runFetchWithParams(params: Record<string, unknown>): Promise<unknown> {
  let lastBody: unknown;
  const origFetch = globalThis.fetch;
  globalThis.fetch = mock.method(globalThis, "fetch", async (_url: string, init?: RequestInit) => {
    lastBody = init?.body ? JSON.parse(init.body as string) : undefined;
    return { ok: true, status: 200, json: async () => ({ markdown: "# ok" }) } as Response;
  }) as never;
  try {
    await execTool.execute("call-id", params, undefined, () => {}, {
      ui: { notify: () => {} },
      sessionManager: { getBranch: () => [] },
      modelRegistry: { getApiKeyForProvider: () => "test-key" } as never,
    } as unknown as ExtensionContext);
  } finally {
    globalThis.fetch = origFetch;
  }
  return lastBody;
}

const origPiAgentDir = process.env.PI_AGENT_DIR;
before(() => {
  process.env.PI_AGENT_DIR = mkdtempSync(join(tmpdir(), "omniroute-fetch-merge-test-"));
  process.env.OMNIROUTE_API_KEY = "test-key";
});
after(() => {
  if (origPiAgentDir === undefined) delete process.env.PI_AGENT_DIR;
  else process.env.PI_AGENT_DIR = origPiAgentDir;
  delete process.env.OMNIROUTE_API_KEY;
  setFetchConfigReader(() => undefined);
});

test("fetch: explicit params.provider overrides config", async () => {
  setFetchConfigReader(() => "firecrawl");
  const body = await runFetchWithParams({ url: "https://x", provider: "tinyfish" });
  assert.equal((body as { provider?: string }).provider, "tinyfish");
});

test("fetch: config provider is injected when params.provider is undefined", async () => {
  setFetchConfigReader(() => "jina-reader");
  const body = await runFetchWithParams({ url: "https://x" });
  assert.equal((body as { provider?: string }).provider, "jina-reader");
});

test("fetch: config undefined or 'auto' omits provider from body", async () => {
  for (const v of [undefined, "auto"]) {
    setFetchConfigReader(() => v);
    const body = await runFetchWithParams({ url: "https://x" });
    assert.equal((body as { provider?: string }).provider, undefined, `config=${v}`);
  }
});

test("fetch: config invalid string (not in static list) is omitted (defensive)", async () => {
  setFetchConfigReader(() => "unknown-provider");
  const body = await runFetchWithParams({ url: "https://x" });
  assert.equal((body as { provider?: string }).provider, undefined);
});

test("fetch: explicit params.provider is not schema-gated here (schema test covers literals)", async () => {
  setFetchConfigReader(() => undefined);
  const body = await runFetchWithParams({ url: "https://x", provider: "firecrawl" });
  assert.equal((body as { provider?: string }).provider, "firecrawl");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test test/web-fetch-merge.test.ts`
Expected: FAIL — config injection tests get `undefined` because execute doesn't read the reader yet.

- [ ] **Step 3: Implement the merge in `src/tools/web-fetch.ts` `execute`**

Replace the request-body construction inside `execute`:

```ts
const baseUrl = resolveBaseUrl(ctx);
const timeoutMs = params.timeoutMs ?? 30_000;
// Three-state merge: explicit param > configured (normalized member) > omitted.
const effectiveProvider = params.provider ?? normalizeFetchProvider(getFetchConfigProvider());
const res = await omnirouteRequest("/web/fetch", buildFetchBody({ ...params, provider: effectiveProvider }), {
  apiKey,
  baseUrl,
  signal,
  timeoutMs,
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test test/web-fetch-merge.test.ts test/tools-web-fetch.test.ts`
Expected: PASS (5 new merge tests + existing web-fetch tool tests — `buildFetchBody`/`extractFetchContent` untouched).

- [ ] **Step 5: Full check + commit**

Run: `npm run typecheck && npm test`
Expected: typecheck exit 0; all pass.

```bash
git add src/tools/web-fetch.ts test/web-fetch-merge.test.ts
git commit -m "feat: three-state provider merge in webFetchTool.execute"
```

---

### Task 6: Verification & close-out

**Files:**
- Verify-only (no source changes unless a check fails)
- Modify: `openspec/changes/add-web-fetch-provider-selection/tasks.md` (tick all boxes)

**Interfaces:**
- Consumes: all prior tasks.

- [ ] **Step 1: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 2: Full test suite**

Run: `npm test`
Expected: all pass. Expected totals: 158 existing + 3 (select-items) + 4 (persistence additions) + 3 (merge reader) + 4 (state machine) + 8 (fetch submenu) + 2 (toplevel additions) + 3 (session-start-fetch) + 5 (execute merge) = 190.

- [ ] **Step 3: Scope check — only expected files changed**

Run: `git diff --name-only $(git rev-parse HEAD~5)`
Expected: exactly:
- `src/tools/web-fetch.ts`
- `src/tools/search-config.ts`
- `src/index.ts`
- `test/search-config-persistence.test.ts`
- `test/search-config-state-machine.test.ts`
- `test/search-config-toplevel.test.ts`
- `test/search-config-fetch-select-items.test.ts`
- `test/search-config-fetch-submenu.test.ts`
- `test/web-fetch-merge.test.ts`
- `test/session-start-fetch-config.test.ts`
- `openspec/changes/add-web-fetch-provider-selection/*`

Run also: `git diff --name-only HEAD~5 | grep -E 'src/(auth|auth-credentials|tools/http)\.ts|test/(lazy-fetch|auth-credentials|url|tools-.*|search-config\.test|search-config-constants|search-config-submenu|search-config-select-items)'`
Expected: no output (untouchable files untouched).

- [ ] **Step 4: Residue grep — no leaked legacy symbols**

Run: `grep -rn "SettingsList\|getSettingsListTheme\|buildProviderItems\|smTheme" src/ test/ | grep -v node_modules || true`
Expected: no matches (fetch path must not reintroduce SettingsList-era code).

- [ ] **Step 5: Tick tasks.md (content only, NOT committed per user rule)**

In `openspec/changes/add-web-fetch-provider-selection/tasks.md`, flip every `- [ ]` to `- [x]` (1.1, 1.2, 2.1, 3.1, 3.2, 4.1, 4.2, 5.1, 6.1, 6.2).

- [ ] **Step 6: Final commit**

```bash
git add openspec/changes/add-web-fetch-provider-selection/tasks.md
git commit -m "docs(openspec): tick all tasks for add-web-fetch-provider-selection"
```

- [ ] **Step 7: Report**

Summarize: commit list, test count, typecheck status, any deviations (expect none beyond the planned ones), and the OpenSpec status check:

Run: `openspec-cn status --change "add-web-fetch-provider-selection" --json`
Expected: `isComplete: true`, artifacts all `done`.

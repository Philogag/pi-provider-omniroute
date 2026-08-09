// src/tools/search-config.ts
// Catalog fetch + persistence + TUI renderers for the search provider config.

import { Container, Input, Loader, SelectList, Text, type Component, type SelectItem } from "@earendil-works/pi-tui";
import type { TUI } from "@earendil-works/pi-tui";
import { DynamicBorder, getSelectListTheme, keyHint, type Theme } from "@earendil-works/pi-coding-agent";
import { readFileSync, writeFileSync, renameSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { FETCH_PROVIDERS, normalizeFetchProvider } from "./web-fetch.ts";
import { OMNIROUTE_DEFAULT_BASE_URL, validateAndNormalizeBaseUrl } from "../auth.ts";

export function sanitizeBaseUrlForPersist(input: string): { ok: true; value: string | undefined } | { ok: false } {
  const trimmed = input.trim();
  if (trimmed === "") return { ok: true, value: undefined }; // empty → delete, fall through to env/default
  try {
    return { ok: true, value: validateAndNormalizeBaseUrl(trimmed) };
  } catch {
    return { ok: false }; // invalid URL → refuse to persist, keep current value
  }
}

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

// Backward-compatible alias so the array remains a single source of truth.
export const SEARCH_PROVIDERS = STATIC_FALLBACK_PROVIDERS;

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
  readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "SearchCatalogError";
    this.cause = cause;
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
export const DEFAULT_TIMEOUT_MS = 10_000;

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

// --- Provider submenu ---

export interface ProviderSubmenuParams {
  readonly currentProvider: string | undefined;
  readonly catalog: SearchCatalog;
  readonly theme: Theme;                       // UI theme (has .fg)
  readonly onCommit: (provider: string | undefined) => void;
  readonly onCancel: () => void;
  readonly requestRender?: () => void;         // Pattern 1: repaint after input
}

const AUTO_ID = "auto";
const AUTO_LABEL = "Auto (follow server default)";

export function buildSelectItems(params: ProviderSubmenuParams): readonly SelectItem[] {
  const { currentProvider, catalog } = params;
  const isCurrentAuto = currentProvider === undefined || currentProvider === "auto";
  const check = (active: boolean): string => (active ? "✓ " : "");
  const autoItem: SelectItem = {
    value: AUTO_ID,
    label: `${check(isCurrentAuto)}${AUTO_LABEL}`,
  };
  const providerItems: SelectItem[] = catalog.providers.map((p) => ({
    value: p.id,
    label: `${check(p.id === currentProvider)}${p.name || p.id}`,
  }));
  return [autoItem, ...providerItems];
}

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

export function renderProviderSubmenu(params: ProviderSubmenuParams): Component {
  const items = buildSelectItems(params);
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
  container.addChild(new Text(theme.fg("accent", theme.bold("Search Provider")), 1, 0));
  if (params.catalog.isFallback) {
    container.addChild(new Text(theme.fg("warning", "OmniRoute search catalog unreachable, using built-in list"), 1, 0));
  }
  container.addChild(selectList as unknown as Component);
  container.addChild(new Text(theme.fg("dim", keyHint("tui.select.up", "navigate") + " · " + keyHint("tui.select.confirm", "select") + " · " + keyHint("tui.select.cancel", "back")), 1, 0));
  container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

  // A bare Container does not forward input; route keypresses to the SelectList.
  (container as unknown as { handleInput: (data: string) => void }).handleInput = (data: string): void => {
    selectList.handleInput(data);
    params.requestRender?.();
  };

  // Expose the SelectList for unit tests (see test/search-config-submenu.test.ts).
  (container as unknown as { _sl: SelectList })._sl = selectList;

  return container as unknown as Component;
}

// --- Top-level menu ---

export interface TopLevelMenuParams {
  readonly currentProvider: string | undefined;
  readonly fetchPreview: string;                     // "Auto" or provider id
  readonly baseUrlPreview: string;                   // current effective base URL
  readonly theme: Theme;                             // UI theme
  readonly onActivateSearchProvider: () => void;
  readonly onActivateFetchProvider: () => void;
  readonly onActivateBaseUrl: () => void;
  readonly onClose?: () => void;                     // Esc at top closes the overlay
  readonly requestRender?: () => void;               // Pattern 1: repaint after input
}

function previewForProvider(p: string | undefined): string {
  if (p === undefined || p === "auto") return "Auto";
  return p;
}

export function renderTopLevelMenu(params: TopLevelMenuParams): Component {
  const { currentProvider, fetchPreview, baseUrlPreview, theme } = params;
  const preview = previewForProvider(currentProvider);
  const items: SelectItem[] = [
    { value: "search", label: `Search provider: ${preview}` },
    { value: "fetch", label: `Web Fetch provider: ${fetchPreview}` },
    { value: "base-url", label: `Base URL: ${baseUrlPreview}` },
  ];
  const selectList = new SelectList(items, items.length, getSelectListTheme());
  selectList.onSelect = (item: SelectItem): void => {
    if (item.value === "fetch") {
      params.onActivateFetchProvider();
    } else if (item.value === "base-url") {
      params.onActivateBaseUrl();
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

  // Expose the SelectList for unit tests (see test/search-config-toplevel.test.ts).
  (container as unknown as { _sl: SelectList })._sl = selectList;

  return container as unknown as Component;
}

// --- omniroute.json persistence ---

export function resolveOmnirouteConfigPath(): string {
  const fromEnv = process.env.PI_AGENT_DIR;
  const base = fromEnv || join(homedir(), ".pi", "agent");
  return join(base, "omniroute.json");
}

export interface OmnirouteConfigShape {
  readonly baseUrl?: string;
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
  const result: { baseUrl?: string; search?: { provider: string }; fetch?: { provider: string } } = {};
  const rawBaseUrl = root["baseUrl"];
  if (typeof rawBaseUrl === "string") result.baseUrl = rawBaseUrl;
  else if (rawBaseUrl !== undefined) {
    console.warn(`[omniroute] ${path} \`baseUrl\` is not a string; treating as unset`);
  }
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

export function writeOmnirouteBaseUrl(baseUrl: string | undefined): void {
  const path = resolveOmnirouteConfigPath();
  const tmp = path + ".tmp";
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
  }
  if (baseUrl === undefined) delete root["baseUrl"];
  else root["baseUrl"] = baseUrl;
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(tmp, JSON.stringify(root, null, 2) + "\n", { mode: 0o600 });
    renameSync(tmp, path);
  } catch (err) {
    console.warn(`[omniroute] failed to write ${path}: ${(err as Error).message}`);
    try { unlinkSync(tmp); } catch { /* ignore */ }
  }
}

export function resolveOmnirouteBaseUrl(): string {
  return (
    readOmnirouteConfig().baseUrl ??
    process.env.OMNIROUTE_BASE_URL ??
    OMNIROUTE_DEFAULT_BASE_URL
  );
}

// --- Fetch provider submenu ---

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

export interface FetchSubmenuParams {
  readonly currentFetchProvider: string | undefined;
  readonly theme: Theme;
  readonly onCommit: (provider: string | undefined) => void;
  readonly onCancel: () => void;
  readonly requestRender?: () => void;
}

// --- Base URL submenu ---

export interface BaseUrlSubmenuParams {
  readonly currentBaseUrl: string;
  readonly theme: Theme;
  readonly onCommit: (baseUrl: string) => void;
  readonly onCancel: () => void;
  readonly requestRender?: () => void;           // Pattern 1: repaint after input
}

export function renderBaseUrlSubmenu(params: BaseUrlSubmenuParams): Component {
  const { theme } = params;
  const input = new Input();
  input.setValue(params.currentBaseUrl);
  input.onSubmit = (value: string) => params.onCommit(value);
  input.onEscape = params.onCancel;

  const container = new Container();
  container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
  container.addChild(new Text(theme.fg("accent", theme.bold("Base URL")), 1, 0));
  container.addChild(input as unknown as Component);
  container.addChild(new Text(theme.fg("dim", keyHint("tui.input.submit", "save") + " · " + keyHint("tui.select.cancel", "back")), 1, 0));
  container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

  // A bare Container does not forward input; route keypresses to the Input.
  (container as unknown as { handleInput: (data: string) => void }).handleInput = (data: string): void => {
    input.handleInput(data);
    params.requestRender?.();
  };

  // Expose the Input for unit tests (see test/search-config-baseurl.test.ts).
  (container as unknown as { _input: Input })._input = input;

  return container as unknown as Component;
}

// --- Menu state machine ---

export interface MenuStateMachineDeps {
  // These are bound (ctx-free) so the caller can inject the real command ctx
  // as a factory-time closure (see the /omniroute-settings handler). This avoids
  // threading an unset ctxRef through the machine's internal fetch path.
  readonly resolveApiKey: () => Promise<string | undefined>;
  readonly resolveBaseUrl: () => string;
  readonly initialCurrentProvider: string | undefined;
  readonly initialFetchProvider: string | undefined;
  readonly initialBaseUrl: string | undefined;
  readonly onCommitPersist: (provider: string | undefined) => void;
  readonly onCommitFetchPersist: (provider: string | undefined) => void;
  readonly onCommitBaseUrlPersist: (baseUrl: string | undefined) => void;
  readonly onClose: () => void;
}

export interface MenuStateMachine {
  getComponent(tui: TUI, theme: Theme): Component;
  onActivateSearchProvider(): void;
  onActivateFetchProvider(): void;
  onActivateBaseUrl(): void;
  onCommit(provider: string | undefined): void;
  onCancel(): void;
  onEsc(): void;
  readonly mode: () => "top" | "sub-search" | "sub-fetch" | "sub-base-url";
  readonly catalog: () => SearchCatalog | undefined;
}

export function createMenuStateMachine(deps: MenuStateMachineDeps): MenuStateMachine {
  let mode: "top" | "sub-search" | "sub-fetch" | "sub-base-url" = "top";
  let currentProvider = deps.initialCurrentProvider;
  let currentFetchProvider = deps.initialFetchProvider;
  let currentBaseUrl = deps.initialBaseUrl ?? "";
  let catalogValue: SearchCatalog | undefined = undefined;
  let pendingFetch: AbortController | undefined;
  // Memoized submenu component (design §9.3): the SelectList inside
  // renderProviderSubmenu keeps its cursor (selectedIndex) in instance state,
  // so we must return the SAME instance across renders/inputs while in sub
  // mode, or the cursor resets to row 0 on every frame and the submenu becomes
  // keyboard-unusable. Invalidated on every top<->sub transition and reset.
  let cachedSubmenu: Component | undefined = undefined;
  let cachedFetchSubmenu: Component | undefined = undefined;
  let cachedBaseUrlSubmenu: Component | undefined = undefined;
  // Memoized top-level component (same rationale as the submenu caches): the
  // SelectList inside renderTopLevelMenu keeps its cursor (selectedIndex) in
  // instance state, so we must return the SAME instance across renders/inputs
  // while in top mode, or the cursor resets to row 0 on every frame and the
  // Memoized menu components become keyboard-unusable (the "Web Fetch provider" row would
  // be unreachable). Invalidated on every mode transition / close.
  let cachedTopLevel: Component | undefined = undefined;

  const fetchCatalogAsync = async (tui: TUI): Promise<void> => {
    const controller = new AbortController();
    pendingFetch = controller;
    const apiKey = await deps.resolveApiKey();
    if (!apiKey) {
      // Caller is expected to handle the missing key via onClose path; we set no catalog and let the caller decide.
      return;
    }
    const baseUrl = deps.resolveBaseUrl();
    try {
      const c = await resolveSearchCatalog(baseUrl, apiKey, controller.signal);
      // Only apply if this is still the current fetch and the user is still in sub
      // mode. A later onActivateSearchProvider may have replaced pendingFetch, and
      // a reset path may have aborted the in-flight request; both make this stale.
      if (pendingFetch !== controller || mode !== "sub-search") return;
      catalogValue = c;
      // The Loading component stays on screen until the TUI is told to repaint.
      tui.requestRender();
    } catch {
      // Already handled by resolveSearchCatalog; nothing to do.
    }
  };

  return {
    mode: () => mode,
    catalog: () => catalogValue,
    onActivateSearchProvider: () => {
      mode = "sub-search";
      catalogValue = undefined;
      cachedTopLevel = undefined;
      cachedSubmenu = undefined;
      cachedBaseUrlSubmenu = undefined;
      // Caller must call fetchCatalogAsync separately (to pass ctx); see command wiring in Task 9.
    },
    onActivateFetchProvider: () => {
      mode = "sub-fetch";
      cachedTopLevel = undefined;
      cachedFetchSubmenu = undefined;
      cachedBaseUrlSubmenu = undefined;
    },
    onActivateBaseUrl: () => {
      mode = "sub-base-url";
      cachedTopLevel = undefined;
      cachedBaseUrlSubmenu = undefined;
    },
    onCommit: (provider) => {
      pendingFetch?.abort();
      cachedTopLevel = undefined;
      if (mode === "sub-fetch") {
        cachedFetchSubmenu = undefined;
        cachedBaseUrlSubmenu = undefined;
        currentFetchProvider = provider;
        deps.onCommitFetchPersist(provider);
      } else if (mode === "sub-base-url") {
        cachedSubmenu = undefined;
        cachedFetchSubmenu = undefined;
        cachedBaseUrlSubmenu = undefined;
        const result = sanitizeBaseUrlForPersist(provider ?? "");
        if (!result.ok) {
          console.warn(`[omniroute] invalid base URL, keeping current value`);
          mode = "top";
          catalogValue = undefined;
          return;
        }
        currentBaseUrl = result.value ?? "";
        deps.onCommitBaseUrlPersist(result.value);
      } else {
        cachedSubmenu = undefined;
        cachedBaseUrlSubmenu = undefined;
        currentProvider = provider;
        deps.onCommitPersist(provider);
      }
      mode = "top";
      catalogValue = undefined;
    },
    onCancel: () => {
      cachedTopLevel = undefined;
      cachedSubmenu = undefined;
      cachedFetchSubmenu = undefined;
      cachedBaseUrlSubmenu = undefined;
      pendingFetch?.abort();
      mode = "top";
      catalogValue = undefined;
    },
    onEsc: () => {
      cachedTopLevel = undefined;
      cachedSubmenu = undefined;
      cachedFetchSubmenu = undefined;
      cachedBaseUrlSubmenu = undefined;
      pendingFetch?.abort();
      mode = "top";
      catalogValue = undefined;
      deps.onClose();
    },
    getComponent: (tui: TUI, theme: Theme) => {
      if (mode === "top") {
        if (cachedTopLevel) return cachedTopLevel;
        cachedTopLevel = renderTopLevelMenu({
          currentProvider,
          fetchPreview: previewForProvider(currentFetchProvider),
          baseUrlPreview: currentBaseUrl,
          theme,
          onActivateSearchProvider: () => {
            mode = "sub-search";
            cachedTopLevel = undefined;
            cachedSubmenu = undefined;
            cachedBaseUrlSubmenu = undefined;
            tui.requestRender();
            void fetchCatalogAsync(tui);
          },
          onActivateFetchProvider: () => {
            mode = "sub-fetch";
            cachedTopLevel = undefined;
            cachedFetchSubmenu = undefined;
            cachedBaseUrlSubmenu = undefined;
            tui.requestRender();
          },
          onActivateBaseUrl: () => {
            mode = "sub-base-url";
            cachedTopLevel = undefined;
            cachedBaseUrlSubmenu = undefined;
            tui.requestRender();
          },
          onClose: () => {
            cachedTopLevel = undefined;
            cachedSubmenu = undefined;
            cachedFetchSubmenu = undefined;
            cachedBaseUrlSubmenu = undefined;
            pendingFetch?.abort();
            mode = "top";
            deps.onClose();
          },
          requestRender: () => tui.requestRender(),
        });
        return cachedTopLevel;
      }
      if (mode === "sub-search") {
        // …existing loading/catalog/cachedSubmenu logic unchanged…
        if (!catalogValue) {
          // Official Loader (frames disabled — pure text, no timer in tests);
          // Esc-back handling stays here since the Loader has no handleInput.
          const loader = new Loader(
            tui,
            (s: string) => theme.fg("accent", s),
            (s: string) => theme.fg("dim", s),
            "Loading search providers…",
            { frames: [] },
          );
          const container = new Container();
          container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
          container.addChild(loader as unknown as Component);
          container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
          (container as unknown as { handleInput: (data: string) => void }).handleInput = (data: string): void => {
            if (data === "\x1b") {
              cachedTopLevel = undefined;
              cachedSubmenu = undefined;
              cachedBaseUrlSubmenu = undefined;
              pendingFetch?.abort();
              mode = "top";
              tui.requestRender();
            }
          };
          return container as unknown as Component;
        }
        if (cachedSubmenu) return cachedSubmenu;
        cachedSubmenu = renderProviderSubmenu({
          currentProvider,
          catalog: catalogValue,
          theme,
          requestRender: () => tui.requestRender(),
          onCommit: (p) => {
            cachedTopLevel = undefined;
            cachedSubmenu = undefined;
            cachedBaseUrlSubmenu = undefined;
            pendingFetch?.abort();
            currentProvider = p;
            deps.onCommitPersist(p);
            mode = "top";
            catalogValue = undefined;
            tui.requestRender();
          },
          onCancel: () => {
            cachedTopLevel = undefined;
            cachedSubmenu = undefined;
            cachedBaseUrlSubmenu = undefined;
            pendingFetch?.abort();
            mode = "top";
            catalogValue = undefined;
            tui.requestRender();
          },
        });
        return cachedSubmenu;
      }
      if (mode === "sub-fetch") {
        if (cachedFetchSubmenu) return cachedFetchSubmenu;
        cachedFetchSubmenu = renderFetchSubmenu({
          currentFetchProvider,
          theme,
          requestRender: () => tui.requestRender(),
          onCommit: (p) => {
            cachedTopLevel = undefined;
            cachedFetchSubmenu = undefined;
            cachedBaseUrlSubmenu = undefined;
            currentFetchProvider = p;
            deps.onCommitFetchPersist(p);
            mode = "top";
            tui.requestRender();
          },
          onCancel: () => {
            cachedTopLevel = undefined;
            cachedFetchSubmenu = undefined;
            cachedBaseUrlSubmenu = undefined;
            mode = "top";
            tui.requestRender();
          },
        });
        return cachedFetchSubmenu;
      }
      // mode === "sub-base-url"
      if (cachedBaseUrlSubmenu) return cachedBaseUrlSubmenu;
      cachedBaseUrlSubmenu = renderBaseUrlSubmenu({
        currentBaseUrl,
        theme,
        requestRender: () => tui.requestRender(),
        onCommit: (v) => {
          const result = sanitizeBaseUrlForPersist(v);
          if (!result.ok) {
            console.warn(`[omniroute] invalid base URL, keeping current value`);
            mode = "top";
            tui.requestRender();
            return;
          }
          cachedTopLevel = undefined;
          cachedBaseUrlSubmenu = undefined;
          currentBaseUrl = result.value ?? "";
          deps.onCommitBaseUrlPersist(result.value);
          mode = "top";
          tui.requestRender();
        },
        onCancel: () => {
          cachedTopLevel = undefined;
          cachedBaseUrlSubmenu = undefined;
          mode = "top";
          tui.requestRender();
        },
      });
      return cachedBaseUrlSubmenu;
    },
  } as MenuStateMachine;
}

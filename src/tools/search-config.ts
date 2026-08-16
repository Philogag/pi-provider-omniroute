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
import { resolveStoredBaseUrl, stripStoredBaseUrlEnv } from "../auth-credentials.ts";

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
  readonly baseUrlPreview: string;                   // current Base URL (truncated for display)
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

/** Truncate a long Base URL preview to `max` chars (with a trailing "…"). */
export function truncatePreview(s: string, max = 48): string {
  return s.length <= max ? s : s.slice(0, max) + "…";
}

export interface BaseUrlEditorParams {
  readonly current: string;
  readonly theme: Theme;
  readonly onCommit: (value: string | undefined) => void;
  readonly onCancel: () => void;
  readonly requestRender?: () => void;
  readonly resolveBaseUrlInput?: (raw: string) => BaseUrlInputResult;
}

/**
 * Single-line Base URL editor used by the state machine's "sub-base-url" mode.
 * Renders a Container with title, an Input prefilled with the current value,
 * an error line (set on invalid submit) and a key hint. Input routing is done
 * manually (a bare Container does not forward input). The Input instance is
 * exposed as `_input` for unit tests.
 */
export function renderBaseUrlEditor(params: BaseUrlEditorParams): Component {
  const { current, theme, onCommit, onCancel, requestRender } = params;
  const resolve = params.resolveBaseUrlInput ?? parseBaseUrlInput;
  const input = new Input();
  input.setValue(current);
  input.focused = true;
  // Error line: created once and mutated via setText so it appears on re-render
  // (children are fixed at construction time; a late addChild would not render).
  const errorText = new Text("", 1, 0);

  input.onSubmit = (value: string): void => {
    const r = resolve(value);
    if (r.ok) {
      onCommit(r.value);
    } else {
      errorText.setText(theme.fg("warning", r.error));
      requestRender?.();
    }
  };
  input.onEscape = (): void => {
    onCancel();
  };

  const container = new Container();
  container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
  container.addChild(new Text(theme.fg("accent", theme.bold("Base URL")), 1, 0));
  container.addChild(input as unknown as Component);
  container.addChild(errorText as unknown as Component);
  container.addChild(new Text(theme.fg("dim", keyHint("tui.input.submit", "save") + " · " + keyHint("tui.select.cancel", "back")), 1, 0));
  container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

  // A bare Container does not forward input; route keypresses to the Input.
  (container as unknown as { handleInput: (data: string) => void }).handleInput = (data: string): void => {
    input.handleInput(data);
    requestRender?.();
  };

  // Expose the Input for unit tests.
  (container as unknown as { _input: Input })._input = input;

  return container as unknown as Component;
}

// --- Top-level menu ---

export function renderTopLevelMenu(params: TopLevelMenuParams): Component {
  const { currentProvider, fetchPreview, theme } = params;
  const preview = previewForProvider(currentProvider);
  const items: SelectItem[] = [
    { value: "search", label: `Search provider: ${preview}` },
    { value: "fetch", label: `Web Fetch provider: ${fetchPreview}` },
    { value: "base-url", label: `Base URL: ${truncatePreview(params.baseUrlPreview)}` },
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

// --- settings.json persistence (pi-provider-omniroute block) ---

export function resolveAgentSettingsPath(): string {
  const fromEnv = process.env.PI_AGENT_DIR;
  const base = fromEnv || join(homedir(), ".pi", "agent");
  return join(base, "settings.json");
}

export interface OmnirouteConfigShape {
  readonly baseUrl?: string;
  readonly search?: { readonly provider?: string };
  readonly fetch?: { readonly provider?: string };
}

export function readOmnirouteConfig(): OmnirouteConfigShape {
  const path = resolveAgentSettingsPath();
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
  const rawBlock = root["pi-provider-omniroute"];
  if (rawBlock === undefined) return {};
  if (!rawBlock || typeof rawBlock !== "object" || Array.isArray(rawBlock)) {
    console.warn(`[omniroute] ${path} \`pi-provider-omniroute\` is not a plain object; treating as empty config`);
    return {};
  }
  const block = rawBlock as Record<string, unknown>;
  const result: { baseUrl?: string; search?: { provider: string }; fetch?: { provider: string } } = {};
  const rawBaseUrl = block["baseUrl"];
  if (rawBaseUrl !== undefined) {
    if (typeof rawBaseUrl === "string") {
      result.baseUrl = rawBaseUrl;
    } else {
      console.warn(`[omniroute] ${path} \`baseUrl\` is not a string; treating as unset`);
    }
  }
  for (const key of ["search", "fetch"] as const) {
    const branch = block[key];
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

export function resolveOmnirouteBaseUrl(): string {
  return (
    readOmnirouteConfig().baseUrl ??
    process.env.OMNIROUTE_BASE_URL ??
    OMNIROUTE_DEFAULT_BASE_URL
  );
}

export function writeOmnirouteConfig(provider: string | undefined, key: "search" | "fetch" = "search"): void {
  const path = resolveAgentSettingsPath();
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

  const raw = root["pi-provider-omniroute"];
  const block = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  if (provider === undefined) {
    if (raw === undefined) return; // nothing to delete; skip the no-op rewrite
    delete block[key];
  } else {
    if (!block[key] || typeof block[key] !== "object" || Array.isArray(block[key])) {
      block[key] = {};
    }
    (block[key] as Record<string, unknown>)["provider"] = provider;
  }
  // Only write the block back when we are setting a value or the key already
  // existed: deleting on a file without the block must not materialize an
  // empty `"pi-provider-omniroute": {}`.
  if (provider !== undefined || raw !== undefined) {
    root["pi-provider-omniroute"] = block;
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

export type BaseUrlInputResult =
  | { ok: true; value: string | undefined }
  | { ok: false; error: string };

export function parseBaseUrlInput(raw: string): BaseUrlInputResult {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: true, value: undefined };
  try {
    return { ok: true, value: validateAndNormalizeBaseUrl(trimmed) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function writeOmnirouteBaseUrl(url: string | undefined): void {
  const path = resolveAgentSettingsPath();
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
  const raw = root["pi-provider-omniroute"];
  const block = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  if (url === undefined) {
    if (raw === undefined) return; // reset with no block: nothing to do
    delete block.baseUrl;
  } else {
    block.baseUrl = url;
  }
  // Only write the block back when we are setting a value or the key already
  // existed: deleting on a file without the block must not materialize an
  // empty `"pi-provider-omniroute": {}`.
  if (url !== undefined || raw !== undefined) {
    root["pi-provider-omniroute"] = block;
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

// --- Legacy migration ---

// Reads the `provider` string out of a legacy search/fetch entry (old
// omniroute.json shape), or undefined when the entry is not an object with a
// string provider.
function legacyProviderId(v: unknown): string | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const p = (v as Record<string, unknown>)["provider"];
  return typeof p === "string" ? p : undefined;
}

// One-time migration of legacy baseUrl sources into the settings.json
// `pi-provider-omniroute` block. Returns the migrated baseUrl, or undefined
// when no migration happened (idempotent: once the block has a baseUrl — or
// the env wins — there is nothing to migrate).
export function migrateLegacyConfig(): string | undefined {
  if (readOmnirouteConfig().baseUrl !== undefined) return undefined;
  if (process.env.OMNIROUTE_BASE_URL) return undefined;

  // Source ①: old $PI_AGENT_DIR/omniroute.json (same directory as
  // settings.json). Its baseUrl/search/fetch merge into the block, only
  // filling fields the block is missing.
  const oldPath = join(dirname(resolveAgentSettingsPath()), "omniroute.json");
  let oldCfg: Record<string, unknown> | undefined;
  try {
    const parsed = JSON.parse(readFileSync(oldPath, "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      oldCfg = parsed as Record<string, unknown>;
    }
  } catch {
    // Missing or malformed → source ① skipped.
  }

  const cur = readOmnirouteConfig();
  const next: { baseUrl?: string; search?: string; fetch?: string } = {};
  if (cur.baseUrl === undefined) {
    const oldBase = oldCfg?.baseUrl;
    if (typeof oldBase === "string") next.baseUrl = oldBase;
  }
  const oldSearchProvider = legacyProviderId(oldCfg?.search);
  if (cur.search === undefined && oldSearchProvider !== undefined) next.search = oldSearchProvider;
  const oldFetchProvider = legacyProviderId(oldCfg?.fetch);
  if (cur.fetch === undefined && oldFetchProvider !== undefined) next.fetch = oldFetchProvider;

  let migrated = next.baseUrl;
  let fromLegacyAuth = false;
  if (migrated === undefined) {
    // Source ②: legacy auth.json credential env (baseUrl only), used only
    // when source ① provided no baseUrl.
    const legacy = resolveStoredBaseUrl();
    if (typeof legacy === "string") {
      next.baseUrl = legacy;
      migrated = legacy;
      fromLegacyAuth = true;
    }
  }
  if (migrated === undefined) return undefined;

  // Persist into the block. The writers compose: each re-reads settings.json
  // and preserves unknown root keys + already-written block fields.
  writeOmnirouteBaseUrl(migrated);
  if (next.search !== undefined) writeOmnirouteConfig(next.search, "search");
  if (next.fetch !== undefined) writeOmnirouteConfig(next.fetch, "fetch");

  const written = readOmnirouteConfig();
  const landed =
    written.baseUrl === migrated &&
    (next.search === undefined || written.search?.provider === next.search) &&
    (next.fetch === undefined || written.fetch?.provider === next.fetch);

  // Delete the old file only after the block write actually landed; a failed
  // write (e.g. read-only dir) keeps the file so the next startup can retry.
  if (oldCfg !== undefined && landed) {
    try {
      unlinkSync(oldPath);
    } catch (err) {
      console.warn(`[omniroute] failed to remove legacy ${oldPath}: ${(err as Error).message}`);
    }
  }
  // After a successful source-② migration, drop the legacy env key so an
  // explicit reset (spec B4) can never be resurrected by the next session_start
  // and the legacy value stops participating in any resolution (spec B1).
  // A failed strip keeps the env for a retry next startup.
  if (fromLegacyAuth && landed) {
    stripStoredBaseUrlEnv();
  }
  return migrated;
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

// --- Menu state machine ---

export interface MenuStateMachineDeps {
  // These are bound (ctx-free) so the caller can inject the real command ctx
  // as a factory-time closure (see the /omniroute-settings handler). This avoids
  // threading an unset ctxRef through the machine's internal fetch path.
  readonly resolveApiKey: () => Promise<string | undefined>;
  readonly resolveBaseUrl: () => string;
  readonly initialCurrentProvider: string | undefined;
  readonly initialFetchProvider: string | undefined;
  readonly onCommitPersist: (provider: string | undefined) => void;
  readonly onCommitFetchPersist: (provider: string | undefined) => void;
  readonly onCommitBaseUrl: (value: string | undefined) => void;
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
  let catalogValue: SearchCatalog | undefined = undefined;
  let pendingFetch: AbortController | undefined;
  // Memoized submenu component (design §9.3): the SelectList inside
  // renderProviderSubmenu keeps its cursor (selectedIndex) in instance state,
  // so we must return the SAME instance across renders/inputs while in sub
  // mode, or the cursor resets to row 0 on every frame and the submenu becomes
  // keyboard-unusable. Invalidated on every top<->sub transition and reset.
  let cachedSubmenu: Component | undefined = undefined;
  let cachedFetchSubmenu: Component | undefined = undefined;
  // Memoized top-level component (same rationale as the submenu caches): the
  // SelectList inside renderTopLevelMenu keeps its cursor (selectedIndex) in
  // instance state, so we must return the SAME instance across renders/inputs
  // while in top mode, or the cursor resets to row 0 on every frame and the
  // two-row menu becomes keyboard-unusable (the "Web Fetch provider" row would
  // be unreachable). Invalidated on every mode transition / close.
  let cachedTopLevel: Component | undefined = undefined;
  // Memoized Base URL editor (same rationale): the Input keeps its value in
  // instance state, so the same instance must survive re-renders while in
  // sub-base-url mode, or typed text resets on every frame. Invalidated on
  // every commit/cancel/mode transition.
  let cachedBaseUrlEditor: Component | undefined = undefined;

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
      // Caller must call fetchCatalogAsync separately (to pass ctx); see command wiring in Task 9.
    },
    onActivateFetchProvider: () => {
      mode = "sub-fetch";
      cachedTopLevel = undefined;
      cachedFetchSubmenu = undefined;
    },
    onActivateBaseUrl: () => {
      mode = "sub-base-url";
      cachedTopLevel = undefined;
      cachedBaseUrlEditor = undefined;
    },
    onCommit: (provider) => {
      pendingFetch?.abort();
      cachedTopLevel = undefined;
      cachedBaseUrlEditor = undefined;
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
      cachedTopLevel = undefined;
      cachedSubmenu = undefined;
      cachedFetchSubmenu = undefined;
      cachedBaseUrlEditor = undefined;
      pendingFetch?.abort();
      mode = "top";
      catalogValue = undefined;
    },
    onEsc: () => {
      cachedTopLevel = undefined;
      cachedSubmenu = undefined;
      cachedFetchSubmenu = undefined;
      cachedBaseUrlEditor = undefined;
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
          baseUrlPreview: deps.resolveBaseUrl(),
          theme,
          onActivateSearchProvider: () => {
            mode = "sub-search";
            cachedTopLevel = undefined;
            cachedSubmenu = undefined;
            tui.requestRender();
            void fetchCatalogAsync(tui);
          },
          onActivateFetchProvider: () => {
            mode = "sub-fetch";
            cachedTopLevel = undefined;
            cachedFetchSubmenu = undefined;
            tui.requestRender();
          },
          onActivateBaseUrl: () => {
            mode = "sub-base-url";
            cachedTopLevel = undefined;
            cachedBaseUrlEditor = undefined;
            tui.requestRender();
          },
          onClose: () => {
            cachedTopLevel = undefined;
            cachedSubmenu = undefined;
            cachedFetchSubmenu = undefined;
            cachedBaseUrlEditor = undefined;
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
            pendingFetch?.abort();
            mode = "top";
            catalogValue = undefined;
            tui.requestRender();
          },
        });
        return cachedSubmenu;
      }
      // mode === "sub-base-url"
      if (mode === "sub-base-url") {
        if (cachedBaseUrlEditor) return cachedBaseUrlEditor;
        cachedBaseUrlEditor = renderBaseUrlEditor({
          current: deps.resolveBaseUrl(),
          theme,
          requestRender: () => tui.requestRender(),
          onCommit: (value) => {
            cachedTopLevel = undefined;
            cachedBaseUrlEditor = undefined;
            deps.onCommitBaseUrl(value);
            mode = "top";
            tui.requestRender();
          },
          onCancel: () => {
            cachedTopLevel = undefined;
            cachedBaseUrlEditor = undefined;
            mode = "top";
            tui.requestRender();
          },
        });
        return cachedBaseUrlEditor;
      }
      // mode === "sub-fetch"
      if (cachedFetchSubmenu) return cachedFetchSubmenu;
      cachedFetchSubmenu = renderFetchSubmenu({
        currentFetchProvider,
        theme,
        requestRender: () => tui.requestRender(),
        onCommit: (p) => {
          cachedTopLevel = undefined;
          cachedFetchSubmenu = undefined;
          currentFetchProvider = p;
          deps.onCommitFetchPersist(p);
          mode = "top";
          tui.requestRender();
        },
        onCancel: () => {
          cachedTopLevel = undefined;
          cachedFetchSubmenu = undefined;
          mode = "top";
          tui.requestRender();
        },
      });
      return cachedFetchSubmenu;
    },
  } as MenuStateMachine;
}

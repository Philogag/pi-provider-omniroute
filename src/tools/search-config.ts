// src/tools/search-config.ts
// Catalog fetch + persistence + TUI renderers for the search provider config.

import { Container, SettingsList, type Component } from "@earendil-works/pi-tui";
import { getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import { readFileSync, writeFileSync, renameSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

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
    // Invariant: currentValue must be a member of values, else SettingsList.activateItem
    // (indexOf => -1) coerces the row to values[0] on the first Enter. When a concrete
    // provider is active (static or catalog-only), keep it in the auto row's values so
    // the row shows its actual current selection instead of snapping to AUTO_ID.
    values: isCurrentAuto ? [AUTO_ID] : [currentProvider as string, AUTO_ID],
  };
  const providerItems: ProviderItem[] = catalog.providers.map((p) => ({
    id: p.id,
    label: p.name || p.id,
    currentValue: p.id === currentProvider ? p.id : AUTO_ID,
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

  // A bare Container does not forward input; route keypresses (e.g. Esc) to the
  // SettingsList so its onCancel fires when rendered inside a TUI/Overlay.
  (container as unknown as { handleInput: (data: string) => void }).handleInput = (data: string): void => {
    for (const child of container.children) child.handleInput?.(data);
  };

  // Expose the SettingsList's onChange for unit tests (see test/search-config-submenu.test.ts).
  (container as unknown as { _sl: { onChange: typeof onValueChange } })._sl = { onChange: onValueChange };

  return container as unknown as Component;
}

// --- omniroute.json persistence ---

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
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    console.warn(`[omniroute] ${path} root is not a plain object; treating as empty config`);
    return {};
  }
  const root = parsed as Record<string, unknown>;
  const search = root["search"];
  if (!search || typeof search !== "object" || Array.isArray(search)) {
    console.warn(`[omniroute] ${path} \`search\` field is not a plain object; treating as empty config`);
    return {};
  }
  const provider = (search as Record<string, unknown>)["provider"];
  if (typeof provider !== "string") {
    console.warn(`[omniroute] ${path} \`search.provider\` is not a string; treating as empty config`);
    return {};
  }
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

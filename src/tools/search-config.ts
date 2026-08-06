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

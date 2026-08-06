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

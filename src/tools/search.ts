// src/tools/search.ts
import { Type, type Static } from "@sinclair/typebox";

export const SEARCH_PROVIDERS = [
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
export const SEARCH_TYPES = ["web", "news"] as const;
export const TIME_RANGES = ["any", "hour", "day", "week", "month", "year"] as const;

function stringEnum<T extends readonly string[]>(values: T) {
  return Type.Union(values.map((v) => Type.Literal(v)));
}

export const searchParamsSchema = Type.Object(
  {
    query: Type.String({ minLength: 1, maxLength: 500 }),
    provider: Type.Optional(stringEnum(SEARCH_PROVIDERS)),
    max_results: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
    search_type: Type.Optional(stringEnum(SEARCH_TYPES)),
    offset: Type.Optional(Type.Integer({ minimum: 0 })),
    country: Type.Optional(Type.String({ maxLength: 2 })),
    language: Type.Optional(Type.String({ minLength: 2, maxLength: 5 })),
    time_range: Type.Optional(stringEnum(TIME_RANGES)),
    content: Type.Optional(
      Type.Object(
        {
          snippet: Type.Optional(Type.Boolean()),
          full_page: Type.Optional(Type.Boolean()),
          format: Type.Optional(stringEnum(["text", "markdown"])),
          max_characters: Type.Optional(Type.Integer({ minimum: 100, maximum: 100000 })),
        },
        { additionalProperties: false },
      ),
    ),
    filters: Type.Optional(
      Type.Object(
        {
          include_domains: Type.Optional(Type.Array(Type.String({ maxLength: 253 }), { maxItems: 20 })),
          exclude_domains: Type.Optional(Type.Array(Type.String({ maxLength: 253 }), { maxItems: 20 })),
          safe_search: Type.Optional(stringEnum(["off", "moderate", "strict"])),
        },
        { additionalProperties: false },
      ),
    ),
    synthesis: Type.Optional(
      Type.Object(
        {
          strategy: Type.Optional(stringEnum(["none", "auto", "provider", "internal"])),
          model: Type.Optional(Type.String()),
          max_tokens: Type.Optional(Type.Integer({ minimum: 1, maximum: 4000 })),
        },
        { additionalProperties: false },
      ),
    ),
    provider_options: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    strict_filters: Type.Optional(Type.Boolean()),
    timeoutMs: Type.Optional(Type.Integer({ minimum: 1000, maximum: 120000 })),
  },
  { additionalProperties: false },
);
export type SearchToolParams = Static<typeof searchParamsSchema>;

export function buildSearchBody(params: SearchToolParams): Record<string, unknown> {
  const body: Record<string, unknown> = {
    query: params.query,
    max_results: params.max_results ?? 5,
    search_type: params.search_type ?? "web",
    offset: params.offset ?? 0,
    strict_filters: params.strict_filters ?? false,
  };
  const passthrough = [
    "provider",
    "country",
    "language",
    "time_range",
    "content",
    "filters",
    "synthesis",
    "provider_options",
  ] as const;
  for (const key of passthrough) {
    const value = params[key];
    if (value !== undefined) body[key] = value;
  }
  return body;
}

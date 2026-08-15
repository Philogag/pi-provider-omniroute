// src/tools/search.ts
import { Type, type Static, type TLiteral, type TUnion } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import type { ExtensionContext, AgentToolResult } from "@earendil-works/pi-coding-agent";
import { omnirouteRequest, resolveApiKey, resolveBaseUrl } from "./http.ts";

import { STATIC_FALLBACK_PROVIDERS } from "./search-config.ts";

// --- Search provider config reader (injected by src/index.ts) ---
let getConfigProvider: () => string | undefined = () => undefined;

export function setSearchConfigReader(fn: () => string | undefined): void {
  getConfigProvider = fn;
}

function isValidProvider(p: string | undefined): p is string {
  // Per spec G4: unknown / non-static providers are dropped defensively to
  // avoid 4xx propagation to OmniRoute. Do NOT loosen this gate without
  // updating the spec (G4 mandates omission for non-canonical provider ids).
  return typeof p === "string" && (STATIC_FALLBACK_PROVIDERS as readonly string[]).includes(p) && p !== "auto";
}

export const SEARCH_PROVIDERS = STATIC_FALLBACK_PROVIDERS;
export const SEARCH_TYPES = ["web", "news"] as const;
export const TIME_RANGES = ["any", "hour", "day", "week", "month", "year"] as const;

function stringEnum<T extends readonly string[]>(values: T): TUnion<[TLiteral<T[number]>]> {
  return Type.Union(values.map((v) => Type.Literal(v))) as TUnion<[TLiteral<T[number]>]>;
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

const SEARCH_RESULT_LIMIT = 20_000;

export function formatSearchResults(json: unknown, query: string): string {
  if (json && typeof json === "object" && Array.isArray((json as { results?: unknown }).results)) {
    const results = (json as { results: Array<Record<string, unknown>> }).results;
    const blocks: string[] = [];
    let total = 0;
    for (let i = 0; i < results.length; i++) {
      const r = results[i] ?? {};
      const lines = [`${i + 1}. ${typeof r.title === "string" && r.title ? r.title : "(untitled)"}`];
      if (typeof r.url === "string" && r.url) lines.push(`   URL: ${r.url}`);
      if (typeof r.snippet === "string" && r.snippet) lines.push(`   ${r.snippet}`);
      const block = lines.join("\n");
      if (total + block.length + 1 > SEARCH_RESULT_LIMIT && blocks.length > 0) {
        blocks.push(`[truncated: ${results.length - blocks.length} of ${results.length} results omitted]`);
        break;
      }
      blocks.push(block);
      total += block.length + 1;
    }
    if (blocks.length > 0) return blocks.join("\n\n");
    return `No results for query: ${query}`;
  }
  return JSON.stringify(json).slice(0, SEARCH_RESULT_LIMIT);
}

export const searchTool = defineTool({
  name: "omniroute_web_search",
  label: "OmniRoute Web Search",
  description:
    "Search the web or news via OmniRoute's configured search providers (Tavily, Brave, Exa, Serper, etc.). Returns ranked results with titles and URLs. Use for current events, fact lookup, and finding sources.",
  parameters: searchParamsSchema,
  prepareArguments(args: unknown): { query: string } {
    const a = args as { query?: unknown };
    if (typeof a.query === "string") {
      return { ...(args as Record<string, unknown>), query: a.query.trim() } as { query: string };
    }
    return args as { query: string };
  },
  async execute(
    _toolCallId: string,
    params: SearchToolParams,
    signal: AbortSignal | undefined,
    _onUpdate: unknown,
    ctx: ExtensionContext,
  ): Promise<AgentToolResult<unknown>> {
    const query = params.query.trim();
    if (query.length === 0) {
      return { content: [{ type: "text", text: "query must be a non-empty string" }], details: undefined };
    }
    const configProvider = getConfigProvider();
    const effectiveProvider =
      params.provider !== undefined
        ? params.provider
        : isValidProvider(configProvider)
        ? configProvider
        : undefined;
    const apiKey = await resolveApiKey(ctx);
    if (!apiKey) {
      return {
        content: [
          {
            type: "text",
            text: "OmniRoute API key is not configured. Run /login omniroute or set OMNIROUTE_API_KEY.",
          },
        ],
        details: undefined,
      };
    }
    const baseUrl = resolveBaseUrl(ctx);
    const timeoutMs = params.timeoutMs ?? 30_000;
    const res = await omnirouteRequest("/search", buildSearchBody({ ...params, query, provider: effectiveProvider }), {
      apiKey,
      baseUrl,
      signal,
      timeoutMs,
    });
    if (!res.ok) {
      return {
        content: [{ type: "text", text: res.cancelled ? "Search cancelled." : res.message }],
        details: undefined,
      };
    }
    return { content: [{ type: "text", text: formatSearchResults(res.json, query) }], details: undefined };
  },
});

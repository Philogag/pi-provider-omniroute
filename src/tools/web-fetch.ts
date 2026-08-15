// src/tools/web-fetch.ts
import { Type, type Static, type TLiteral, type TUnion } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import type { ExtensionContext, AgentToolResult } from "@earendil-works/pi-coding-agent";
import { omnirouteRequest, resolveApiKey, resolveBaseUrl } from "./http.ts";

export const FETCH_PROVIDERS = ["firecrawl", "jina-reader", "tavily-search", "tinyfish"] as const;
export const FETCH_FORMATS = ["markdown", "html", "links", "screenshot"] as const;

export function normalizeFetchProvider(raw: string | undefined): FetchToolParams["provider"] {
  if (raw === undefined) return undefined;
  return (FETCH_PROVIDERS as readonly string[]).includes(raw) ? (raw as FetchToolParams["provider"]) : undefined;
}

// --- Fetch provider config reader (injected by src/index.ts; same pattern as search.ts) ---
let getFetchConfigProvider: () => string | undefined = () => undefined;

export function setFetchConfigReader(fn: () => string | undefined): void {
  getFetchConfigProvider = fn;
}

function stringEnum<T extends readonly string[]>(values: T): TUnion<[TLiteral<T[number]>]> {
  return Type.Union(values.map((v) => Type.Literal(v))) as TUnion<[TLiteral<T[number]>]>;
}

export const fetchParamsSchema = Type.Object(
  {
    url: Type.String(),
    provider: Type.Optional(stringEnum(FETCH_PROVIDERS)),
    format: Type.Optional(stringEnum(FETCH_FORMATS)),
    depth: Type.Optional(Type.Union([Type.Literal(0), Type.Literal(1), Type.Literal(2)])),
    wait_for_selector: Type.Optional(Type.String({ maxLength: 256 })),
    include_metadata: Type.Optional(Type.Boolean()),
    timeoutMs: Type.Optional(Type.Integer({ minimum: 1000, maximum: 120000 })),
  },
  { additionalProperties: false },
);
export type FetchToolParams = Static<typeof fetchParamsSchema>;

export function buildFetchBody(params: FetchToolParams): Record<string, unknown> {
  const body: Record<string, unknown> = {
    url: params.url,
    format: params.format ?? "markdown",
    depth: params.depth ?? 0,
    include_metadata: params.include_metadata ?? false,
  };
  if (params.provider !== undefined) body.provider = params.provider;
  if (params.wait_for_selector !== undefined) body.wait_for_selector = params.wait_for_selector;
  return body;
}

const FETCH_CONTENT_LIMIT = 40_000;

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

export function extractFetchContent(json: unknown): string {
  if (json && typeof json === "object") {
    const obj = json as Record<string, unknown>;
    const content = obj.content;
    if (typeof content === "string") return truncate(content);
    if (content && typeof content === "object") {
      const inner = content as Record<string, unknown>;
      const innerText = asString(inner.markdown) ?? asString(inner.text);
      if (innerText !== undefined) return truncate(innerText);
    }
    for (const key of ["markdown", "html", "text"] as const) {
      const value = asString(obj[key]);
      if (value !== undefined) return truncate(value);
    }
  }
  return JSON.stringify(json).slice(0, FETCH_CONTENT_LIMIT);
}

function truncate(text: string): string {
  if (text.length <= FETCH_CONTENT_LIMIT) return text;
  return `${text.slice(0, FETCH_CONTENT_LIMIT)}\n\n[content truncated at ${FETCH_CONTENT_LIMIT} chars]`;
}

export const webFetchTool = defineTool({
  name: "omniroute_web_fetch",
  label: "OmniRoute Web Fetch",
  description:
    "Fetch and extract content from a URL via OmniRoute's configured web-fetch providers (Firecrawl, Jina Reader, Tavily Extract, TinyFish). Returns the page content as markdown by default.",
  parameters: fetchParamsSchema,
  async execute(
    _toolCallId: string,
    params: FetchToolParams,
    signal: AbortSignal | undefined,
    _onUpdate: unknown,
    ctx: ExtensionContext,
  ): Promise<AgentToolResult<unknown>> {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(params.url);
    } catch {
      return { content: [{ type: "text", text: "url must be a valid http(s) URL" }], details: undefined };
    }
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      return { content: [{ type: "text", text: "url must be an http(s) URL" }], details: undefined };
    }
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
    // Three-state merge (explicit param > configured reader > omitted), mirroring
    // search.ts. The reader is injected by src/index.ts (currentFetchProvider,
    // set via setFetchConfigReader). normalizeFetchProvider re-gates the config
    // value at call time (undefined/"auto"/invalid -> omitted).
    const effectiveProvider =
      params.provider ?? normalizeFetchProvider(getFetchConfigProvider());
    const res = await omnirouteRequest("/web/fetch", buildFetchBody({ ...params, provider: effectiveProvider }), {
      apiKey,
      baseUrl,
      signal,
      timeoutMs,
    });
    if (!res.ok) {
      return { content: [{ type: "text", text: res.cancelled ? "Fetch cancelled." : res.message }], details: undefined };
    }
    return { content: [{ type: "text", text: extractFetchContent(res.json) }], details: undefined };
  },
});

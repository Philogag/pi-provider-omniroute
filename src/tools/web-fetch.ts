// src/tools/web-fetch.ts
import { Type, type Static } from "@sinclair/typebox";

export const FETCH_PROVIDERS = ["firecrawl", "jina-reader", "tavily-search", "tinyfish"] as const;
export const FETCH_FORMATS = ["markdown", "html", "links", "screenshot"] as const;

function stringEnum<T extends readonly string[]>(values: T) {
  return Type.Union(values.map((v) => Type.Literal(v)));
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

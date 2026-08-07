// src/tools/usage-telemetry.ts
// Captures OmniRoute's `X-OmniRoute-*` cost telemetry from streaming chat
// completion responses. OmniRoute appends these as SSE comment lines
// (`: x-omniroute-...`) at the END of the stream body, right before
// `data: [DONE]`. The openai SDK's SSE parser ignores comment lines, so pi-ai
// never sees them — we intercept the byte stream and parse them ourselves.

export interface OmnirouteTelemetry {
  responseCost?: number;
  tokensIn?: number;
  tokensOut?: number;
  model?: string;
  provider?: string;
  cacheHit?: boolean;
  latencyMs?: number;
}

const TELEMETRY_LINE_RE = /^: x-omniroute-([a-z-]+)=(.*)$/;

/** Parses a single SSE comment line; returns null for anything else. */
export function parseOmnirouteTelemetryLine(
  line: string,
): Partial<OmnirouteTelemetry> | null {
  const match = TELEMETRY_LINE_RE.exec(line);
  if (!match) return null;
  const key = match[1];
  const value = match[2];
  if (value === "") return {}; // empty value — recognized telemetry key but no data
  switch (key) {
    case "response-cost": {
      const n = Number(value);
      return Number.isFinite(n) ? { responseCost: n } : {};
    }
    case "tokens-in": {
      const n = Number(value);
      return Number.isFinite(n) ? { tokensIn: n } : {};
    }
    case "tokens-out": {
      const n = Number(value);
      return Number.isFinite(n) ? { tokensOut: n } : {};
    }
    case "latency-ms": {
      const n = Number(value);
      return Number.isFinite(n) ? { latencyMs: n } : {};
    }
    case "model":
      return { model: value };
    case "provider":
      return { provider: value };
    case "cache-hit":
      return { cacheHit: value === "true" };
    default:
      return null; // unknown key — not telemetry we care about
  }
}

/** Extracts merged telemetry from a full decoded text body. */
export function extractOmnirouteTelemetry(
  text: string,
): OmnirouteTelemetry | undefined {
  let result: OmnirouteTelemetry | undefined;
  for (const line of text.split(/\r?\n/)) {
    const parsed = parseOmnirouteTelemetryLine(line);
    if (parsed) {
      result = { ...(result ?? {}), ...parsed };
    }
  }
  return result;
}

export interface TelemetryTransform {
  stream: TransformStream<Uint8Array, Uint8Array>;
  getTelemetry: () => OmnirouteTelemetry | undefined;
}

/** Byte-transparent TransformStream that also parses OmniRoute telemetry lines. */
export function createTelemetryTransformStream(): TelemetryTransform {
  let buffer = "";
  let telemetry: OmnirouteTelemetry | undefined;
  const decoder = new TextDecoder();
  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      controller.enqueue(chunk); // pass bytes through untouched
      buffer += decoder.decode(chunk, { stream: true });
      // process complete lines
      let idx: number;
      while ((idx = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        const parsed = parseOmnirouteTelemetryLine(line);
        if (parsed) telemetry = { ...(telemetry ?? {}), ...parsed };
      }
    },
    flush() {
      // writable closed → readable ends naturally; nothing to terminate.
      const parsed = parseOmnirouteTelemetryLine(buffer); // no trailing newline
      if (parsed) telemetry = { ...(telemetry ?? {}), ...parsed };
      buffer = "";
    },
  });
  return {
    stream: transform,
    getTelemetry: () => telemetry,
  };
}

/** Wraps a fetch impl: pipes response bodies through a telemetry transform. */
export function withOmnirouteFetch(
  fetchImpl: typeof fetch,
  onTelemetry?: (t: OmnirouteTelemetry) => void,
): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await fetchImpl(input, init);
    if (!res.ok || !res.body) return res;
    const { stream, getTelemetry } = createTelemetryTransformStream();
    const pipe = res.body.pipeTo(stream.writable);
    // Read the transformed stream; report telemetry once the body is fully consumed.
    const consumed = (async () => {
      await pipe;
      const t = getTelemetry();
      if (t) onTelemetry?.(t);
    })();
    // Note: errors in `pipe` are swallowed intentionally — telemetry is best-effort.
    void consumed;
    return new Response(stream.readable, res);
  };
}

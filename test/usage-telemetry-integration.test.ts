import { test, mock, after } from "node:test";
import assert from "node:assert/strict";
import extension from "../src/index.ts";

// Minimal ExtensionAPI double capturing the registered provider.
function makePi() {
  let registered: any = null;
  return {
    pi: {
      registerProvider: (p: any) => { registered = p; },
      registerTool: () => {},
      registerCommand: () => {},
      on: () => {},
    },
    getProvider: () => registered,
  };
}

const origFetch = globalThis.fetch;
after(() => { globalThis.fetch = origFetch; mock.restoreAll(); });

test("provider stream surfaces OmniRoute cost into final message", async () => {
  const { pi, getProvider } = makePi();
  await extension(pi as never);
  const provider = getProvider();
  assert.ok(provider, "provider registered");
  assert.equal(provider.id, "omniroute");

  // Proper SSE: events are separated by blank lines. The openai SDK's
  // SSEDecoder only flushes an event on an empty line, so a body joined
  // with single \n would yield zero chunks.
  const sseBody = [
    'data: {"id":"x","object":"chat.completion.chunk","created":1,"model":"deepseek-v4-flash","choices":[{"index":0,"delta":{"content":"hi"},"finish_reason":null}]}',
    'data: {"id":"x","object":"chat.completion.chunk","created":1,"model":"deepseek-v4-flash","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":88,"completion_tokens":13,"total_tokens":101}}',
    ": x-omniroute-cache-hit=false",
    ": x-omniroute-latency-ms=1161",
    ": x-omniroute-response-cost=0.0000190400",
    ": x-omniroute-tokens-in=88",
    ": x-omniroute-tokens-out=13",
    "data: [DONE]",
    "",
  ].join("\n\n");

  mock.method(globalThis, "fetch", async () =>
    new Response(new Blob([sseBody]), { status: 200, headers: { "content-type": "text/event-stream" } }),
  );

  const model = { id: "deepseek-v4-flash", api: "openai-completions", provider: "omniroute", baseUrl: "https://example.com/v1", input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } } as never;
  const context = { systemPrompt: "", messages: [] } as never;
  const stream = provider.stream(model, context, { apiKey: "k", baseUrl: "https://example.com/v1" } as never);
  const events: any[] = [];
  for await (const ev of stream) events.push(ev);
  const done = events.find((e) => e.type === "done");
  assert.ok(done, "done event");
  assert.equal(done.message.usage.cost.total, 0.00001904);
  assert.equal(done.message.usage.input, 88);
  const diag = done.message.diagnostics.find((d: any) => d.type === "omniroute-telemetry");
  assert.equal(diag.details.cacheHit, false);
  assert.equal(diag.details.tokensIn, 88);
});

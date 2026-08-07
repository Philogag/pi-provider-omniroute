---
change: add-usage-cost-telemetry
design-doc: openspec/changes/add-usage-cost-telemetry/superpower-design.md
base-ref: 08165a4369eaad7bc155de945dce03a7c8973123
---

# OmniRoute 成本遥测接入 Pi 计费统计 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 捕获 OmniRoute 流式完成响应 body 尾部的 `: x-omniroute-*` SSE 注释行遥测，在 `done` 事件把 `X-OmniRoute-Response-Cost` 写入 `message.usage.cost.total`（Pi 的 usage-totals 聚合该字段显示真实成本），并将完整遥测附加到 `message.diagnostics`（type `omniroute-telemetry`）。

**Architecture:** 新模块 `src/tools/usage-telemetry.ts` 提供 5 个导出：`parseOmnirouteTelemetryLine`（单行解析）/ `extractOmnirouteTelemetry`（多行合并）/ `createTelemetryTransformStream`（字节透传 + 行缓冲 + 遥测提取到闭包）/ `withOmnirouteFetch`（包装 fetch，`response.body.pipeThrough` 后返回 `new Response(transformed, res)`）/ `wrapStreamWithCost`（`createAssistantMessageEventStream()` 逐事件转发，done 时覆盖 `cost.total` + `appendAssistantMessageDiagnostic`）。`src/index.ts` 的 provider `stream`/`streamSimple` 包装改为注入这两个包装器。

**Tech Stack:** TypeScript · pi-ai 0.83（`@earendil-works/pi-ai` 主包导出 `createAssistantMessageEventStream` + `appendAssistantMessageDiagnostic`）· node:test（`node --test --experimental-strip-types 'test/**/*.test.ts'`）· `npm run typecheck` = `tsc --noEmit`。

## Global Constraints

- 只解析流式响应 body 的 SSE 注释行（`^: x-omniroute-(.+?)=(.+)$`）；**不做 HTTP headers 解析**（delta spec 已移除该场景）。
- 注释行格式（实测 route.ai.philogag.com）：`data: [DONE]` 之前的行形如 `: x-omniroute-cache-hit=false`、`: x-omniroute-latency-ms=1161`、`: x-omniroute-response-cost=0.0000190400`、`: x-omniroute-tokens-in=88`、`: x-omniroute-tokens-out=13`。
- 仅覆盖 `message.usage.cost.total`；`input/output/cacheRead/cacheWrite` 分项与 token 计数保持不变。
- 缓存命中语义：`cache-hit=true` 且 responseCost 为 0 时无条件覆盖为 0。
- 无遥测 / 解析失败（NaN）/ 非 2xx 响应 / 流中断：静默降级，不报错不覆盖。
- 仅 omniroute provider 生效（注入点在 `src/index.ts` provider 定义内）。
- 透传语义：TransformStream 必须把原始字节原样 enqueue，SDK 看到的流内容不变。
- 禁改文件（0 diff）：`src/auth.ts`、`src/auth-credentials.ts`、`src/tools/http.ts`、`test/lazy-fetch.test.ts`、`test/auth-credentials.test.ts`、`test/url.test.ts`、`test/tools-*.test.ts`。
- 无新依赖。
- 基线：190/190 测试通过（`npm test`）+ `npm run typecheck` exit 0。
- 每个任务独立 commit，commit message 体现设计意图。
- 每完成一个 plan 任务，勾选 `openspec/changes/add-usage-cost-telemetry/tasks.md` 对应项（只改内容不 commit tasks.md）。

---

### Task 1: 遥测解析器（parseOmnirouteTelemetryLine + extractOmnirouteTelemetry）

**Files:**
- Create: `src/tools/usage-telemetry.ts`
- Test: `test/usage-telemetry.test.ts`

**Interfaces:**
- Consumes: nothing (pure functions, no imports from pi-ai)
- Produces:
  - `interface OmnirouteTelemetry { responseCost?: number; tokensIn?: number; tokensOut?: number; model?: string; provider?: string; cacheHit?: boolean; latencyMs?: number }`
  - `function parseOmnirouteTelemetryLine(line: string): Partial<OmnirouteTelemetry> | null`
  - `function extractOmnirouteTelemetry(text: string): OmnirouteTelemetry | undefined`

- [ ] **Step 1: Write the failing tests** (test/usage-telemetry.test.ts)

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseOmnirouteTelemetryLine, extractOmnirouteTelemetry } from "../src/tools/usage-telemetry.ts";

test("parseOmnirouteTelemetryLine parses a full comment line", () => {
  assert.deepEqual(
    parseOmnirouteTelemetryLine(": x-omniroute-response-cost=0.0000190400"),
    { responseCost: 0.00001904 },
  );
  assert.deepEqual(
    parseOmnirouteTelemetryLine(": x-omniroute-tokens-in=88"),
    { tokensIn: 88 },
  );
  assert.deepEqual(
    parseOmnirouteTelemetryLine(": x-omniroute-tokens-out=13"),
    { tokensOut: 13 },
  );
  assert.deepEqual(
    parseOmnirouteTelemetryLine(": x-omniroute-model=deepseek-v4-flash"),
    { model: "deepseek-v4-flash" },
  );
  assert.deepEqual(
    parseOmnirouteTelemetryLine(": x-omniroute-provider=opencode-go"),
    { provider: "opencode-go" },
  );
  assert.deepEqual(
    parseOmnirouteTelemetryLine(": x-omniroute-cache-hit=false"),
    { cacheHit: false },
  );
  assert.deepEqual(
    parseOmnirouteTelemetryLine(": x-omniroute-latency-ms=1161"),
    { latencyMs: 1161 },
  );
});

test("parseOmnirouteTelemetryLine returns null for non-comment lines", () => {
  assert.equal(parseOmnirouteTelemetryLine("data: {\"choices\":[]}"), null);
  assert.equal(parseOmnirouteTelemetryLine("data: [DONE]"), null);
  assert.equal(parseOmnirouteTelemetryLine(""), null);
  assert.equal(parseOmnirouteTelemetryLine(": x-omniroute-route-class=standard"), null); // unknown key ignored
});

test("parseOmnirouteTelemetryLine tolerates NaN and empty values", () => {
  assert.deepEqual(parseOmnirouteTelemetryLine(": x-omniroute-response-cost=abc"), {});
  assert.deepEqual(parseOmnirouteTelemetryLine(": x-omniroute-latency-ms="), {});
});

test("extractOmnirouteTelemetry merges multiple lines", () => {
  const text = [
    "data: {\"choices\":[]}",
    ": x-omniroute-cache-hit=false",
    ": x-omniroute-latency-ms=1161",
    ": x-omniroute-response-cost=0.0000190400",
    ": x-omniroute-tokens-in=88",
    ": x-omniroute-tokens-out=13",
    "data: [DONE]",
  ].join("\n");
  assert.deepEqual(extractOmnirouteTelemetry(text), {
    cacheHit: false,
    latencyMs: 1161,
    responseCost: 0.00001904,
    tokensIn: 88,
    tokensOut: 13,
  });
});

test("extractOmnirouteTelemetry returns undefined when no telemetry", () => {
  assert.equal(extractOmnirouteTelemetry("data: [DONE]"), undefined);
  assert.equal(extractOmnirouteTelemetry(""), undefined);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/usage-telemetry.test.ts`
Expected: FAIL — module `../src/tools/usage-telemetry.ts` not found / functions undefined

- [ ] **Step 3: Write minimal implementation** (src/tools/usage-telemetry.ts — first part)

```ts
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

const TELEMETRY_LINE_RE = /^: x-omniroute-([a-z-]+)=(.+)$/;

/** Parses a single SSE comment line; returns null for anything else. */
export function parseOmnirouteTelemetryLine(
  line: string,
): Partial<OmnirouteTelemetry> | null {
  const match = TELEMETRY_LINE_RE.exec(line);
  if (!match) return null;
  const key = match[1];
  const value = match[2];
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
  for (const line of text.split("\n")) {
    const parsed = parseOmnirouteTelemetryLine(line);
    if (parsed) {
      result = { ...(result ?? {}), ...parsed };
    }
  }
  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/usage-telemetry.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/tools/usage-telemetry.ts test/usage-telemetry.test.ts
git commit -m "feat: parse OmniRoute cost telemetry SSE comment lines"
```

---

### Task 2: TransformStream 透传 + withOmnirouteFetch

**Files:**
- Modify: `src/tools/usage-telemetry.ts`
- Test: `test/usage-telemetry.test.ts`

**Interfaces:**
- Consumes: `parseOmnirouteTelemetryLine` from Task 1
- Produces:
  - `function createTelemetryTransformStream(): TransformStream<Uint8Array, Uint8Array>` — telemetry extracted into a closure; expose via returned object? No — design: the stream itself plus a getter. Simplest: return `{ stream: TransformStream<Uint8Array, Uint8Array>, getTelemetry: () => OmnirouteTelemetry | undefined }`. **Decision: return a `TelemetryTransform { stream; getTelemetry }` object.**
  - `type TelemetryTransform = { stream: TransformStream<Uint8Array, Uint8Array>; getTelemetry: () => OmnirouteTelemetry | undefined }`
  - `function withOmnirouteFetch(fetchImpl: typeof fetch, onTelemetry?: (t: OmnirouteTelemetry) => void): typeof fetch` — returns a wrapped fetch; on each response, pipes body through a fresh TelemetryTransform and invokes `onTelemetry` when complete.

- [ ] **Step 1: Write the failing tests** (append to test/usage-telemetry.test.ts)

```ts
import { createTelemetryTransformStream, withOmnirouteFetch } from "../src/tools/usage-telemetry.ts";

test("createTelemetryTransformStream passes bytes through unchanged", async () => {
  const { stream, getTelemetry } = createTelemetryTransformStream();
  const chunks = [new TextEncoder().encode("data: {\"a\":1}\n"), new TextEncoder().encode(": x-omniroute-response-cost=0.5\n")];
  const reader = stream.readable.getReader();
  const received: Uint8Array[] = [];
  const readPromise = (async () => {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received.push(value);
    }
  })();
  for (const c of chunks) stream.writable.getWriter().write(c);
  await stream.writable.getWriter().close();
  await readPromise;
  const joined = new TextDecoder().decode(concatBytes(received));
  assert.equal(joined, "data: {\"a\":1}\n: x-omniroute-response-cost=0.5\n");
  assert.deepEqual(getTelemetry(), { responseCost: 0.5 });
});

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

test("createTelemetryTransformStream handles comment split across chunks", async () => {
  const { stream, getTelemetry } = createTelemetryTransformStream();
  const enc = new TextEncoder();
  const reader = stream.readable.getReader();
  const drain = (async () => { while (!(await reader.read()).done) { /* drain */ } })();
  const w = stream.writable.getWriter();
  await w.write(enc.encode("data: [DONE]\n: x-omniroute-response-co"));
  await w.write(enc.encode("st=0.0000190400\ndata: [DONE]\n"));
  await w.close();
  await drain;
  assert.deepEqual(getTelemetry(), { responseCost: 0.00001904 });
});

test("createTelemetryTransformStream handles no trailing newline (flush)", async () => {
  const { stream, getTelemetry } = createTelemetryTransformStream();
  const reader = stream.readable.getReader();
  const drain = (async () => { while (!(await reader.read()).done) { /* drain */ } })();
  const w = stream.writable.getWriter();
  await w.write(new TextEncoder().encode("data: [DONE]\n: x-omniroute-tokens-in=88"));
  await w.close();
  await drain;
  assert.deepEqual(getTelemetry(), { tokensIn: 88 });
});

test("createTelemetryTransformStream decodes multibyte UTF-8 across chunks", async () => {
  const { stream, getTelemetry } = createTelemetryTransformStream();
  const reader = stream.readable.getReader();
  const received: Uint8Array[] = [];
  const readPromise = (async () => {
    for (;;) { const { done, value } = await reader.read(); if (done) break; received.push(value); }
  })();
  const enc = new TextEncoder();
  const w = stream.writable.getWriter();
  const half = enc.encode("data: {\"content\":\"中");
  await w.write(half.subarray(0, 5));
  await w.write(half.subarray(5));
  await w.write(enc.encode("文\"}\n: x-omniroute-model=m\n"));
  await w.close();
  await readPromise;
  assert.equal(new TextDecoder().decode(concatBytes(received)), "data: {\"content\":\"中文\"}\n: x-omniroute-model=m\n");
  assert.deepEqual(getTelemetry(), { model: "m" });
});

test("withOmnirouteFetch wraps response body and reports telemetry", async () => {
  const inner = async () => new Response(new Blob(["data: [DONE]\n: x-omniroute-response-cost=0.25\n"]), { status: 200 });
  let reported: OmnirouteTelemetry | undefined;
  const wrapped = withOmnirouteFetch(inner as typeof fetch, (t) => { reported = t; });
  const res = await wrapped("https://example.com/v1/chat/completions", { method: "POST" } as RequestInit);
  assert.equal(res.ok, true);
  const body = await res.text();
  assert.equal(body, "data: [DONE]\n: x-omniroute-response-cost=0.25\n");
  assert.deepEqual(reported, { responseCost: 0.25 });
});

test("withOmnirouteFetch passes through non-ok responses untouched", async () => {
  const inner = async () => new Response("oops", { status: 500 });
  const wrapped = withOmnirouteFetch(inner as typeof fetch);
  const res = await wrapped("https://example.com/v1/chat/completions", {} as RequestInit);
  assert.equal(res.status, 500);
  assert.equal(await res.text(), "oops");
});

test("withOmnirouteFetch reports no telemetry when absent", async () => {
  const inner = async () => new Response(new Blob(["data: [DONE]\n"]), { status: 200 });
  let reported: OmnirouteTelemetry | undefined = undefined;
  const wrapped = withOmnirouteFetch(inner as typeof fetch, (t) => { reported = t; });
  await wrapped("https://example.com/v1/chat/completions", {} as RequestInit);
  assert.equal(reported, undefined);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/usage-telemetry.test.ts`
Expected: FAIL — `createTelemetryTransformStream`/`withOmnirouteFetch` undefined

- [ ] **Step 3: Write minimal implementation** (append to src/tools/usage-telemetry.ts)

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/usage-telemetry.test.ts`
Expected: PASS (5 + 7 = 12 tests)

- [ ] **Step 5: Run full suite + typecheck (no regressions)**

Run: `npm test && npm run typecheck`
Expected: 190 + 12 = 202 tests pass, typecheck exit 0

- [ ] **Step 6: Commit**

```bash
git add src/tools/usage-telemetry.ts test/usage-telemetry.test.ts
git commit -m "feat: byte-transparent telemetry transform stream and fetch wrapper"
```

---

### Task 3: wrapStreamWithCost（cost 覆盖 + diagnostics）

**Files:**
- Modify: `src/tools/usage-telemetry.ts`
- Test: `test/usage-telemetry-stream.test.ts`

**Interfaces:**
- Consumes: `OmnirouteTelemetry` from Task 1; `createAssistantMessageEventStream` + `appendAssistantMessageDiagnostic` from `@earendil-works/pi-ai` (verified exported from main package, index.d.ts lines 26-27)
- Produces:
  - `function wrapStreamWithCost(stream: AssistantMessageEventStream, telemetry: OmnirouteTelemetry | undefined | (() => OmnirouteTelemetry | undefined)): AssistantMessageEventStream`
  - Behavior: forwards all events; on `done` event, resolves the telemetry (calling the getter if provided) and, if `responseCost !== undefined`, sets `event.message.usage.cost.total = telemetry.responseCost` and appends `{ type: "omniroute-telemetry", timestamp: Date.now(), details: { responseCost, tokensIn, tokensOut, model, provider, cacheHit } }` via `appendAssistantMessageDiagnostic`.
  - **Why getter:** withOmnirouteFetch reports telemetry via an async callback (after the body's writable side is fully piped), which may resolve AFTER the `done` event fires. Reading the value at `done` time via a closure getter guarantees we see THIS response's telemetry, never a stale/previous one.

- [ ] **Step 1: Write the failing tests** (test/usage-telemetry-stream.test.ts)

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createAssistantMessageEventStream, type AssistantMessageEventStream } from "@earendil-works/pi-ai";
import { wrapStreamWithCost, type OmnirouteTelemetry } from "../src/tools/usage-telemetry.ts";

function makeSource(events: Array<{ type: string; message?: any }>, doneMessage?: any): AssistantMessageEventStream {
  const s = createAssistantMessageEventStream();
  for (const e of events) s.push(e as never);
  if (doneMessage) s.push({ type: "done", message: doneMessage } as never);
  s.end(doneMessage);
  return s;
}

function makeMessage() {
  return {
    role: "assistant",
    content: [{ type: "text", text: "hi" }],
    usage: {
      input: 88, output: 13, cacheRead: 0, cacheWrite: 0, totalTokens: 101,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: 1,
  };
}

test("wrapStreamWithCost resolves telemetry via getter at done time", async () => {
  const msg = makeMessage();
  const src = makeSource([], msg);
  let current: OmnirouteTelemetry | undefined = { responseCost: 0.5 };
  const out = wrapStreamWithCost(src, () => current);
  current = { responseCost: 0.75 }; // simulate telemetry arriving after stream starts
  const result = await out.result();
  assert.equal(result.usage.cost.total, 0.75);
});

test("wrapStreamWithCost overwrites cost.total and appends diagnostic on done", async () => {
  const msg = makeMessage();
  const src = makeSource([{ type: "text_start", message: msg }], msg);
  const telemetry: OmnirouteTelemetry = { responseCost: 0.00001904, tokensIn: 88, tokensOut: 13, model: "m", provider: "p", cacheHit: false };
  const out = wrapStreamWithCost(src, telemetry);
  const result = await out.result();
  assert.equal(result.usage.cost.total, 0.00001904);
  const diag = result.diagnostics!.find((d: any) => d.type === "omniroute-telemetry");
  assert.ok(diag, "diagnostic attached");
  assert.equal(diag.details.responseCost, 0.00001904);
  assert.equal(diag.details.cacheHit, false);
  assert.equal(result.usage.input, 88); // token counts untouched
  assert.equal(result.usage.cost.input, 0); // cost sub-fields untouched
});

test("wrapStreamWithCost forwards all events in order", async () => {
  const msg = makeMessage();
  const src = makeSource([{ type: "text_start", message: msg }], msg);
  const out = wrapStreamWithCost(src, { responseCost: 0.1 });
  const types: string[] = [];
  for await (const ev of out) types.push(ev.type as string);
  assert.deepEqual(types, ["text_start", "done"]);
});

test("wrapStreamWithCost leaves message alone without telemetry", async () => {
  const msg = makeMessage();
  const src = makeSource([], msg);
  const out = wrapStreamWithCost(src, undefined);
  const result = await out.result();
  assert.equal(result.usage.cost.total, 0);
  assert.equal(result.diagnostics, undefined);
});

test("wrapStreamWithCost forwards error events unchanged", async () => {
  const src = createAssistantMessageEventStream();
  src.push({ type: "error", error: new Error("boom") } as never);
  src.end(new Error("boom"));
  const out = wrapStreamWithCost(src, { responseCost: 0.5 });
  const result = await out.result();
  assert.ok(result instanceof Error);
  assert.equal((result as Error).message, "boom");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/usage-telemetry-stream.test.ts`
Expected: FAIL — `wrapStreamWithCost` undefined

- [ ] **Step 3: Write minimal implementation** (append to src/tools/usage-telemetry.ts)

```ts
import { createAssistantMessageEventStream, appendAssistantMessageDiagnostic } from "@earendil-works/pi-ai";
import type { AssistantMessageEventStream, AssistantMessage } from "@earendil-works/pi-ai";

/**
 * Wraps a pi-ai AssistantMessageEventStream so that on completion (`done`)
 * the OmniRoute-reported cost overwrites `message.usage.cost.total` and the
 * full telemetry is attached to `message.diagnostics`. Without telemetry the
 * stream is forwarded untouched.
 */
export function wrapStreamWithCost(
  stream: AssistantMessageEventStream,
  telemetry: OmnirouteTelemetry | undefined | (() => OmnirouteTelemetry | undefined),
): AssistantMessageEventStream {
  const out = createAssistantMessageEventStream();
  const pump = async () => {
    try {
      for await (const event of stream) {
        if (event.type === "done") {
          const t =
            typeof telemetry === "function" ? telemetry() : telemetry;
          if (t?.responseCost !== undefined) {
            const message = event.message as AssistantMessage;
            message.usage.cost.total = t.responseCost;
            appendAssistantMessageDiagnostic(message, {
              type: "omniroute-telemetry",
              timestamp: Date.now(),
              details: {
                responseCost: t.responseCost,
                tokensIn: t.tokensIn,
                tokensOut: t.tokensOut,
                model: t.model,
                provider: t.provider,
                cacheHit: t.cacheHit,
              },
            });
          }
        }
        out.push(event);
      }
    } catch {
      // Best-effort: if the source stream errors mid-way, terminate output.
    } finally {
      out.end();
    }
  };
  void pump();
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/usage-telemetry-stream.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Run full suite + typecheck**

Run: `npm test && npm run typecheck`
Expected: 202 + 5 = 207 tests pass, typecheck exit 0

- [ ] **Step 6: Commit**

```bash
git add src/tools/usage-telemetry.ts test/usage-telemetry-stream.test.ts
git commit -m "feat: wrap event stream to write OmniRoute cost into usage.cost.total"
```

---

### Task 4: Provider 接线（src/index.ts）

**Files:**
- Modify: `src/index.ts` (provider `stream`/`streamSimple` at lines ~97-103)
- Test: `test/usage-telemetry-integration.test.ts`

**Interfaces:**
- Consumes: `withOmnirouteFetch`, `wrapStreamWithCost` from Task 2/3; existing `stream`/`streamSimple` imports from `@earendil-works/pi-ai/compat`; `Provider`/`StreamOptions`/`SimpleStreamOptions` types already imported
- Produces: omniroute provider's `stream`/`streamSimple` now (a) route requests through `withOmnirouteFetch` with an `onTelemetry` closure, and (b) wrap the returned stream with `wrapStreamWithCost(stream, telemetry)`.

- [ ] **Step 1: Write the failing test** (test/usage-telemetry-integration.test.ts)

```ts
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

  const sseBody = [
    "data: {\"id\":\"x\",\"object\":\"chat.completion.chunk\",\"created\":1,\"model\":\"deepseek-v4-flash\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"hi\"},\"finish_reason\":null}]}",
    "data: {\"id\":\"x\",\"object\":\"chat.completion.chunk\",\"created\":1,\"model\":\"deepseek-v4-flash\",\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":88,\"completion_tokens\":13,\"total_tokens\":101}}",
    ": x-omniroute-cache-hit=false",
    ": x-omniroute-latency-ms=1161",
    ": x-omniroute-response-cost=0.0000190400",
    ": x-omniroute-tokens-in=88",
    ": x-omniroute-tokens-out=13",
    "data: [DONE]",
    "",
  ].join("\n");

  mock.method(globalThis, "fetch", async () =>
    new Response(new Blob([sseBody]), { status: 200, headers: { "content-type": "text/event-stream" } }),
  );

  const model = { id: "deepseek-v4-flash", api: "openai-completions", provider: "omniroute", baseUrl: "https://example.com/v1", cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } } as never;
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/usage-telemetry-integration.test.ts`
Expected: FAIL — `done.message.usage.cost.total` is 0 (telemetry not captured)

- [ ] **Step 3: Write minimal implementation** (src/index.ts)

Replace the provider definition (lines ~91-103):

```ts
  const provider: Provider<"openai-completions"> = {
    id: "omniroute",
    name: "OmniRoute",
    baseUrl,
    auth: { apiKey: omnirouteApiKeyAuth() },
    getModels: () => models,
    async refreshModels({ signal }) {
      const res = await fetch(`${baseUrl}/models`, { signal });
      if (!res.ok) throw new Error(`OmniRoute /models failed: ${res.status}`);
      const { data } = (await res.json()) as { data: OmnirouteModelEntry[] };
      models = data.map((m) => toOmnirouteModel(m, baseUrl));
    },
    stream: (
      model: OmnirouteModel,
      context: Context,
      options?: StreamOptions,
    ) => {
      let telemetry: OmnirouteTelemetry | undefined = undefined;
      const captured = withOmnirouteFetch(fetch, (t) => { telemetry = t; });
      return wrapStreamWithCost(
        stream(model, context, { ...options, fetch: captured } as never),
        () => telemetry,
      );
    },
    streamSimple: (
      model: OmnirouteModel,
      context: Context,
      options?: SimpleStreamOptions,
    ) => {
      let telemetry: OmnirouteTelemetry | undefined = undefined;
      const captured = withOmnirouteFetch(fetch, (t) => { telemetry = t; });
      return wrapStreamWithCost(
        streamSimple(model, context, { ...options, fetch: captured }),
        () => telemetry,
      );
    },
  };
```

Update imports at top of src/index.ts:

```ts
import type { OmnirouteTelemetry } from "./tools/usage-telemetry.ts";
import { withOmnirouteFetch, wrapStreamWithCost } from "./tools/usage-telemetry.ts";
```

**Why per-call closure + getter:** each `stream`/`streamSimple` invocation gets its OWN `telemetry` variable and its OWN `withOmnirouteFetch` wrapper, so concurrent requests never share state. The getter `() => telemetry` is read by `wrapStreamWithCost` at `done`-event time — by then the body has been fully piped (comment lines sit before `data: [DONE]` in the body), so `onTelemetry` has fired and the getter returns THIS response's telemetry.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/usage-telemetry-integration.test.ts`
Expected: PASS

- [ ] **Step 5: Run full suite + typecheck (regression gate)**

Run: `npm test && npm run typecheck`
Expected: 207 + 1 = 208 tests pass, typecheck exit 0

- [ ] **Step 6: Commit**

```bash
git add src/index.ts test/usage-telemetry-integration.test.ts
git commit -m "feat: wire OmniRoute cost telemetry into omniroute provider stream"
```

---

### Task 5: 验证收尾 + README

**Files:**
- Modify: `README.md`, `README.zh-CN.md` (add a short note about cost telemetry)
- Modify: `openspec/changes/add-usage-cost-telemetry/tasks.md` (tick all boxes — content only, no commit)

**Interfaces:**
- Consumes: everything from Tasks 1-4

- [ ] **Step 1: Full verification**

Run: `npm test && npm run typecheck`
Expected: all tests pass (207 total), typecheck exit 0
Run: `git diff --stat main` — confirm only `src/index.ts`, `src/tools/usage-telemetry.ts`, 3 test files, READMEs, and OpenSpec change files are touched; forbidden files (Global Constraints) have 0 diff.

- [ ] **Step 2: Add README note (both languages)**

In README.md and README.zh-CN.md, add under the provider description:

```markdown
### Cost telemetry

Session message costs (shown in Pi's usage/cost statistics) reflect the real
USD amount reported by OmniRoute's `X-OmniRoute-Response-Cost` header
(streamed as SSE comment lines in the response body). Cache hits are billed at
$0 by OmniRoute and show as `0`. Full telemetry (model, provider, tokens,
cache-hit, latency) is attached to each message's `diagnostics` under type
`omniroute-telemetry`.
```

- [ ] **Step 3: Tick tasks.md boxes**

Edit `openspec/changes/add-usage-cost-telemetry/tasks.md` — set all `- [ ]` to `- [x]` (1.1-1.3, 2.1-2.2, 3.1-3.2, 4.1-4.3). Do NOT commit tasks.md.

- [ ] **Step 4: Commit**

```bash
git add README.md README.zh-CN.md
git commit -m "docs: document OmniRoute cost telemetry in READMEs"
```

---

## Self-Review (done at plan-write time)

**Spec coverage:**
- 需求 1（捕获遥测）：Task 1 解析器 + Task 2 TransformStream/withOmnirouteFetch；场景"流式解析"/"跨 chunk"/"无遥测降级"/"NaN 容错" → Task 1-2 测试。✓
- 需求 2（接入计费统计）：Task 3 wrapStreamWithCost + Task 4 接线；场景"done 覆盖"/"仅 omniroute"/"缓存命中 0"/"未捕获不覆盖" → Task 3-4 测试。✓
- 需求 3（遥测详情 diagnostics）：Task 3 appendAssistantMessageDiagnostic；场景"附加诊断"/"无遥测不附加" → Task 3 测试。✓

**Placeholder scan:** No TBD/TODO/placeholder steps — every step has concrete code. ✓

**Type consistency:**
- `OmnirouteTelemetry`（Task 1）在 Task 2/3/4 中一致使用。✓
- `parseOmnirouteTelemetryLine → Partial<OmnirouteTelemetry> | null`、`extractOmnirouteTelemetry → OmnirouteTelemetry | undefined`、`createTelemetryTransformStream → TelemetryTransform`、`withOmnirouteFetch → typeof fetch`、`wrapStreamWithCost(stream, telemetry) → AssistantMessageEventStream` 跨任务一致。✓
- `appendAssistantMessageDiagnostic(message, { type, timestamp, details })` 签名匹配 pi-ai dist/utils/diagnostics.d.ts:16。✓
- `createAssistantMessageEventStream()` 无参工厂匹配 dist/utils/event-stream.d.ts:20。✓
- done 事件 `event.message.usage.cost.total`：AssistantMessage.usage.cost.total 类型（types.d.ts Usage.cost.total: number）。✓

**Architecture consistency with design doc:**
- D1 仅 body 注释行 ✓（Task 2）
- D2 done 无条件覆盖 ✓（Task 3）
- D3 diagnostics 落点 ✓（Task 3）
- D4 TransformStream 透传 + 行缓冲 ✓（Task 2）
- D5 静默降级 ✓（withOmnirouteFetch 非 2xx 直通、getTelemetry undefined 不覆盖）
- D6 仅 omniroute ✓（Task 4 注入点在 provider 定义内）

**Test count projection:** baseline 190 + Task1 5 + Task2 7 + Task3 5 + Task4 1 = 208 tests.

## Execution Handoff

Plan saved. Two execution options:
1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks
2. **Inline Execution** — execute tasks in this session with checkpoints

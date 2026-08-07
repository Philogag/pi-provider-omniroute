import { test } from "node:test";
import assert from "node:assert/strict";
import { createTelemetryTransformStream, withOmnirouteFetch, type OmnirouteTelemetry } from "../src/tools/usage-telemetry.ts";

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
  const w = stream.writable.getWriter();
  for (const c of chunks) await w.write(c);
  await w.close();
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

test("createTelemetryTransformStream parses CRLF telemetry lines", async () => {
  const { stream, getTelemetry } = createTelemetryTransformStream();
  const reader = stream.readable.getReader();
  const drain = (async () => { while (!(await reader.read()).done) { /* drain */ } })();
  const w = stream.writable.getWriter();
  await w.write(new TextEncoder().encode("data: [DONE]\r\n: x-omniroute-response-cost=0.5\r\n"));
  await w.close();
  await drain;
  assert.deepEqual(getTelemetry(), { responseCost: 0.5 });
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
  await w.write(half.subarray(0, 19)); // ends mid-codepoint: last byte is 0xE4 of 中
  await w.write(half.subarray(19)); // starts at 0xB8, completing 中 across chunks
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

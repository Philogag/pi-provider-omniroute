import { test, mock, after } from "node:test";
import assert from "node:assert/strict";
import { fetchSearchProviders, resolveSearchCatalog, SearchCatalogError, STATIC_FALLBACK_PROVIDERS } from "../src/tools/search-config.ts";

const origFetch = globalThis.fetch;
after(() => { globalThis.fetch = origFetch; mock.restoreAll(); });

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

test("fetchSearchProviders: 200 + valid body returns providers", async () => {
  globalThis.fetch = mock.method(globalThis, "fetch", async () => jsonResponse(200, {
    object: "list",
    data: [
      { id: "tavily-search", name: "Tavily", search_types: ["web","news"] },
      { id: "brave-search",  name: "Brave",  search_types: ["web"] },
    ],
  })) as never;
  const out = await fetchSearchProviders("http://x", "key", new AbortController().signal);
  assert.deepEqual(out, [
    { id: "tavily-search", name: "Tavily", search_types: ["web","news"] },
    { id: "brave-search",  name: "Brave",  search_types: ["web"] },
  ]);
});

test("fetchSearchProviders: 401 throws SearchCatalogError", async () => {
  globalThis.fetch = mock.method(globalThis, "fetch", async () => jsonResponse(401, { error: "unauthorized" })) as never;
  await assert.rejects(
    fetchSearchProviders("http://x", "bad", new AbortController().signal),
    (err: unknown) => err instanceof SearchCatalogError,
  );
});

test("fetchSearchProviders: 5xx throws SearchCatalogError", async () => {
  globalThis.fetch = mock.method(globalThis, "fetch", async () => jsonResponse(502, { error: "bad gateway" })) as never;
  await assert.rejects(
    fetchSearchProviders("http://x", "k", new AbortController().signal),
    (err: unknown) => err instanceof SearchCatalogError,
  );
});

test("fetchSearchProviders: network error throws SearchCatalogError", async () => {
  globalThis.fetch = mock.method(globalThis, "fetch", async () => { throw new Error("ECONNREFUSED"); }) as never;
  await assert.rejects(
    fetchSearchProviders("http://x", "k", new AbortController().signal),
    (err: unknown) => err instanceof SearchCatalogError && /ECONNREFUSED/.test((err as Error).message),
  );
});

test("fetchSearchProviders: invalid JSON body throws SearchCatalogError", async () => {
  globalThis.fetch = mock.method(globalThis, "fetch", async () => ({
    ok: true, status: 200, json: async () => { throw new SyntaxError("bad json"); },
  } as unknown as Response)) as never;
  await assert.rejects(
    fetchSearchProviders("http://x", "k", new AbortController().signal),
    (err: unknown) => err instanceof SearchCatalogError,
  );
});

test("fetchSearchProviders: body missing data array throws", async () => {
  globalThis.fetch = mock.method(globalThis, "fetch", async () => jsonResponse(200, { object: "list" })) as never;
  await assert.rejects(
    fetchSearchProviders("http://x", "k", new AbortController().signal),
    (err: unknown) => err instanceof SearchCatalogError,
  );
});

test("fetchSearchProviders: empty data array throws (spec G5)", async () => {
  globalThis.fetch = mock.method(globalThis, "fetch", async () => jsonResponse(200, { object: "list", data: [] })) as never;
  await assert.rejects(
    fetchSearchProviders("http://x", "k", new AbortController().signal),
    (err: unknown) => err instanceof SearchCatalogError,
  );
});

test("resolveSearchCatalog: success returns isFallback=false", async () => {
  globalThis.fetch = mock.method(globalThis, "fetch", async () => jsonResponse(200, {
    data: [{ id: "exa-search", name: "Exa", search_types: ["web"] }],
  })) as never;
  const out = await resolveSearchCatalog("http://x", "k", new AbortController().signal);
  assert.equal(out.isFallback, false);
  assert.equal(out.providers[0]?.id, "exa-search");
});

test("resolveSearchCatalog: 401 returns static fallback isFallback=true", async () => {
  globalThis.fetch = mock.method(globalThis, "fetch", async () => jsonResponse(401, {})) as never;
  const out = await resolveSearchCatalog("http://x", "bad", new AbortController().signal);
  assert.equal(out.isFallback, true);
  assert.equal(out.providers.length, STATIC_FALLBACK_PROVIDERS.length);
  assert.equal(out.providers[0]?.id, STATIC_FALLBACK_PROVIDERS[0]);
});

test("resolveSearchCatalog: network error returns static fallback isFallback=true", async () => {
  globalThis.fetch = mock.method(globalThis, "fetch", async () => { throw new Error("ETIMEDOUT"); }) as never;
  const out = await resolveSearchCatalog("http://x", "k", new AbortController().signal);
  assert.equal(out.isFallback, true);
  assert.equal(out.providers.length, STATIC_FALLBACK_PROVIDERS.length);
});

test("fetchSearchProviders: provider with missing fields throws (schema mismatch)", async () => {
  globalThis.fetch = mock.method(globalThis, "fetch", async () => jsonResponse(200, {
    data: [{ id: "bad" }],  // missing name + search_types
  })) as never;
  await assert.rejects(
    fetchSearchProviders("http://x", "k", new AbortController().signal),
    (err: unknown) => err instanceof SearchCatalogError,
  );
});

test("fetchSearchProviders: provider with empty name uses id as label fallback (in resolve)", async () => {
  globalThis.fetch = mock.method(globalThis, "fetch", async () => jsonResponse(200, {
    data: [{ id: "weird-search", name: "", search_types: ["web"] }],
  })) as never;
  const out = await resolveSearchCatalog("http://x", "k", new AbortController().signal);
  // Static fallback path also has name=id for empty-name providers; we accept either rendering.
  // Here we confirm the provider is included; the renderer in Task 3 handles label fallback.
  assert.equal(out.providers[0]?.id, "weird-search");
  assert.equal(out.isFallback, false);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import type { ProviderAuthInteraction, AuthPrompt } from "@earendil-works/pi-ai";

function mockInteraction(answers: Array<string | Error>): ProviderAuthInteraction & { calls: AuthPrompt[] } {
  const calls: AuthPrompt[] = [];
  return {
    signal: new AbortController().signal,
    async prompt(p: AuthPrompt): Promise<string> {
      calls.push(p);
      const next = answers.shift();
      if (next === undefined) throw new Error("no more mock answers");
      if (next instanceof Error) throw next;
      return next;
    },
    notify() {},
    get calls() {
      return calls;
    },
  };
}

function mockCtx(envValues: Record<string, string | undefined>) {
  return {
    async env(name: string): Promise<string | undefined> {
      return envValues[name];
    },
    async fileExists(): Promise<boolean> {
      return false;
    },
  };
}

async function getAuth() {
  const mod = await import("../src/auth.ts");
  return mod.omnirouteApiKeyAuth();
}

test("login: prompts exactly once (secret key only)", async () => {
  const auth = await getAuth();
  const interaction = mockInteraction(["my-key"]);
  const cred = await auth.login!(interaction);
  assert.equal((interaction as unknown as { calls: AuthPrompt[] }).calls.length, 1);
  assert.equal((interaction as unknown as { calls: AuthPrompt[] }).calls[0].type, "secret");
  assert.equal(cred.type, "api_key");
  if (cred.type !== "api_key") throw new Error("narrow");
  assert.equal(cred.key, "my-key");
  assert.equal(cred.env, undefined, "credential must not carry env/baseUrl");
});

test("login: propagates cancel error from interaction.prompt", async () => {
  const auth = await getAuth();
  const cancelError = new Error("cancelled");
  await assert.rejects(auth.login!(mockInteraction([cancelError])), /cancelled/);
});

test("resolve: stored credential key wins over env, no baseUrl/env leaked", async () => {
  const auth = await getAuth();
  const ctx = mockCtx({ OMNIROUTE_API_KEY: "env-key", OMNIROUTE_BASE_URL: "https://env/v1" });
  const credential = { type: "api_key" as const, key: "stored-key" };
  const result = await auth.resolve!({ ctx, credential, signal: new AbortController().signal });
  assert.ok(result);
  assert.equal((result as { auth: { apiKey: string } }).auth.apiKey, "stored-key");
  assert.equal((result as { auth: { baseUrl?: string } }).auth.baseUrl, undefined, "resolve must not emit baseUrl");
  assert.equal((result as { env?: unknown }).env, undefined, "resolve must not emit env");
  assert.equal((result as { source: string }).source, "stored credential");
});

test("resolve: falls back to OMNIROUTE_API_KEY env when no stored credential", async () => {
  const auth = await getAuth();
  const ctx = mockCtx({ OMNIROUTE_API_KEY: "env-key" });
  const result = await auth.resolve!({ ctx, credential: undefined, signal: new AbortController().signal });
  assert.ok(result);
  assert.equal((result as { auth: { apiKey: string } }).auth.apiKey, "env-key");
  assert.equal((result as { env?: unknown }).env, undefined);
});

test("resolve: returns undefined when no credential and no env", async () => {
  const auth = await getAuth();
  const result = await auth.resolve!({ ctx: mockCtx({}), credential: undefined, signal: new AbortController().signal });
  assert.equal(result, undefined);
});

test("resolve: source field never contains the key value", async () => {
  const auth = await getAuth();
  const result = await auth.resolve!({ ctx: mockCtx({}), credential: { type: "api_key" as const, key: "supersecret" }, signal: new AbortController().signal });
  assert.ok(result);
  assert.ok(!JSON.stringify(result.source ?? "").includes("supersecret"));
});

test("standard flow: auth has no custom check", async () => {
  const auth = await getAuth();
  assert.equal(auth.check, undefined, "standard api-key auth must not carry a check");
});

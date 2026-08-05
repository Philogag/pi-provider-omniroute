import { test } from "node:test";
import assert from "node:assert/strict";
import type { AuthInteraction, AuthPrompt } from "@earendil-works/pi-ai";

function mockInteraction(answers: Array<string | Error>): AuthInteraction {
  const calls: AuthPrompt[] = [];
  return {
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
  } as AuthInteraction & { calls: AuthPrompt[] };
}

async function getAuth() {
  const mod = await import("../src/auth.ts");
  return mod.omnirouteApiKeyAuth();
}

test("login: returns credential with key and env.OMNIROUTE_BASE_URL on success", async () => {
  const auth = await getAuth();
  const interaction = mockInteraction(["my-key", "https://router.example.com/v1"]);
  const cred = await auth.login!(interaction);
  assert.equal(cred.type, "api_key");
  if (cred.type !== "api_key") throw new Error("narrow");
  assert.equal(cred.key, "my-key");
  assert.equal(cred.env?.OMNIROUTE_BASE_URL, "https://router.example.com/v1");
});

test("login: prompts twice — secret for key, text for baseUrl", async () => {
  const auth = await getAuth();
  const interaction = mockInteraction(["k", "http://localhost:20128/v1"]);
  await auth.login!(interaction);
  assert.equal((interaction as unknown as { calls: AuthPrompt[] }).calls.length, 2);
  assert.equal((interaction as unknown as { calls: AuthPrompt[] }).calls[0].type, "secret");
  assert.equal((interaction as unknown as { calls: AuthPrompt[] }).calls[1].type, "text");
});

test("login: retries once on invalid baseUrl, then succeeds", async () => {
  const auth = await getAuth();
  const interaction = mockInteraction(["k", "not-a-url", "https://ok.com/v1"]);
  const cred = await auth.login!(interaction);
  if (cred.type !== "api_key") throw new Error("narrow");
  assert.equal(cred.env?.OMNIROUTE_BASE_URL, "https://ok.com/v1");
  assert.equal((interaction as unknown as { calls: AuthPrompt[] }).calls.length, 3);
});

test("login: throws after MAX_URL_RETRIES (1) on persistently invalid URL", async () => {
  const auth = await getAuth();
  const interaction = mockInteraction(["k", "bad-1", "bad-2"]);
  await assert.rejects(auth.login!(interaction), /Invalid base URL/);
});

test("login: empty baseUrl input falls back to default", async () => {
  const auth = await getAuth();
  const interaction = mockInteraction(["k", ""]);
  const cred = await auth.login!(interaction);
  if (cred.type !== "api_key") throw new Error("narrow");
  assert.equal(cred.env?.OMNIROUTE_BASE_URL, "http://localhost:20128/v1");
});

test("login: propagates cancel error from interaction.prompt", async () => {
  const auth = await getAuth();
  const cancelError = new Error("cancelled");
  const interaction = mockInteraction([cancelError]);
  await assert.rejects(auth.login!(interaction), /cancelled/);
});

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

test("resolve: stored credential with both key and baseUrl", async () => {
  const auth = await getAuth();
  const ctx = mockCtx({ OMNIROUTE_API_KEY: "env-key", OMNIROUTE_BASE_URL: "https://env/v1" });
  const credential = { type: "api_key" as const, key: "stored-key", env: { OMNIROUTE_BASE_URL: "https://stored/v1" } };
  const result = await auth.resolve!({ ctx, credential });
  assert.deepEqual(result, {
    auth: { apiKey: "stored-key", baseUrl: "https://stored/v1" },
    env: { OMNIROUTE_BASE_URL: "https://stored/v1" },
    source: "stored credential",
  });
});

test("resolve: stored credential with key only, no env", async () => {
  const auth = await getAuth();
  const ctx = mockCtx({});
  const credential = { type: "api_key" as const, key: "stored-key" };
  const result = await auth.resolve!({ ctx, credential });
  assert.deepEqual(result, {
    auth: { apiKey: "stored-key" },
    env: undefined,
    source: "stored credential",
  });
});

test("resolve: ambient env with both key and baseUrl", async () => {
  const auth = await getAuth();
  const ctx = mockCtx({ OMNIROUTE_API_KEY: "env-key", OMNIROUTE_BASE_URL: "https://env/v1" });
  const result = await auth.resolve!({ ctx, credential: undefined });
  assert.deepEqual(result, {
    auth: { apiKey: "env-key", baseUrl: "https://env/v1" },
    env: { OMNIROUTE_BASE_URL: "https://env/v1" },
    source: "OMNIROUTE_API_KEY",
  });
});

test("resolve: ambient env with key only", async () => {
  const auth = await getAuth();
  const ctx = mockCtx({ OMNIROUTE_API_KEY: "env-key" });
  const result = await auth.resolve!({ ctx, credential: undefined });
  assert.deepEqual(result, {
    auth: { apiKey: "env-key" },
    env: undefined,
    source: "OMNIROUTE_API_KEY",
  });
});

test("resolve: no credential and no env returns undefined", async () => {
  const auth = await getAuth();
  const ctx = mockCtx({});
  const result = await auth.resolve!({ ctx, credential: undefined });
  assert.equal(result, undefined);
});

test("resolve: stored credential wins over ambient env", async () => {
  const auth = await getAuth();
  const ctx = mockCtx({ OMNIROUTE_API_KEY: "env-key", OMNIROUTE_BASE_URL: "https://env/v1" });
  const credential = { type: "api_key" as const, key: "stored-key", env: { OMNIROUTE_BASE_URL: "https://stored/v1" } };
  const result = await auth.resolve!({ ctx, credential });
  assert.equal((result as { auth: { apiKey: string } }).auth.apiKey, "stored-key");
  assert.equal((result as { auth: { baseUrl?: string } }).auth.baseUrl, "https://stored/v1");
});

test("resolve: source field never contains the key value", async () => {
  const auth = await getAuth();
  const ctx = mockCtx({});
  const credential = { type: "api_key" as const, key: "supersecret", env: { OMNIROUTE_BASE_URL: "https://x/v1" } };
  const result = await auth.resolve!({ ctx, credential });
  assert.ok(result);
  assert.ok(!JSON.stringify(result.source ?? "").includes("supersecret"));
});

test("check: returns api_key check when stored credential has key", async () => {
  const auth = await getAuth();
  const ctx = mockCtx({});
  const credential = { type: "api_key" as const, key: "stored-key" };
  const result = await auth.check!({ ctx, credential });
  assert.deepEqual(result, { type: "api_key", source: "stored credential" });
});

test("check: returns api_key check when ambient env has key", async () => {
  const auth = await getAuth();
  const ctx = mockCtx({ OMNIROUTE_API_KEY: "env-key" });
  const result = await auth.check!({ ctx, credential: undefined });
  assert.deepEqual(result, { type: "api_key", source: "OMNIROUTE_API_KEY" });
});

test("check: returns undefined when no credential and no env", async () => {
  const auth = await getAuth();
  const ctx = mockCtx({});
  const result = await auth.check!({ ctx, credential: undefined });
  assert.equal(result, undefined);
});

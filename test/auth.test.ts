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
  const interaction = mockInteraction(["my-key", "https://router.example.com/api/v1"]);
  const cred = await auth.login!(interaction);
  assert.equal(cred.type, "api_key");
  if (cred.type !== "api_key") throw new Error("narrow");
  assert.equal(cred.key, "my-key");
  assert.equal(cred.env?.OMNIROUTE_BASE_URL, "https://router.example.com/api/v1");
});

test("login: prompts twice — secret for key, text for baseUrl", async () => {
  const auth = await getAuth();
  const interaction = mockInteraction(["k", "http://localhost:20128/api/v1"]);
  await auth.login!(interaction);
  assert.equal((interaction as unknown as { calls: AuthPrompt[] }).calls.length, 2);
  assert.equal((interaction as unknown as { calls: AuthPrompt[] }).calls[0].type, "secret");
  assert.equal((interaction as unknown as { calls: AuthPrompt[] }).calls[1].type, "text");
});

test("login: retries once on invalid baseUrl, then succeeds", async () => {
  const auth = await getAuth();
  const interaction = mockInteraction(["k", "not-a-url", "https://ok.com/api/v1"]);
  const cred = await auth.login!(interaction);
  if (cred.type !== "api_key") throw new Error("narrow");
  assert.equal(cred.env?.OMNIROUTE_BASE_URL, "https://ok.com/api/v1");
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
  assert.equal(cred.env?.OMNIROUTE_BASE_URL, "http://localhost:20128/api/v1");
});

test("login: propagates cancel error from interaction.prompt", async () => {
  const auth = await getAuth();
  const cancelError = new Error("cancelled");
  const interaction = mockInteraction([cancelError]);
  await assert.rejects(auth.login!(interaction), /cancelled/);
});

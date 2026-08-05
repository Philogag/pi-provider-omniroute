---
change: support-custom-baseurl-on-login
design-doc: openspec/changes/support-custom-baseurl-on-login/superpower-design.md
base-ref: b52c8b1d0372fb5c63716922e5c086f6ab072992
---

# Support Custom baseUrl on Login — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the legacy `pi.registerProvider("omniroute", {...})` with a full provider object whose `auth.apiKey.login` prompts for both an API key and a custom baseUrl, persists both into `auth.json`, and resolves them per-request. Backward-compatible with existing `OMNIROUTE_API_KEY` / `OMNIROUTE_BASE_URL` ambient env users.

**Architecture:** Literal provider object (llama.cpp-style) with `id`/`name`/`baseUrl`/`auth`/`getModels`/`refreshModels` passed to `pi.registerProvider(provider)`. Two new modules: `src/auth.ts` (`omnirouteApiKeyAuth()` + `validateAndNormalizeBaseUrl`) and `src/auth-credentials.ts` (sync `readCredential` / `resolveStoredBaseUrl`). Startup reads `auth.json` synchronously, then `tryRegisterModels` uses the resolved baseUrl. `refreshModels` resolves baseUrl fresh from credential on each call.

**Tech Stack:** Node ≥ 22, TypeScript (strip-types), `node --test`, `tsc --noEmit`, `@earendil-works/pi-coding-agent` (existing dep), no new runtime deps.

## Global Constraints

- Node ≥ 22.6 (project uses `type: module`; `--experimental-strip-types` for tests).
- TypeScript strict; `tsc --noEmit` must exit 0 before any task is marked done.
- No new runtime dependencies (no `vitest`/`jest`/`nock`).
- Backward compatibility: existing ambient-env users (`OMNIROUTE_API_KEY` only, or `OMNIROUTE_API_KEY` + `OMNIROUTE_BASE_URL`) must see zero behavior change.
- API key value must never appear in `console.warn` / `console.log` output or in `auth.json` field names.
- All paths in `console.warn` messages are absolute.
- Commit messages follow `<type>(scope): <subject>` with types `test` / `feat` / `chore` / `refactor`.

---

## File Structure

After all tasks complete, the repository tree under `src/` and `test/` will be:

```
src/
├── index.ts                   # extension entry; reads credential, registers provider, calls tryRegisterModels
├── auth.ts                    # omnirouteApiKeyAuth(), OMNIROUTE_DEFAULT_BASE_URL, validateAndNormalizeBaseUrl
├── auth-credentials.ts        # resolveAuthJsonPath, readCredential, resolveStoredBaseUrl
test/
├── url.test.ts                # validateAndNormalizeBaseUrl pure-function tests
├── auth-credentials.test.ts   # readCredential edge cases (mocked node:fs)
├── auth.test.ts               # omnirouteApiKeyAuth() login + resolve + check tests
```

`src/index.ts` keeps the existing `MODEL_DEFAULTS` constant and `tryRegisterModels` function, but `tryRegisterModels` no longer re-registers the provider after success (5.6 decision: rely on `refreshModels`).

---

## Decisions Locked From Design Doc

These resolve the design doc's open questions; later tasks MUST follow them:

1. **Provider object form (D1 corrected):** Use a literal provider object passed to `pi.registerProvider(provider)`. Do NOT use `createProvider()` from `@earendil-works/pi-ai`. The literal-object pattern is what `@earendil-works/pi-coding-agent/dist/extensions/llama/provider.js` does and matches `Provider<TApi>` shape. This means:
   - `pi.registerProvider(provider)` — first arg is the full provider object, NOT a string ID.
   - `provider.getModels` is a method, not a property.
   - `provider.refreshModels` is a method accepting `RefreshModelsContext`.
   - `provider.api` field is a `ProviderStreams` (the return value of `openAICompletionsApi()` from `@earendil-works/pi-ai/compat`).
2. **Import paths:** `@earendil-works/pi-ai/compat` for `stream` / `streamSimple`; `@earendil-works/pi-ai` for `openAICompletionsApi` (or skip it — see below). `Provider`, `Model`, `ApiKeyAuth`, `AuthInteraction`, `AuthPrompt` from `@earendil-works/pi-ai`. `ExtensionAPI` from `@earendil-works/pi-coding-agent`.
3. **`tryRegisterModels` 5.6 decision:** Delete the `pi.registerProvider(provider, { models })` re-registration branch inside `tryRegisterModels`. After `tryRegisterModels` succeeds, models flow via the in-memory `models` array captured by `getModels` closure. The first successful startup registration still uses the array; subsequent `pi update --models` calls trigger `refreshModels`. **This is a small behavior change from Phase 1** (no immediate list update on startup) but matches the llama.cpp pattern and removes the partial-override ambiguity.
4. **`/v1` warning (5.3):** `validateAndNormalizeBaseUrl` calls `console.warn` if the URL doesn't end with `/v1` or `/v1/`. Non-fatal; user can ignore if their setup is intentional.
5. **`interaction.prompt` secret empty key (5.1):** Pass through whatever the interaction returns. If the user provides empty key, `credential.key === ""` and `resolve()` falls through to ambient env. This is graceful degradation, not an error.
6. **`readCredential` path resolution:** `process.env.PI_AGENT_DIR` if set, else `~/.pi/agent/auth.json`.

---

## Task Decomposition

Tasks are ordered to keep each independently testable. Tasks 1–4 build the credential reader (small, isolated, fully tested). Tasks 5–8 build the auth provider (depends on credential reader only in Task 9). Task 9 rewrites `src/index.ts` (the integration point).

---

### Task 1: Add `test` and `typecheck` scripts to package.json

**Files:**
- Modify: `package.json:7-10` (the `scripts` block)

**Context (background only, do not re-read in implementation):**
- Node 22 is available; `node --experimental-strip-types` works (verified in pre-plan check).
- `--test` discovers files matching `test/**/*.test.{ts,js}` by default.
- The existing `test` script is a no-op (`echo "Error: no test specified" && exit 1`) — replace it.

**Interfaces:**
- Consumes: nothing (no prior code).
- Produces: `npm test` runs `node --test --experimental-strip-types test/`. `npm run typecheck` runs `tsc --noEmit`.

- [ ] **Step 1: Replace the test script and add typecheck**

Edit `package.json` scripts block to:

```json
"scripts": {
  "test": "node --test --experimental-strip-types test/",
  "typecheck": "tsc --noEmit"
}
```

- [ ] **Step 2: Verify the test command runs (no tests yet, should report "no tests" cleanly)**

Run: `npm test 2>&1 | tail -20`
Expected: output ends with something like `# tests 0` / `# pass 0` / `# fail 0` (Node's `--test` summary). If Node complains about a missing `test/` directory, that's fine — note it; Task 2 creates the directory.

- [ ] **Step 3: Verify typecheck command exists**

Run: `npm run typecheck 2>&1 | tail -10`
Expected: exits 0 (no TS errors yet because no source files). If `tsc` isn't installed, the command will fail; install with `npx -y typescript@5 --version` first as a smoke test, but do not add it as a devDep yet (project may rely on `@earendil-works/pi-coding-agent`'s bundled `tsc`).

If `tsc` is not on PATH, run via npx: `npx -y -p typescript@5 tsc --noEmit` and document in commit message. If the project has no `tsconfig.json`, create one in Task 2.

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "chore(scripts): add test (node --test) and typecheck (tsc --noEmit)"
```

---

### Task 2: Add minimal tsconfig.json and create test/ directory

**Files:**
- Create: `tsconfig.json`
- Create: `test/.gitkeep` (or any throwaway file so `node --test test/` does not error)

**Context:**
- TypeScript needs a config to know about `node` types and ESM modules.
- The project uses `"type": "module"` so all imports must use `.js` extensions even in `.ts` files (NodeNext resolution).

**Interfaces:**
- Consumes: `package.json` `type: "module"`.
- Produces: `tsc --noEmit` succeeds against any future `src/*.ts` files using `.js` extension imports.

- [ ] **Step 1: Create `tsconfig.json`**

Write `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true,
    "isolatedModules": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

If a `tsconfig.json` already exists, skip and adapt (preserve any existing options; add `module: "NodeNext"`, `moduleResolution: "NodeNext"`, `types: ["node"]`).

- [ ] **Step 2: Install `@types/node` if not present**

Run: `node -e "require('child_process').execSync('npm install --save-dev @types/node@22', { stdio: 'inherit' })"`
Expected: package.json gains `"@types/node"` in `devDependencies`. (Skip this step if `@types/node` is already in `package.json`.)

- [ ] **Step 3: Create `test/` directory and a placeholder test file**

Run: `mkdir -p test && echo 'export {};' > test/.placeholder.ts`
Expected: directory exists.

- [ ] **Step 4: Verify `tsc --noEmit` exits 0**

Run: `npm run typecheck`
Expected: no output, exit 0.

- [ ] **Step 5: Verify `node --test` runs the empty test directory**

Run: `npm test 2>&1 | tail -10`
Expected: `# tests 0` summary or similar (no files match the `*.test.ts` glob yet).

- [ ] **Step 6: Remove placeholder; commit**

```bash
rm test/.placeholder.ts
git add tsconfig.json package.json package-lock.json test/.gitkeep
git commit -m "chore(tsconfig): add NodeNext config + @types/node for ESM source"
```

(The `.gitkeep` keeps the empty `test/` directory in git until Task 3 creates real files. Optional — you may delete `.gitkeep` once Task 3 lands.)

---

### Task 3: `validateAndNormalizeBaseUrl` (TDD) — `src/auth.ts` + `test/url.test.ts`

**Files:**
- Create: `src/auth.ts`
- Create: `test/url.test.ts`

**Context:**
- This is the pure validation function used by both `login` (with retry) and (optionally) startup-time validation.
- No Node imports needed; pure function.
- Exports: `OMNIROUTE_DEFAULT_BASE_URL` (constant), `validateAndNormalizeBaseUrl(input: string): string`.

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `validateAndNormalizeBaseUrl("")` → `OMNIROUTE_DEFAULT_BASE_URL` ("http://localhost:20128/api/v1")
  - `validateAndNormalizeBaseUrl(validUrl)` → trimmed input
  - `validateAndNormalizeBaseUrl(invalid)` → throws `Error`
  - Side effect: `console.warn` if URL doesn't end with `/v1` or `/v1/`

- [ ] **Step 1: Write the failing test**

Create `test/url.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { OMNIROUTE_DEFAULT_BASE_URL, validateAndNormalizeBaseUrl } from "../src/auth.ts";

test("validateAndNormalizeBaseUrl: empty string returns default", () => {
  assert.equal(validateAndNormalizeBaseUrl(""), OMNIROUTE_DEFAULT_BASE_URL);
});

test("validateAndNormalizeBaseUrl: whitespace-only returns default", () => {
  assert.equal(validateAndNormalizeBaseUrl("   "), OMNIROUTE_DEFAULT_BASE_URL);
});

test("validateAndNormalizeBaseUrl: valid http URL returned trimmed", () => {
  assert.equal(
    validateAndNormalizeBaseUrl("http://localhost:20128/api/v1"),
    "http://localhost:20128/api/v1",
  );
});

test("validateAndNormalizeBaseUrl: valid https URL returned as-is", () => {
  assert.equal(
    validateAndNormalizeBaseUrl("https://router.example.com/api/v1"),
    "https://router.example.com/api/v1",
  );
});

test("validateAndNormalizeBaseUrl: trailing slash preserved", () => {
  assert.equal(
    validateAndNormalizeBaseUrl("https://router.example.com/api/v1/"),
    "https://router.example.com/api/v1/",
  );
});

test("validateAndNormalizeBaseUrl: surrounding whitespace trimmed", () => {
  assert.equal(
    validateAndNormalizeBaseUrl("  https://router.example.com/api/v1  "),
    "https://router.example.com/api/v1",
  );
});

test("validateAndNormalizeBaseUrl: rejects missing protocol", () => {
  assert.throws(
    () => validateAndNormalizeBaseUrl("localhost:20128"),
    /Invalid base URL/,
  );
});

test("validateAndNormalizeBaseUrl: rejects non-http(s) protocol", () => {
  assert.throws(
    () => validateAndNormalizeBaseUrl("ftp://router.example.com"),
    /must use http\(s\)/,
  );
});

test("validateAndNormalizeBaseUrl: rejects missing hostname", () => {
  assert.throws(
    () => validateAndNormalizeBaseUrl("http://"),
    /missing hostname/,
  );
});

test("OMNIROUTE_DEFAULT_BASE_URL is http://localhost:20128/api/v1", () => {
  assert.equal(OMNIROUTE_DEFAULT_BASE_URL, "http://localhost:20128/api/v1");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test 2>&1 | tail -20`
Expected: FAIL with "Cannot find module '../src/auth.ts'" or similar import resolution error.

- [ ] **Step 3: Implement `src/auth.ts`**

Create `src/auth.ts`:

```typescript
/**
 * Pure URL validation/normalization for OmniRoute baseUrl values.
 * Used at /login time (with retry) and conceptually reusable at startup.
 */

export const OMNIROUTE_DEFAULT_BASE_URL = "http://localhost:20128/api/v1";

export function validateAndNormalizeBaseUrl(input: string): string {
  const trimmed = input.trim();
  if (trimmed === "") return OMNIROUTE_DEFAULT_BASE_URL;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(`Invalid base URL: ${JSON.stringify(input)}`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`base URL must use http(s): got ${url.protocol}`);
  }
  if (!url.hostname) {
    throw new Error(`base URL missing hostname: ${JSON.stringify(input)}`);
  }

  // Non-fatal warning when /v1 path segment is missing — chat calls may 404.
  if (!/\/v1\/?$/.test(url.pathname)) {
    console.warn(
      `[omniroute] base URL ${JSON.stringify(trimmed)} does not end with /v1 — chat calls may 404`,
    );
  }

  return trimmed;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test 2>&1 | tail -15`
Expected: `# tests 10` / `# pass 10` / `# fail 0`.

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: exit 0, no output.

- [ ] **Step 6: Commit**

```bash
git add src/auth.ts test/url.test.ts
git commit -m "test(auth): cover validateAndNormalizeBaseUrl edge cases"
```

---

### Task 4: `readCredential` (TDD) — `src/auth-credentials.ts` + `test/auth-credentials.test.ts`

**Files:**
- Create: `src/auth-credentials.ts`
- Create: `test/auth-credentials.test.ts`

**Context:**
- Synchronous read of `~/.pi/agent/auth.json` (or `$PI_AGENT_DIR/auth.json`).
- Never throws. Returns `undefined` for any failure (ENOENT, EACCES, malformed JSON, missing `omniroute` key).
- Used at startup by `tryRegisterModels` to pick the right baseUrl.
- Test strategy: stub `process.env.HOME` / `process.env.PI_AGENT_DIR` and intercept `node:fs.readFileSync` via a `Mock` using `node:fs/promises` or by reading from a `test/fixtures/` directory.

**Decision (locked from design 5.4 + 5.5):** Use real temp files via `node:os.tmpdir()` + `node:fs.mkdtempSync`, set `process.env.PI_AGENT_DIR` to the temp dir, and read real files. This avoids fragile fs mocking.

**Interfaces:**
- Consumes: `process.env.PI_AGENT_DIR`, `process.env.HOME` (fallback).
- Produces:
  - `resolveAuthJsonPath(): string` — returns full path to `auth.json`.
  - `readCredential(): StoredCredential | undefined` — returns `{ type?, key?, env? }` for the `omniroute` entry, or `undefined`.
  - `resolveStoredBaseUrl(): string | undefined` — convenience for `cred?.env?.OMNIROUTE_BASE_URL`.

- [ ] **Step 1: Write the failing test**

Create `test/auth-credentials.test.ts`:

```typescript
import { test, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ORIGINAL_PI_AGENT_DIR = process.env.PI_AGENT_DIR;
let tmpDir: string | undefined;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "omniroute-test-"));
  process.env.PI_AGENT_DIR = tmpDir;
});

afterEach(() => {
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  tmpDir = undefined;
  if (ORIGINAL_PI_AGENT_DIR === undefined) delete process.env.PI_AGENT_DIR;
  else process.env.PI_AGENT_DIR = ORIGINAL_PI_AGENT_DIR;
});

test("readCredential: returns undefined when auth.json does not exist", async () => {
  const { readCredential } = await import("../src/auth-credentials.ts");
  assert.equal(readCredential(), undefined);
});

test("readCredential: returns undefined for malformed JSON, warns once", async () => {
  writeFileSync(join(tmpDir!, "auth.json"), "not json {");
  const { readCredential } = await import("../src/auth-credentials.ts");
  assert.equal(readCredential(), undefined);
});

test("readCredential: returns undefined when no omniroute key", async () => {
  writeFileSync(join(tmpDir!, "auth.json"), JSON.stringify({ anthropic: { key: "x" } }));
  const { readCredential } = await import("../src/auth-credentials.ts");
  assert.equal(readCredential(), undefined);
});

test("readCredential: returns omniroute entry with env", async () => {
  const cred = { type: "api_key", key: "abc", env: { OMNIROUTE_BASE_URL: "https://x/api/v1" } };
  writeFileSync(join(tmpDir!, "auth.json"), JSON.stringify({ omniroute: cred }));
  const { readCredential } = await import("../src/auth-credentials.ts");
  assert.deepEqual(readCredential(), cred);
});

test("resolveStoredBaseUrl: returns baseUrl from credential env", async () => {
  const cred = { type: "api_key", key: "abc", env: { OMNIROUTE_BASE_URL: "https://x/api/v1" } };
  writeFileSync(join(tmpDir!, "auth.json"), JSON.stringify({ omniroute: cred }));
  const { resolveStoredBaseUrl } = await import("../src/auth-credentials.ts");
  assert.equal(resolveStoredBaseUrl(), "https://x/api/v1");
});

test("resolveStoredBaseUrl: returns undefined when env missing", async () => {
  writeFileSync(
    join(tmpDir!, "auth.json"),
    JSON.stringify({ omniroute: { type: "api_key", key: "abc" } }),
  );
  const { resolveStoredBaseUrl } = await import("../src/auth-credentials.ts");
  assert.equal(resolveStoredBaseUrl(), undefined);
});

test("resolveAuthJsonPath: uses PI_AGENT_DIR when set", async () => {
  const { resolveAuthJsonPath } = await import("../src/auth-credentials.ts");
  assert.equal(resolveAuthJsonPath(), join(tmpDir!, "auth.json"));
});
```

Note the dynamic `await import("../src/auth-credentials.ts")` pattern: each test imports the module fresh so the `process.env.PI_AGENT_DIR` read inside `resolveAuthJsonPath()` is re-evaluated. If the module caches the path, the test may pass for the wrong reason. To avoid this, keep `resolveAuthJsonPath` as a thin function called at each `readCredential` invocation (not at module load).

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test 2>&1 | tail -20`
Expected: FAIL with import error on `../src/auth-credentials.ts`.

- [ ] **Step 3: Implement `src/auth-credentials.ts`**

Create `src/auth-credentials.ts`:

```typescript
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface StoredCredential {
  type?: string;
  key?: string;
  env?: Record<string, string>;
}

export function resolveAuthJsonPath(): string {
  const fromEnv = process.env.PI_AGENT_DIR;
  if (fromEnv) return join(fromEnv, "auth.json");
  return join(homedir(), ".pi", "agent", "auth.json");
}

export function readCredential(): StoredCredential | undefined {
  const path = resolveAuthJsonPath();
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    console.warn(
      `[omniroute] failed to read auth.json at ${path}: ${(err as Error).message}`,
    );
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.warn(
      `[omniroute] auth.json at ${path} is malformed JSON: ${(err as Error).message}`,
    );
    return undefined;
  }
  if (!parsed || typeof parsed !== "object") return undefined;
  const cred = (parsed as Record<string, unknown>)["omniroute"];
  if (!cred || typeof cred !== "object") return undefined;
  return cred as StoredCredential;
}

export function resolveStoredBaseUrl(): string | undefined {
  const cred = readCredential();
  if (!cred) return undefined;
  return cred.env?.OMNIROUTE_BASE_URL;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test 2>&1 | tail -15`
Expected: `# tests 17` (10 url + 7 credential), `# pass 17`, `# fail 0`.

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/auth-credentials.ts test/auth-credentials.test.ts
git commit -m "test(credentials): cover readCredential edge cases via temp dirs"
```

---

### Task 5: `omnirouteApiKeyAuth.login` (TDD partial) — `src/auth.ts` extension + `test/auth.test.ts`

**Files:**
- Modify: `src/auth.ts` (append `omnirouteApiKeyAuth`)
- Create: `test/auth.test.ts`

**Context:**
- `omnirouteApiKeyAuth()` returns an `ApiKeyAuth` object. Task 5 covers only the `login` callback; Tasks 6 and 7 add `resolve` and `check`.
- `login` calls `interaction.prompt` twice: first for key, then for baseUrl.
- baseUrl prompt uses `validateAndNormalizeBaseUrl` with up to 1 retry.

**Interfaces:**
- Consumes: `interaction: AuthInteraction` (pi-ai type).
- Produces: `omnirouteApiKeyAuth(): ApiKeyAuth` (partial: `name` + `login` only; `resolve` and `check` added in Tasks 6/7).

- [ ] **Step 1: Write the failing test for `login`**

Create `test/auth.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test 2>&1 | tail -20`
Expected: FAIL — `omnirouteApiKeyAuth` is not exported (Task 3's `src/auth.ts` doesn't include it).

- [ ] **Step 3: Append `omnirouteApiKeyAuth` to `src/auth.ts`**

Append to `src/auth.ts`:

```typescript
import type { ApiKeyAuth, AuthInteraction, AuthPrompt } from "@earendil-works/pi-ai";

const MAX_URL_RETRIES = 1;

async function promptBaseUrlWithRetry(
  interaction: AuthInteraction,
  defaultUrl: string,
): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_URL_RETRIES; attempt++) {
    const raw = await interaction.prompt({
      type: "text",
      message: `Enter OmniRoute base URL (default: ${defaultUrl})`,
      placeholder: defaultUrl,
    });
    try {
      return validateAndNormalizeBaseUrl(raw);
    } catch (err) {
      lastError = err;
      if (attempt === MAX_URL_RETRIES) throw err;
    }
  }
  /* c8 ignore next */
  throw lastError instanceof Error ? lastError : new Error("unreachable");
}

export function omnirouteApiKeyAuth(): ApiKeyAuth {
  return {
    name: "OmniRoute API key",
    login: async (interaction) => {
      const key = await interaction.prompt({
        type: "secret",
        message: "Enter OmniRoute API key",
      });
      const baseUrl = await promptBaseUrlWithRetry(
        interaction,
        OMNIROUTE_DEFAULT_BASE_URL,
      );
      return {
        type: "api_key",
        key,
        env: { OMNIROUTE_BASE_URL: baseUrl },
      };
    },
    // resolve: see Task 6
    // check: see Task 7
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test 2>&1 | tail -15`
Expected: `# tests 23` (10 + 7 + 6), `# pass 23`, `# fail 0`.

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/auth.ts test/auth.test.ts
git commit -m "feat(auth): implement omnirouteApiKeyAuth.login with URL retry"
```

---

### Task 6: `omnirouteApiKeyAuth.resolve` (TDD)

**Files:**
- Modify: `src/auth.ts` (add `resolve` callback)
- Modify: `test/auth.test.ts` (add resolve tests)

**Context:**
- Priority: stored credential (key + env.OMNIROUTE_BASE_URL) > ambient env (OMNIROUTE_API_KEY + OMNIROUTE_BASE_URL) > undefined.
- `credential.env` may or may not contain `OMNIROUTE_BASE_URL`; if missing, `auth.baseUrl` is omitted and the request falls back to the provider-level `baseUrl`.

**Interfaces:**
- `resolve({ ctx, credential })`:
  - `ctx.env(name)` returns `string | undefined`.
  - `credential: { key?, env? } | undefined`.
- Returns `AuthResult | undefined`:
  - `auth.apiKey: string`
  - `auth.baseUrl?: string`
  - `env?: ProviderEnv`
  - `source?: string` (no key in source)

- [ ] **Step 1: Add failing tests for `resolve` to `test/auth.test.ts`**

Append to `test/auth.test.ts`:

```typescript
function mockCtx(envValues: Record<string, string | undefined>) {
  return {
    async env(name: string): Promise<string | undefined> {
      return envValues[name];
    },
  };
}

test("resolve: stored credential with both key and baseUrl", async () => {
  const auth = await getAuth();
  const ctx = mockCtx({ OMNIROUTE_API_KEY: "env-key", OMNIROUTE_BASE_URL: "https://env/api/v1" });
  const credential = { type: "api_key" as const, key: "stored-key", env: { OMNIROUTE_BASE_URL: "https://stored/api/v1" } };
  const result = await auth.resolve!({ ctx, credential });
  assert.deepEqual(result, {
    auth: { apiKey: "stored-key", baseUrl: "https://stored/api/v1" },
    env: { OMNIROUTE_BASE_URL: "https://stored/api/v1" },
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
  const ctx = mockCtx({ OMNIROUTE_API_KEY: "env-key", OMNIROUTE_BASE_URL: "https://env/api/v1" });
  const result = await auth.resolve!({ ctx, credential: undefined });
  assert.deepEqual(result, {
    auth: { apiKey: "env-key", baseUrl: "https://env/api/v1" },
    env: { OMNIROUTE_BASE_URL: "https://env/api/v1" },
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
  const ctx = mockCtx({ OMNIROUTE_API_KEY: "env-key", OMNIROUTE_BASE_URL: "https://env/api/v1" });
  const credential = { type: "api_key" as const, key: "stored-key", env: { OMNIROUTE_BASE_URL: "https://stored/api/v1" } };
  const result = await auth.resolve!({ ctx, credential });
  assert.equal((result as { auth: { apiKey: string } }).auth.apiKey, "stored-key");
  assert.equal((result as { auth: { baseUrl?: string } }).auth.baseUrl, "https://stored/api/v1");
});

test("resolve: source field never contains the key value", async () => {
  const auth = await getAuth();
  const ctx = mockCtx({});
  const credential = { type: "api_key" as const, key: "supersecret", env: { OMNIROUTE_BASE_URL: "https://x/api/v1" } };
  const result = await auth.resolve!({ ctx, credential });
  assert.ok(result);
  assert.ok(!JSON.stringify(result.source ?? "").includes("supersecret"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test 2>&1 | tail -20`
Expected: FAIL with "auth.resolve is not a function".

- [ ] **Step 3: Add `resolve` to `omnirouteApiKeyAuth` in `src/auth.ts`**

Edit the `omnirouteApiKeyAuth` function in `src/auth.ts` — replace the trailing `// resolve: see Task 6` comment with the `resolve` callback. The complete function body:

```typescript
export function omnirouteApiKeyAuth(): ApiKeyAuth {
  return {
    name: "OmniRoute API key",
    login: async (interaction) => {
      const key = await interaction.prompt({
        type: "secret",
        message: "Enter OmniRoute API key",
      });
      const baseUrl = await promptBaseUrlWithRetry(
        interaction,
        OMNIROUTE_DEFAULT_BASE_URL,
      );
      return {
        type: "api_key",
        key,
        env: { OMNIROUTE_BASE_URL: baseUrl },
      };
    },
    resolve: async ({ ctx, credential }) => {
      if (credential?.key) {
        const baseUrl = credential.env?.OMNIROUTE_BASE_URL;
        return {
          auth: { apiKey: credential.key, ...(baseUrl ? { baseUrl } : {}) },
          env: credential.env,
          source: "stored credential",
        };
      }
      const envKey = await ctx.env("OMNIROUTE_API_KEY");
      const envBase = await ctx.env("OMNIROUTE_BASE_URL");
      if (envKey) {
        return {
          auth: { apiKey: envKey, ...(envBase ? { baseUrl: envBase } : {}) },
          env: envBase ? { OMNIROUTE_BASE_URL: envBase } : undefined,
          source: "OMNIROUTE_API_KEY",
        };
      }
      return undefined;
    },
    // check: see Task 7
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test 2>&1 | tail -15`
Expected: `# tests 30` (10 + 7 + 6 + 7), `# pass 30`, `# fail 0`.

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/auth.ts test/auth.test.ts
git commit -m "feat(auth): implement omnirouteApiKeyAuth.resolve with stored>env priority"
```

---

### Task 7: `omnirouteApiKeyAuth.check` (TDD)

**Files:**
- Modify: `src/auth.ts` (add `check` callback)
- Modify: `test/auth.test.ts` (add check tests)

**Context:**
- `check` is a side-effect-free availability check used by pi for status UI; the design doc didn't mandate it, but the llama.cpp reference uses it and our `tryRegisterModels` already does a network probe at startup, so `check` returning the right "yes/no" without network I/O is cheap and informative.
- Returns `AuthCheck | undefined`:
  - `type: "api_key"`, `source: "stored credential" | "OMNIROUTE_API_KEY"`.
  - `undefined` when no credential and no env.

**Interfaces:**
- `check({ ctx, credential })` — same shape as `resolve`'s input.

- [ ] **Step 1: Add failing tests to `test/auth.test.ts`**

Append:

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test 2>&1 | tail -15`
Expected: FAIL — `auth.check` is not a function.

- [ ] **Step 3: Add `check` to `omnirouteApiKeyAuth` in `src/auth.ts`**

Replace the trailing `// check: see Task 7` comment with:

```typescript
    check: async ({ ctx, credential }) => {
      if (credential?.key) {
        return { type: "api_key", source: "stored credential" };
      }
      const envKey = await ctx.env("OMNIROUTE_API_KEY");
      if (envKey) {
        return { type: "api_key", source: "OMNIROUTE_API_KEY" };
      }
      return undefined;
    },
```

The final function body (Task 5 + Task 6 + Task 7) closes with `};` after `check`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test 2>&1 | tail -15`
Expected: `# tests 33` (10 + 7 + 6 + 7 + 3), `# pass 33`, `# fail 0`.

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/auth.ts test/auth.test.ts
git commit -m "feat(auth): add check callback for pi status UI"
```

---

### Task 8: Wire `createProvider`-equivalent literal provider object — `src/index.ts` rewrite

**Files:**
- Modify: `src/index.ts` (full rewrite)

**Context:**
- Per Decision #1, we use a literal provider object (llama.cpp pattern) rather than `createProvider()`.
- Existing file has `MODEL_DEFAULTS`, `tryRegisterModels`. Preserve `tryRegisterModels` but remove its `pi.registerProvider` re-registration branch.
- New imports: `openAICompletionsApi` from `@earendil-works/pi-ai`; `Provider`, `Model` (api `openai-completions`), `AuthContext` etc. from `@earendil-works/pi-ai`; `ExtensionAPI` from `@earendil-works/pi-coding-agent`.
- `provider.api` must be the value returned by `openAICompletionsApi()`. Verify the import path: in the installed pi-ai 0.83.0, `openAICompletionsApi` is exported from `@earendil-works/pi-ai/dist/api/openai-completions.lazy` but the top-level `@earendil-works/pi-ai` re-export may not include it. Fallback: use a plain `api: "openai-completions" as const` string and let the legacy pi-ai path handle it. (The design doc 5.4 already flagged this.)

**Step 0 — verify import path before writing the file:**

Run: `grep -l "openAICompletionsApi" /home/yuhr/workspace/self/pi-provider-omniroute/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/index.d.ts 2>/dev/null && echo "EXPORTED" || echo "NOT-EXPORTED"`

If `EXPORTED`, use `import { openAICompletionsApi } from "@earendil-works/pi-ai"`. If `NOT-EXPORTED`, use `import { openAICompletionsApi } from "@earendil-works/pi-ai/dist/api/openai-completions.lazy.js"` (subpath import is allowed by pi-ai's `package.json` exports).

**Interfaces:**
- Consumes: `omnirouteApiKeyAuth()` (Task 5–7), `resolveStoredBaseUrl()` (Task 4).
- Produces: `default export async function(pi: ExtensionAPI)` that:
  1. Reads stored baseUrl from `auth.json` (or falls back to `OMNIROUTE_BASE_URL` env, or `OMNIROUTE_DEFAULT_BASE_URL`).
  2. Builds a literal provider object with `id: "omniroute"`, `name: "OmniRoute"`, `baseUrl`, `auth: { apiKey: omnirouteApiKeyAuth() }`, `getModels`, `refreshModels`, `api: openAICompletionsApi()`.
  3. `pi.registerProvider(provider)`.
  4. `await tryRegisterModels(resolvedBaseUrl, pi)`.

- [ ] **Step 1: Write the new `src/index.ts`**

Replace the entire contents of `src/index.ts` with:

```typescript
// src/index.ts — pi extension entry
import type { ExtensionAPI, ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import type { Provider, Model } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai";
import { omnirouteApiKeyAuth, OMNIROUTE_DEFAULT_BASE_URL } from "./auth.ts";
import { resolveStoredBaseUrl } from "./auth-credentials.ts";

type OmnirouteModel = Model<"openai-completions">;

const MODEL_DEFAULTS: Omit<ProviderModelConfig, "id" | "name"> = {
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128000,
  maxTokens: 4096,
};

export default async function (pi: ExtensionAPI) {
  const storedBaseUrl = resolveStoredBaseUrl();
  const baseUrl = storedBaseUrl ?? process.env.OMNIROUTE_BASE_URL ?? OMNIROUTE_DEFAULT_BASE_URL;

  let models: OmnirouteModel[] = [];

  const provider: Provider<"openai-completions"> = {
    id: "omniroute",
    name: "OmniRoute",
    baseUrl,
    auth: { apiKey: omnirouteApiKeyAuth() },
    api: openAICompletionsApi(),
    getModels: () => models,
    async refreshModels({ signal }) {
      const res = await fetch(`${baseUrl}/models`, { signal });
      if (!res.ok) throw new Error(`OmniRoute /models failed: ${res.status}`);
      const { data } = (await res.json()) as { data: Array<{ id: string }> };
      models = data.map(
        (m): OmnirouteModel => ({
          id: m.id,
          name: m.id,
          api: "openai-completions",
          provider: "omniroute",
          baseUrl,
          ...MODEL_DEFAULTS,
        }),
      );
    },
  };

  pi.registerProvider(provider);

  await tryRegisterModels(baseUrl, pi);
}

async function tryRegisterModels(baseUrl: string, pi: ExtensionAPI): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(`${baseUrl}/models`, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { data } = (await res.json()) as { data: Array<{ id: string }> };
    // Mutate the closure-captured models array so getModels() reflects the new list.
    // No pi.registerProvider re-registration needed (5.6 decision).
    const fresh = data.map(
      (m): OmnirouteModel => ({
        id: m.id,
        name: m.id,
        api: "openai-completions",
        provider: "omniroute",
        baseUrl,
        ...MODEL_DEFAULTS,
      }),
    );
    // Reach into the provider via a local re-assignment; see note below.
    setProviderModels(pi, fresh);
  } catch (err) {
    clearTimeout(timeout);
    console.warn(
      `[omniroute] OmniRoute unavailable at ${baseUrl}, skipping model registration: ${err}`,
    );
  }
}

/**
 * Replace the models list of the already-registered "omniroute" provider by
 * re-registering with the same id. The Models layer accepts re-registration
 * to replace the dynamic catalog.
 */
function setProviderModels(pi: ExtensionAPI, models: OmnirouteModel[]): void {
  // The Models layer caches models internally; re-registration with the
  // existing provider is the supported way to replace them.
  // We rebuild a minimal provider with the same id and the new models.
  pi.registerProvider({
    id: "omniroute",
    name: "OmniRoute",
    baseUrl: process.env.OMNIROUTE_BASE_URL ?? OMNIROUTE_DEFAULT_BASE_URL,
    auth: { apiKey: omnirouteApiKeyAuth() },
    api: openAICompletionsApi(),
    getModels: () => models,
  } as Provider<"openai-completions">);
}
```

**Why `setProviderModels` instead of mutating the closure:** the `pi.registerProvider(provider)` call stores the provider; the closure-mutated `models` array is only visible to `getModels` on the same provider instance. Re-registering with the same id is the only public way to swap `getModels` output. (5.6 trade-off: this is what the Phase 1 code did, and re-registration with the literal form does work per the llama.cpp pattern.)

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: exit 0.

If TS errors include "Property 'openAICompletionsApi' is not exported from @earendil-works/pi-ai", see Step 0 — switch the import path.

- [ ] **Step 3: Run tests to verify nothing regressed**

Run: `npm test 2>&1 | tail -15`
Expected: `# tests 33`, `# pass 33`, `# fail 0`.

- [ ] **Step 4: Manual smoke test — extension loads without errors**

Run: `npx -y tsx --eval "import('./src/index.ts').then(m => console.log('loaded:', typeof m.default))"`
Expected: prints `loaded: function`. If `tsx` isn't installed, use `node --experimental-strip-types --eval "import('./src/index.ts').then(m => console.log('loaded:', typeof m.default))"`.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts
git commit -m "refactor(index): use literal provider object with auth.apiKey"
```

---

### Task 9: Update `tasks.md` to reflect the new plan

**Files:**
- Modify: `openspec/changes/support-custom-baseurl-on-login/tasks.md`

**Context:**
- The OpenSpec `tasks.md` was written before the literal-provider decision. The 23 original tasks still apply conceptually but their numbering doesn't match the new 8-task plan. Update `tasks.md` to mirror this implementation plan's task structure so OpenSpec archive remains consistent with actual implementation.

**Interfaces:**
- Consumes: the 8 tasks above.
- Produces: a `tasks.md` whose task list, when checked off, indicates the full implementation is done.

- [ ] **Step 1: Replace `tasks.md` with a concise summary**

Replace the entire contents of `openspec/changes/support-custom-baseurl-on-login/tasks.md` with:

```markdown
## 1. Test infrastructure

- [ ] 1.1 Add `test` and `typecheck` scripts to `package.json`
- [ ] 1.2 Create `tsconfig.json` (NodeNext, strict, `@types/node`) and `test/` directory
- [ ] 1.3 Run `npm test` and `npm run typecheck` to confirm both succeed (no source/tests yet)

## 2. `validateAndNormalizeBaseUrl` (TDD)

- [ ] 2.1 Write `test/url.test.ts` covering 9 input cases (empty, whitespace, valid http/https, trailing slash, surrounding whitespace, missing protocol, non-http(s), missing hostname) plus the default constant assertion
- [ ] 2.2 Run `npm test` to confirm failure
- [ ] 2.3 Implement `validateAndNormalizeBaseUrl` and `OMNIROUTE_DEFAULT_BASE_URL` in `src/auth.ts`
- [ ] 2.4 Run `npm test` to confirm all 10 pass
- [ ] 2.5 Run `npm run typecheck` to confirm clean
- [ ] 2.6 Commit

## 3. `readCredential` (TDD)

- [ ] 3.1 Write `test/auth-credentials.test.ts` covering ENOENT, malformed JSON, missing `omniroute` key, valid credential, `resolveStoredBaseUrl` with/without env, `resolveAuthJsonPath` env override
- [ ] 3.2 Run `npm test` to confirm failure
- [ ] 3.3 Implement `resolveAuthJsonPath`, `readCredential`, `resolveStoredBaseUrl` in `src/auth-credentials.ts` (sync `readFileSync`, never throws, warns on non-ENOENT read errors)
- [ ] 3.4 Run `npm test` to confirm all 17 pass
- [ ] 3.5 Run `npm run typecheck` to confirm clean
- [ ] 3.6 Commit

## 4. `omnirouteApiKeyAuth.login` (TDD)

- [ ] 4.1 Write 6 tests in `test/auth.test.ts` for `login`: success path, prompt order, retry on invalid, retry exhausted, empty → default, cancel propagation
- [ ] 4.2 Run `npm test` to confirm failure
- [ ] 4.3 Add `omnirouteApiKeyAuth` with `name` + `login` (uses `promptBaseUrlWithRetry` with `MAX_URL_RETRIES = 1`) to `src/auth.ts`
- [ ] 4.4 Run `npm test` to confirm all 23 pass
- [ ] 4.5 Run `npm run typecheck` to confirm clean
- [ ] 4.6 Commit

## 5. `omnirouteApiKeyAuth.resolve` (TDD)

- [ ] 5.1 Add 7 tests in `test/auth.test.ts` for `resolve`: stored + baseUrl, stored key only, ambient + baseUrl, ambient key only, no-credential → undefined, stored wins over ambient, source never leaks key
- [ ] 5.2 Run `npm test` to confirm failure
- [ ] 5.3 Add `resolve` callback to `omnirouteApiKeyAuth` enforcing stored > ambient env > undefined priority
- [ ] 5.4 Run `npm test` to confirm all 30 pass
- [ ] 5.5 Run `npm run typecheck` to confirm clean
- [ ] 5.6 Commit

## 6. `omnirouteApiKeyAuth.check` (TDD)

- [ ] 6.1 Add 3 tests in `test/auth.test.ts` for `check`: stored has key → api_key check, ambient has key → api_key check, neither → undefined
- [ ] 6.2 Run `npm test` to confirm failure
- [ ] 6.3 Add `check` callback to `omnirouteApiKeyAuth`
- [ ] 6.4 Run `npm test` to confirm all 33 pass
- [ ] 6.5 Run `npm run typecheck` to confirm clean
- [ ] 6.6 Commit

## 7. Wire literal provider object into `src/index.ts`

- [ ] 7.1 Verify `openAICompletionsApi` export path; switch to subpath import if not in top-level
- [ ] 7.2 Replace `src/index.ts` with literal provider object passed to `pi.registerProvider(provider)`; resolve baseUrl from stored > env > default
- [ ] 7.3 Update `tryRegisterModels` to mutate the closure-captured `models` array (no re-registration)
- [ ] 7.4 Run `npm run typecheck` to confirm clean
- [ ] 7.5 Run `npm test` to confirm 33 still pass
- [ ] 7.6 Manual smoke: `node --experimental-strip-types --eval "import('./src/index.ts').then(m => console.log(typeof m.default))"` prints `function`
- [ ] 7.7 Commit

## 8. Final verification

- [ ] 8.1 `npm test` and `npm run typecheck` both succeed
- [ ] 8.2 `git log --oneline` shows 7 clean commits
- [ ] 8.3 No `pi.registerProvider("omniroute", {` legacy form remains in `src/`
- [ ] 8.4 No `OMNIROUTE_DASHBOARD_PASSWORD` / `OMNIROUTE_AUTH_TOKEN` / `OMNIROUTE_REQUIRE_LOGIN` references in `src/`
- [ ] 8.5 Update `openspec/changes/support-custom-baseurl-on-login/tasks.md` (Task 9) to mirror this plan
```

(Actually Step 9.1 rewrites this file; Task 9's steps are the rewrite itself, not a meta-task.)

- [ ] **Step 2: Commit**

```bash
git add openspec/changes/support-custom-baseurl-on-login/tasks.md
git commit -m "docs(openspec): align tasks.md with 8-task implementation plan"
```

---

## Self-Review (post-write)

**Spec coverage** (run after writing the plan, not as a code task):

| spec.md requirement | task |
|---|---|
| `/login omniroute` 收集 API key | Task 4 (`login` 回调) |
| `/login omniroute` 收集 baseUrl（4 个场景：custom、default、trailing slash、whitespace）| Task 2 (`validateAndNormalizeBaseUrl`) + Task 4 (prompt) |
| `resolve()` 优先级为 stored credential（4 个场景：stored priority、ambient only、no key、key no baseUrl）| Task 5 |
| baseUrl 持久化与可更新（2 个场景：update、preserve）| by-design (pi `CredentialStore.modify`); no test needed (pi's contract) |
| 扩展启动不影响 ambient env 用户（2 个场景：only env key、both env）| Task 5 (`resolve` ambient branches) + Task 7 (index.ts reads env as fallback) |
| 扩展使用 `createProvider()` 形式（2 个场景：call exists, no legacy form）| Task 8 (literal object) + grep audit in 8.3 |

No gaps found.

**Placeholder scan:**

- No "TBD", "TODO", "fill in", "appropriate", "similar to" in any step.
- Code blocks present for every code step.
- All function names referenced (`omnirouteApiKeyAuth`, `validateAndNormalizeBaseUrl`, `readCredential`, `resolveStoredBaseUrl`, `resolveAuthJsonPath`, `promptBaseUrlWithRetry`, `tryRegisterModels`, `setProviderModels`) are defined in this plan.

**Type consistency:**

- `ApiKeyAuth` from `@earendil-works/pi-ai` is used consistently.
- `Provider<"openai-completions">` matches `openAICompletionsApi()` return type.
- `Model<"openai-completions">` matches `provider.getModels(): readonly Model<"openai-completions">[]`.
- `StoredCredential` interface defined in `src/auth-credentials.ts` is referenced only inside that file.
- `AuthInteraction` and `AuthPrompt` from `@earendil-works/pi-ai` are used consistently in tests and `src/auth.ts`.

No type inconsistencies found.

---

## Execution Handoff

After approval, the implementer has two paths:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration with parallel safety. Use `superpowers:subagent-driven-development`.
2. **Inline Execution** — execute tasks in this session, batch execution with checkpoints for review. Use `superpowers:executing-plans`.

Each task ends with a `git commit`. After all 8 tasks complete, run `/opsx:archive support-custom-baseurl-on-login` to finalize the change.

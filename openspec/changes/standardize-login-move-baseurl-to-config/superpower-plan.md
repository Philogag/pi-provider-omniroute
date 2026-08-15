---
change: standardize-login-move-baseurl-to-config
design-doc: openspec/changes/standardize-login-move-baseurl-to-config/superpower-design.md
base-ref: 524f60e6d1bed033044c631bc889656af0c5ceca
---

# 实现计划：标准登录流程 + baseUrl 配置化

> **For agentic workers:** REQUIRED SUB-SKILL: 使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现本计划。步骤用 `- [ ]` 复选框跟踪。
> 实现约束：必须 TDD（先写失败测试 → 运行确认失败 → 最小实现 → 运行确认通过 → 提交）。每个任务独立可测试、独立提交。

**Goal:** 将 `/login omniroute` 改为 pi-ai 标准 api-key 流程（只提示 key），并把 baseUrl 的唯一持久化点迁移到标准 `settings.json`（`$PI_AGENT_DIR/settings.json`）的 `pi-provider-omniroute` 块（解析链：配置块 → `OMNIROUTE_BASE_URL` env → 默认值 `http://localhost:20128/v1`），启动时一次性迁移旧 `omniroute.json`（成功后删除）与旧 auth.json 遗留 baseUrl，settings 菜单新增 Base URL 编辑，修改后尽力刷新模型。

**Architecture:** login 凭据不再携带 baseUrl（删除自造 `check` 与 env 注入）；`src/tools/search-config.ts` 成为 baseUrl 读/写/解析的唯一模块（配置读写收敛到 `settings.json` 的 `pi-provider-omniroute` 块，新增 `writeOmnirouteBaseUrl`、`parseBaseUrlInput`、`migrateLegacyConfig`）；`src/index.ts` 的 provider baseUrl 由 `const` 改 `let` 并随会话事件/菜单提交更新；菜单状态机新增 `sub-base-url` 模式（pi-tui `Input` 编辑器）；工具侧回退链统一走 `resolveOmnirouteBaseUrl()`。

**Tech Stack:** TypeScript (ESM, Node ≥22.6, `--experimental-strip-types`)、`node:test` + `node:assert/strict`、pi-ai 0.84.2（`envApiKeyAuth`）、pi-tui（`Input`/`SelectList`/`Container`）、pi-coding-agent（`ExtensionContext.modelRegistry.refresh`）。**无新增依赖。**

**Spec:** 需求事实源 = `openspec/changes/standardize-login-move-baseurl-to-config/specs/{provider-login,base-url-config}/spec.md`；设计细节 = `openspec/changes/standardize-login-move-baseurl-to-config/superpower-design.md`。本计划从设计文档推导，执行者同时阅读两者。

## Global Constraints

- 解析优先级（spec B1）：`settings.json` 的 `pi-provider-omniroute` 块 `baseUrl` → `OMNIROUTE_BASE_URL` env → 默认值 `OMNIROUTE_DEFAULT_BASE_URL = "http://localhost:20128/v1"`。旧 auth.json 与旧 `omniroute.json` 只在一次性迁移路径读取，`resolveOmnirouteBaseUrl` 不再回退 legacy。
- 配置存储：读写 `$PI_AGENT_DIR/settings.json`（默认 `~/.pi/agent/settings.json`）的 `pi-provider-omniroute` 块——读时保留其余键，写时深合并（**必须保留 pi 自身管理的 packages/theme/subagents 等未知键**）。
- login 只提示 secret key（凭据不含 baseUrl / env / check）。
- 校验规则复用 `validateAndNormalizeBaseUrl`（空/空白→默认值、仅 http(s)、缺 `/v1` 后缀 console.warn 但合法）。
- 空输入 = 重置（删除配置块 `baseUrl` 字段，回退 env/默认）。
- 提交 baseUrl 后尽力刷新：`ctx.modelRegistry.refresh({ providers: ["omniroute"], force: true })`，失败 console.warn + notify（不抛）。
- 配置文件原子写（目标 `settings.json`）：tmp + `renameSync`，`mode: 0o600`，读最新内容、只改 `pi-provider-omniroute` 块、保留所有未知根键，失败仅 `console.warn`。
- 测试/类型检查命令：`npm test`（`node --test --experimental-strip-types 'test/**/*.test.ts'`）、`npm run typecheck`（tsc --noEmit，tsconfig 未开 noUnusedLocals）。
- 无新增依赖；不修改 `validateAndNormalizeBaseUrl` 与默认值；不删除 `src/auth-credentials.ts`（迁移读取源）。
- 已核实 API：pi-ai 0.84.2 主入口导出 `envApiKeyAuth(name: string, envVars: string[])`；pi-tui `Input`：`onSubmit(value)`（触发键 = `"\n"` 或 `tui.input.submit` 绑定）、`onEscape()`（触发键 = `tui.select.cancel` 绑定，即 `"\x1b"`）、`setValue/getValue/focused`、`handleInput(data)` 对无控制字符的字符串整体插入；SelectList 选中触发键 `"\r"`。

---

### Task 1: 标准登录流程（auth.ts → envApiKeyAuth）

**Files:**
- Modify: `src/auth.ts`（整个 `omnirouteApiKeyAuth` 实现替换）
- Modify: `test/auth.test.ts`（重写全部用例）

**Interfaces:**
- Consumes: `envApiKeyAuth` from `@earendil-works/pi-ai`（主入口导出）
- Produces: `export const omnirouteApiKeyAuth = () => envApiKeyAuth("OmniRoute API key", ["OMNIROUTE_API_KEY"])` —— `ApiKeyAuth` 对象（无 `check`，login 只提示 secret key，resolve 返回 `{ auth: { apiKey }, source }` 且**不含 baseUrl/env**）
- Produces（保留不变）: `OMNIROUTE_DEFAULT_BASE_URL`、`validateAndNormalizeBaseUrl`（后续任务继续使用）

- [ ] **Step 1: 确认 envApiKeyAuth 输出形状**

先读 pi-ai 源码确认 resolve/login 的精确返回形状，避免断言与实现漂移：
```bash
grep -n "envApiKeyAuth" -A 40 "$(find /home/philogag/.local/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist -name 'helpers.js' | head -1)"
```
确认：login 只 prompt secret；resolve 的 `source` 取值（"stored credential" / env 名）；credential 路径返回不含 `env` 字段。

- [ ] **Step 2: 重写 test/auth.test.ts 为失败测试**

```ts
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
    get calls() { return calls; },
  } as AuthInteraction & { calls: AuthPrompt[] };
}

function mockCtx(envValues: Record<string, string | undefined>) {
  return { async env(name: string): Promise<string | undefined> { return envValues[name]; } };
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
  const result = await auth.resolve!({ ctx, credential });
  assert.ok(result);
  assert.equal((result as { auth: { apiKey: string } }).auth.apiKey, "stored-key");
  assert.equal((result as { auth: { baseUrl?: string } }).auth.baseUrl, undefined, "resolve must not emit baseUrl");
  assert.equal((result as { env?: unknown }).env, undefined, "resolve must not emit env");
  assert.equal((result as { source: string }).source, "stored credential");
});

test("resolve: falls back to OMNIROUTE_API_KEY env when no stored credential", async () => {
  const auth = await getAuth();
  const ctx = mockCtx({ OMNIROUTE_API_KEY: "env-key" });
  const result = await auth.resolve!({ ctx, credential: undefined });
  assert.ok(result);
  assert.equal((result as { auth: { apiKey: string } }).auth.apiKey, "env-key");
  assert.equal((result as { env?: unknown }).env, undefined);
});

test("resolve: returns undefined when no credential and no env", async () => {
  const auth = await getAuth();
  const result = await auth.resolve!({ ctx: mockCtx({}), credential: undefined });
  assert.equal(result, undefined);
});

test("resolve: source field never contains the key value", async () => {
  const auth = await getAuth();
  const result = await auth.resolve!({ ctx: mockCtx({}), credential: { type: "api_key" as const, key: "supersecret" } });
  assert.ok(result);
  assert.ok(!JSON.stringify(result.source ?? "").includes("supersecret"));
});

test("standard flow: auth has no custom check", async () => {
  const auth = await getAuth();
  assert.equal(auth.check, undefined, "standard api-key auth must not carry a check");
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `npm test -- --test-name-pattern "login|resolve|standard" test/auth.test.ts`
Expected: FAIL（旧实现 login 提示两次、credential 带 env、有 check）

- [ ] **Step 4: 替换 src/auth.ts 实现**

`src/auth.ts` 整体替换为：
```ts
import { envApiKeyAuth } from "@earendil-works/pi-ai";

export const OMNIROUTE_DEFAULT_BASE_URL = "http://localhost:20128/v1";

export function validateAndNormalizeBaseUrl(input: string): string {
  // …保持不变（从原文件原样保留）…
}

export const omnirouteApiKeyAuth = () =>
  envApiKeyAuth("OmniRoute API key", ["OMNIROUTE_API_KEY"]);
```
同时删除 `MAX_URL_RETRIES`、`promptBaseUrlWithRetry`、`ApiKeyAuth`/`AuthInteraction` 类型导入（不再需要）。

- [ ] **Step 5: 运行测试确认通过**

Run: `npm test -- test/auth.test.ts`
Expected: 全部 PASS

- [ ] **Step 6: 提交**

```bash
git add src/auth.ts test/auth.test.ts
git commit -m "refactor: standard login flow via envApiKeyAuth (no baseUrl/env in credentials)"
```

---

### Task 2: baseUrl 配置写入/解析原语（search-config.ts）

**Files:**
- Modify: `src/tools/search-config.ts`（`readOmnirouteConfig`/`writeOmnirouteConfig`/`resolveOmnirouteConfigPath` 改为 `settings.json` 的 `pi-provider-omniroute` 块；新增 `writeOmnirouteBaseUrl`、`parseBaseUrlInput`、`BaseUrlInputResult`；`resolveOmnirouteBaseUrl` 去 legacy）
- Modify: `test/search-config-persistence.test.ts`（更新既有 omniroute.json 相关用例为 settings.json 块 + 新增用例 + 替换 legacy 回退用例）

**Interfaces:**
- Consumes: `validateAndNormalizeBaseUrl`、`OMNIROUTE_DEFAULT_BASE_URL` from `../auth.ts`；既有读-改-写原子写模式；`resolveStoredBaseUrl` from `../auth-credentials.ts`（本任务内仅从 `resolveOmnirouteBaseUrl` 移除引用，`migrateLegacyConfig` 在 Task 3 使用它）
- Produces:
  - `export function resolveAgentSettingsPath(): string` —— 返回 `$PI_AGENT_DIR/settings.json`（或 `~/.pi/agent/settings.json`）；替换原 `resolveOmnirouteConfigPath`（rename，行为改为指向 settings.json）
  - `export function readOmnirouteConfig(): OmnirouteConfig` —— 读 `settings.json` 的 `pi-provider-omniroute` 块（`baseUrl`/`search`/`fetch`；块不存在返回空配置）
  - `export function writeOmnirouteConfig(provider, key)` —— 同样写入块（`root["pi-provider-omniroute"][field]`），保留所有未知根键
  - `export function writeOmnirouteBaseUrl(url: string | undefined): void` —— 设/删 `root["pi-provider-omniroute"].baseUrl`（`undefined` = 删除），原子写，保留未知键（含 pi 自身键），失败 warn 不抛
  - `export type BaseUrlInputResult = { ok: true; value: string | undefined } | { ok: false; error: string }`
  - `export function parseBaseUrlInput(raw: string): BaseUrlInputResult` —— `trim()===""` → `{ok:true,value:undefined}`；否则 `validateAndNormalizeBaseUrl` 成功 → `{ok:true,value:normalized}`、抛错 → `{ok:false,error:err.message}`
  - `resolveOmnirouteBaseUrl()` 行为变化：`config.baseUrl ?? env.OMNIROUTE_BASE_URL ?? OMNIROUTE_DEFAULT_BASE_URL`（**删除 legacy 回退**）

- [ ] **Step 1: 写失败测试（追加到 test/search-config-persistence.test.ts）**

在既有 `beforeEach`（临时 `PI_AGENT_DIR`）下追加（并更新既有直接读写 `omniroute.json` 的用例为 settings.json 块格式）：
```ts
import { writeOmnirouteBaseUrl, parseBaseUrlInput } from "../src/tools/search-config.ts"; // 追加到现有 import

const SETTINGS = (block: Record<string, unknown>) => JSON.stringify({ packages: ["npm:@philogag/pi-provider-omniroute"], theme: "dark", "pi-provider-omniroute": block }, null, 2) + "\n";

function settingsPath() { return join(dir, "settings.json"); }

test("writeOmnirouteBaseUrl: writes baseUrl into the pi-provider-omniroute block of settings.json", () => {
  writeOmnirouteBaseUrl("https://route.example/v1");
  const out = JSON.parse(readFileSync(settingsPath(), "utf8"));
  assert.deepEqual(out["pi-provider-omniroute"], { baseUrl: "https://route.example/v1" });
  assert.ok(Array.isArray(out.packages), "settings.json root keys preserved");
});

test("writeOmnirouteBaseUrl: undefined removes block.baseUrl and preserves other root keys", () => {
  writeFileSync(settingsPath(), SETTINGS({ baseUrl: "https://x/v1", search: { provider: "tavily-search" } }));
  writeOmnirouteBaseUrl(undefined);
  const out = JSON.parse(readFileSync(settingsPath(), "utf8"));
  assert.equal(out["pi-provider-omniroute"].baseUrl, undefined);
  assert.deepEqual(out["pi-provider-omniroute"].search, { provider: "tavily-search" });
  assert.deepEqual(out.packages, ["npm:@philogag/pi-provider-omniroute"], "packages key preserved");
});

test("writeOmnirouteBaseUrl: creates the block when settings.json exists without it", () => {
  writeFileSync(settingsPath(), JSON.stringify({ theme: "dark" }, null, 2));
  writeOmnirouteBaseUrl("https://route.example/v1");
  const out = JSON.parse(readFileSync(settingsPath(), "utf8"));
  assert.deepEqual(out["pi-provider-omniroute"], { baseUrl: "https://route.example/v1" });
  assert.equal(out.theme, "dark");
});

test("writeOmnirouteBaseUrl: round-trips through readOmnirouteConfig", () => {
  writeOmnirouteBaseUrl("https://route.example/v1");
  assert.equal(readOmnirouteConfig().baseUrl, "https://route.example/v1");
  writeOmnirouteBaseUrl(undefined);
  assert.equal(readOmnirouteConfig().baseUrl, undefined);
});

test("writeOmnirouteBaseUrl: write failure (read-only dir) warns but does not throw", () => {
  writeOmnirouteBaseUrl("https://x/v1");
  chmodSync(dir, 0o500);
  const origWarn = console.warn;
  let warned = false;
  console.warn = (...args: unknown[]) => { if (String(args[0]).includes("omniroute")) warned = true; };
  try {
    writeOmnirouteBaseUrl("https://y/v1");
  } finally {
    console.warn = origWarn;
    chmodSync(dir, 0o700);
  }
  assert.equal(warned, true);
});

test("parseBaseUrlInput: valid URL returns normalized value", () => {
  assert.deepEqual(parseBaseUrlInput("  https://route.example/v1  "), { ok: true, value: "https://route.example/v1" });
});

test("parseBaseUrlInput: empty or whitespace means reset (undefined)", () => {
  assert.deepEqual(parseBaseUrlInput(""), { ok: true, value: undefined });
  assert.deepEqual(parseBaseUrlInput("   "), { ok: true, value: undefined });
});

test("parseBaseUrlInput: invalid URL returns error", () => {
  const r = parseBaseUrlInput("not-a-url");
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /Invalid base URL/);
});

test("parseBaseUrlInput: non-http protocol returns error", () => {
  const r = parseBaseUrlInput("ftp://x/v1");
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /http\(s\)/);
});

test("parseBaseUrlInput: missing /v1 suffix is still valid (warns)", () => {
  const origWarn = console.warn;
  console.warn = () => {};
  try {
    assert.deepEqual(parseBaseUrlInput("https://route.example"), { ok: true, value: "https://route.example" });
  } finally {
    console.warn = origWarn;
  }
});
```

**同时替换**既有用例 `"resolveOmnirouteBaseUrl: falls back to legacy auth.json env"` 为：
```ts
test("resolveOmnirouteBaseUrl: legacy auth.json env is NOT consulted (migration-only)", () => {
  writeFileSync(join(dir, "auth.json"), JSON.stringify({ omniroute: { type: "api_key", key: "k", env: { OMNIROUTE_BASE_URL: "https://legacy.example/v1" } } }));
  assert.equal(resolveOmnirouteBaseUrl(), "http://localhost:20128/v1");
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- test/search-config-persistence.test.ts`
Expected: 新用例 FAIL（函数不存在 / 旧 legacy 回退仍生效）

- [ ] **Step 3: 实现**

在 `src/tools/search-config.ts` 的 `resolveOmnirouteBaseUrl` 处修改：
```ts
export function resolveOmnirouteBaseUrl(): string {
  return (
    readOmnirouteConfig().baseUrl ??
    process.env.OMNIROUTE_BASE_URL ??
    OMNIROUTE_DEFAULT_BASE_URL
  );
}
```
（删除 `resolveStoredBaseUrl` 回退项；`import { resolveStoredBaseUrl } from "../auth-credentials.ts"` 移到 Task 3 需要处或一并删除，Task 3 会重新引入。）

新增（放在 `writeOmnirouteConfig` 之后）：
```ts
export type BaseUrlInputResult =
  | { ok: true; value: string | undefined }
  | { ok: false; error: string };

export function parseBaseUrlInput(raw: string): BaseUrlInputResult {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: true, value: undefined };
  try {
    return { ok: true, value: validateAndNormalizeBaseUrl(trimmed) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function writeOmnirouteBaseUrl(url: string | undefined): void {
  const path = resolveAgentSettingsPath();
  const tmp = path + ".tmp";
  let root: Record<string, unknown> = {};
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      root = parsed as Record<string, unknown>;
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`[omniroute] failed to read ${path} before write: ${(err as Error).message}`);
    }
  }
  const block = (root["pi-provider-omniroute"] ?? {}) as Record<string, unknown>;
  if (url === undefined) {
    delete block.baseUrl;
  } else {
    block.baseUrl = url;
  }
  root["pi-provider-omniroute"] = block;
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(tmp, JSON.stringify(root, null, 2) + "\n", { mode: 0o600 });
    renameSync(tmp, path);
  } catch (err) {
    console.warn(`[omniroute] failed to write ${path}: ${(err as Error).message}`);
    try { unlinkSync(tmp); } catch { /* ignore */ }
  }
}
```
（配套：`resolveAgentSettingsPath()` = 返回 `$PI_AGENT_DIR/settings.json`（或 `~/.pi/agent/settings.json`）；`readOmnirouteConfig()` 改读 `root["pi-provider-omniroute"]` 块（块不存在返回空配置）；`writeOmnirouteConfig(provider, key)` 同写入块字段；`resolveOmnirouteBaseUrl()` 删除 legacy 回退。）

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- test/search-config-persistence.test.ts`
Expected: 全部 PASS

- [ ] **Step 5: 提交**

```bash
git add src/tools/search-config.ts test/search-config-persistence.test.ts
git commit -m "feat: baseUrl config write/parse primitives; drop legacy fallback from resolver"
```

---

### Task 3: 一次性迁移（双源：旧 omniroute.json + auth.json）+ 提交后尽力刷新

**Files:**
- Modify: `src/tools/search-config.ts`（`migrateLegacyConfig`）
- Modify: `src/index.ts`（`const baseUrl` → `let baseUrl`；`session_start` 迁移 + 刷新；新增 `refreshOmnirouteModels`）
- Create: `test/migration-config.test.ts`
- Modify: `test/session-start-config.test.ts`（sessionCtx 补 `refresh` stub）

**Interfaces:**
- Consumes: `writeOmnirouteBaseUrl`（Task 2）、`resolveStoredBaseUrl` from `../auth-credentials.ts`、`readOmnirouteConfig`（既有）、`normalizeFetchProvider`（既有）
- Produces:
  - `export function migrateLegacyConfig(): string | undefined` —— 仅当 `readOmnirouteConfig().baseUrl === undefined` 且 `process.env.OMNIROUTE_BASE_URL` 未设置时执行迁移。源①：旧 `omniroute.json`（`$PI_AGENT_DIR/omniroute.json`，存在则读；其 `baseUrl`/`search`/`fetch` 并入配置块——仅填补块内缺失字段；迁移成功后 `unlinkSync` 删除该文件，删除失败仅 warn）。源②：`resolveStoredBaseUrl()`（auth.json legacy env，仅 baseUrl，仅当源①未提供 baseUrl）。写入配置块后返回迁移后的 baseUrl；否则 `undefined`。幂等。
  - `src/index.ts` 内 `async function refreshOmnirouteModels(ctx: ExtensionContext): Promise<void>` —— try `ctx.modelRegistry.refresh({ providers: ["omniroute"], force: true })`；catch → console.warn + 尽力 `ctx.ui.notify("Base URL 已更新，模型将在下次会话刷新", "info")`（notify 再包一层 try，测试 ctx 可能无 ui）
- 依赖变化：`src/index.ts` 需新增 `import type { ExtensionContext } from "@earendil-works/pi-coding-agent"` 与 `import { migrateLegacyConfig } from "./tools/search-config.ts"`

- [ ] **Step 1: 写失败测试（test/migration-config.test.ts）**

```ts
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateLegacyConfig, readOmnirouteConfig } from "../src/tools/search-config.ts";

const origPiAgentDir = process.env.PI_AGENT_DIR;
const origEnv = process.env.OMNIROUTE_BASE_URL;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "omniroute-migration-test-"));
  process.env.PI_AGENT_DIR = dir;
  delete process.env.OMNIROUTE_BASE_URL;
});
after(() => {
  if (origPiAgentDir === undefined) delete process.env.PI_AGENT_DIR;
  else process.env.PI_AGENT_DIR = origPiAgentDir;
  if (origEnv === undefined) delete process.env.OMNIROUTE_BASE_URL;
  else process.env.OMNIROUTE_BASE_URL = origEnv;
});

function seedLegacy(url: string) {
  writeFileSync(join(dir, "auth.json"), JSON.stringify({ omniroute: { type: "api_key", key: "k", env: { OMNIROUTE_BASE_URL: url } } }));
}

// 旧版配置文件：baseUrl + search + fetch 并存
function seedOldConfig() {
  writeFileSync(join(dir, "omniroute.json"), JSON.stringify({ baseUrl: "https://legacy-cfg.example/v1", search: { provider: "tavily-search" }, fetch: { provider: "firecrawl" } }));
}

test("migrateLegacyConfig: migrates legacy auth.json baseUrl into block when nothing else set", () => {
  seedLegacy("https://legacy.example/v1");
  const result = migrateLegacyConfig();
  assert.equal(result, "https://legacy.example/v1");
  assert.equal(readOmnirouteConfig().baseUrl, "https://legacy.example/v1");
});

test("migrateLegacyConfig: merges old omniroute.json (baseUrl+search+fetch) into block and deletes the file", () => {
  seedOldConfig();
  const result = migrateLegacyConfig();
  assert.equal(result, "https://legacy-cfg.example/v1");
  const cfg = readOmnirouteConfig();
  assert.equal(cfg.baseUrl, "https://legacy-cfg.example/v1");
  assert.deepEqual(cfg.search, { provider: "tavily-search" });
  assert.deepEqual(cfg.fetch, { provider: "firecrawl" });
  assert.throws(() => readFileSync(join(dir, "omniroute.json"), "utf8"), /ENOENT/, "old file deleted after successful migration");
});

test("migrateLegacyConfig: does not overwrite block fields already present; old file still deleted", () => {
  writeFileSync(join(dir, "settings.json"), JSON.stringify({ "pi-provider-omniroute": { search: { provider: "brave-search" } } }));
  seedOldConfig();
  const result = migrateLegacyConfig();
  assert.equal(result, "https://legacy-cfg.example/v1");
  const cfg = readOmnirouteConfig();
  assert.equal(cfg.baseUrl, "https://legacy-cfg.example/v1");
  assert.deepEqual(cfg.search, { provider: "brave-search" }, "existing block field wins");
  assert.throws(() => readFileSync(join(dir, "omniroute.json"), "utf8"), /ENOENT/);
});

test("migrateLegacyConfig: falls back to auth.json legacy when old file has no baseUrl; old file still deleted", () => {
  writeFileSync(join(dir, "omniroute.json"), JSON.stringify({ search: { provider: "serper-search" } }));
  seedLegacy("https://legacy.example/v1");
  const result = migrateLegacyConfig();
  assert.equal(result, "https://legacy.example/v1");
  assert.equal(readOmnirouteConfig().baseUrl, "https://legacy.example/v1");
  assert.deepEqual(readOmnirouteConfig().search, { provider: "serper-search" });
  assert.throws(() => readFileSync(join(dir, "omniroute.json"), "utf8"), /ENOENT/);
});

test("migrateLegacyConfig: no-op when block already has baseUrl", () => {
  writeFileSync(join(dir, "settings.json"), JSON.stringify({ "pi-provider-omniroute": { baseUrl: "https://cfg.example/v1" } }));
  seedOldConfig();
  seedLegacy("https://legacy.example/v1");
  assert.equal(migrateLegacyConfig(), undefined);
  assert.equal(readOmnirouteConfig().baseUrl, "https://cfg.example/v1");
  assert.ok(readFileSync(join(dir, "omniroute.json"), "utf8"), "no migration → old file untouched");
});

test("migrateLegacyConfig: no-op when OMNIROUTE_BASE_URL env is set", () => {
  process.env.OMNIROUTE_BASE_URL = "https://env.example/v1";
  seedLegacy("https://legacy.example/v1");
  assert.equal(migrateLegacyConfig(), undefined);
  assert.equal(readOmnirouteConfig().baseUrl, undefined);
});

test("migrateLegacyConfig: returns undefined when no legacy source", () => {
  assert.equal(migrateLegacyConfig(), undefined);
  assert.deepEqual(readOmnirouteConfig(), {});
});

test("migrateLegacyConfig: idempotent — second call does nothing", () => {
  seedLegacy("https://legacy.example/v1");
  migrateLegacyConfig();
  assert.equal(migrateLegacyConfig(), undefined);
});

test("migrateLegacyConfig: old file kept on write failure (retry next startup)", () => {
  seedOldConfig();
  chmodSync(dir, 0o500); // settings.json 写入将失败
  const origWarn = console.warn;
  console.warn = () => {};
  try {
    const result = migrateLegacyConfig();
    assert.equal(result, "https://legacy-cfg.example/v1", "returns migrated value; in-memory state carries the session");
  } finally {
    console.warn = origWarn;
    chmodSync(dir, 0o700);
  }
  const oldCfg = JSON.parse(readFileSync(join(dir, "omniroute.json"), "utf8"));
  assert.equal(oldCfg.baseUrl, "https://legacy-cfg.example/v1", "old file NOT deleted when migration write failed");
});```
（注：最后一个用例说明写失败场景 —— 更直接的构造是手动调 `writeOmnirouteBaseUrl` 到只读目录断言 warn 不抛，Task 2 已覆盖；迁移函数本身在写失败时仍返回 legacy，由 session 内存态兜底，下次启动重试。如 chmod 在部分平台不生效导致断言不稳，可删此用例，保留 Task 2 的写失败用例。）

- [ ] **Step 2: 更新 test/session-start-config.test.ts 的 sessionCtx**

```ts
function sessionCtx(): unknown {
  return {
    sessionManager: { getBranch: () => [] },
    modelRegistry: { refresh: async () => {} },   // 新增：refreshOmnirouteModels 需要
  };
}
```

- [ ] **Step 3: 运行测试确认失败**

Run: `npm test -- test/migration-config.test.ts test/session-start-config.test.ts`
Expected: 新文件用例 FAIL（`migrateLegacyConfig` 不存在）

- [ ] **Step 4: 实现**

`src/tools/search-config.ts` 新增：
```ts
export function migrateLegacyConfig(): string | undefined {
  if (readOmnirouteConfig().baseUrl !== undefined) return undefined;
  if (process.env.OMNIROUTE_BASE_URL) return undefined;
  let migrated: string | undefined;
  const oldPath = resolveAgentSettingsPath().replace(/settings\.json$/, "omniroute.json");
  // 更稳的旧文件路径：$PI_AGENT_DIR/omniroute.json（与 resolveAgentSettingsPath 同目录推导）
  let oldCfg: Record<string, unknown> | undefined;
  try {
    const raw = readFileSync(oldPath, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) oldCfg = parsed as Record<string, unknown>;
  } catch { /* 旧文件不存在或损坏 → 跳过源① */ }
  const cur = readOmnirouteConfig();
  const next: Record<string, unknown> = {};
  if (cur.baseUrl === undefined && typeof oldCfg?.baseUrl === "string") next.baseUrl = oldCfg.baseUrl;
  if (cur.search === undefined && oldCfg?.search !== undefined) next.search = oldCfg.search;
  if (cur.fetch === undefined && oldCfg?.fetch !== undefined) next.fetch = oldCfg.fetch;
  if (oldCfg !== undefined) {
    try { unlinkSync(oldPath); } catch { /* 删除失败仅 warn */ }
  }
  migrated = next.baseUrl as string | undefined;
  if (migrated === undefined) {
    const legacy = resolveStoredBaseUrl();
    if (legacy !== undefined) {
      next.baseUrl = legacy;
      migrated = legacy;
    }
  }
  if (migrated === undefined) return undefined;
  writeOmnirouteBaseUrl(migrated);
  // search/fetch 若也迁移了，需一并持久化（writeOmnirouteConfig 不覆盖已有字段）
  if (next.search !== undefined) writeOmnirouteConfig("search", next.search as never);
  if (next.fetch !== undefined) writeOmnirouteConfig("fetch", next.fetch as never);
  return migrated;
}
```
（重新引入 `import { resolveStoredBaseUrl } from "../auth-credentials.ts"`，并新增 `unlinkSync` import。实现时以 `src/tools/search-config.ts` 既有辅助函数为准：若已有 `agentDir()` 辅助，则 `oldPath = join(agentDir(), "omniroute.json")` 优先，避免字符串替换脆弱；测试只依赖行为不依赖实现。）

注：若实现走"旧文件删除放在写入成功之后"更稳妥（先写块、成功后 unlink），请按此顺序实现——上述代码块为参考，行为契约以测试为准：迁移成功（块写入完成）→ 删除旧文件；写入失败 → 旧文件保留。

`src/index.ts` 修改：
```ts
// 模块顶部
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { readOmnirouteConfig, createMenuStateMachine, writeOmnirouteConfig, resolveOmnirouteBaseUrl, migrateLegacyConfig } from "./tools/search-config.ts";

// 模块级 baseUrl 改为 let（Task 4 菜单提交也会更新它）
let baseUrl = resolveOmnirouteBaseUrl();
```

在 `export default async function (pi: ExtensionAPI)` 内部、`pi.registerProvider(provider)` 之前新增：
```ts
async function refreshOmnirouteModels(ctx: ExtensionContext): Promise<void> {
  try {
    await ctx.modelRegistry.refresh({ providers: ["omniroute"], force: true });
  } catch (err) {
    console.warn("[omniroute] model refresh after baseUrl change failed:", err);
    try {
      ctx.ui.notify("Base URL 已更新，模型将在下次会话刷新", "info");
    } catch { /* 测试 ctx 可能没有 ui */ }
  }
}
```

`session_start` 钩子改为：
```ts
pi.on?.("session_start", async (_ev: unknown, ctx: ExtensionContext) => {
  const migrated = migrateLegacyConfig();
  if (migrated !== undefined) {
    baseUrl = migrated;
    await refreshOmnirouteModels(ctx);
  }
  const cfg = readOmnirouteConfig();
  currentConfigProvider = cfg.search?.provider;
  currentFetchProvider = normalizeFetchProvider(cfg.fetch?.provider);
});
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npm test -- test/migration-config.test.ts test/session-start-config.test.ts test/session-start-fetch-config.test.ts`
Expected: 全部 PASS

- [ ] **Step 6: 提交**

```bash
git add src/tools/search-config.ts src/index.ts test/migration-config.test.ts test/session-start-config.test.ts
git commit -m "feat: one-time migration of legacy omniroute.json + auth.json baseUrl into settings block + best-effort model refresh"
```

---

### Task 4: settings 菜单 Base URL 编辑（sub-base-url 模式）

**Files:**
- Modify: `src/tools/search-config.ts`（`renderBaseUrlEditor`、`TopLevelMenuParams` 加 `baseUrlPreview`/`onActivateBaseUrl`、`renderTopLevelMenu` 第三条目、状态机 `sub-base-url` 模式与 `onCommitBaseUrl` 依赖）
- Modify: `src/index.ts`（settings 命令接线：`resolveBaseUrl: () => baseUrl`、`initialBaseUrl`、`onCommitBaseUrl`；删除 http.ts 的 `resolveBaseUrl` 导入）
- Create: `test/search-config-base-url-editor.test.ts`
- Modify: `test/search-config-state-machine.test.ts`、`test/search-config-toplevel.test.ts`、`test/command-register.test.ts`

**Interfaces:**
- Consumes: `parseBaseUrlInput`/`BaseUrlInputResult`（Task 2）、`writeOmnirouteBaseUrl`（Task 2）、`resolveOmnirouteBaseUrl`（既有）、`refreshOmnirouteModels`（Task 3，index.ts 内）、pi-tui `Input`（`setValue/focused/onSubmit/onEscape/handleInput`）
- Produces:
  - `export interface BaseUrlEditorParams { readonly current: string; readonly theme: Theme; readonly onCommit: (value: string | undefined) => void; readonly onCancel: () => void; readonly requestRender?: () => void; readonly resolveBaseUrlInput?: (raw: string) => BaseUrlInputResult; }`
  - `export function renderBaseUrlEditor(params: BaseUrlEditorParams): Component` —— Container + DynamicBorder + 标题 "Base URL" + 提示行 + `Input`（`setValue(params.current)`、`focused = true`）+ 错误行（`theme.fg("warning", error)`）+ 键提示 `"enter=save · esc=back"`；`onSubmit`：`parseBaseUrlInput`（或注入版）→ ok 则 `params.onCommit(r.value)`、失败则设 error + `requestRender()`；`onEscape` → `params.onCancel`；container `handleInput` 转发到 input；暴露 `_input` 供测试
  - `TopLevelMenuParams` 新增 `readonly baseUrlPreview: string` 与 `readonly onActivateBaseUrl: () => void`；`renderTopLevelMenu` items 增加 `{ value: "base-url", label: \`Base URL: ${truncatePreview(baseUrlPreview)}\` }`（第三条）；`onSelect` 按 value 分发
  - `MenuStateMachineDeps` 新增 `readonly initialBaseUrl: string; readonly onCommitBaseUrl: (value: string | undefined) => void;`；`mode()` 联合类型扩展 `"sub-base-url"`；新增 `onActivateBaseUrl(): void`；`MenuStateMachine` 接口同步
  - 预览截断 helper：`function truncatePreview(s: string, max = 48): string`（超长截断 + "…"）

- [ ] **Step 1: 写失败测试**

**1a. `test/search-config-base-url-editor.test.ts`（新建）**
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { initTheme, type Theme } from "@earendil-works/pi-coding-agent";
import { renderBaseUrlEditor } from "../src/tools/search-config.ts";

initTheme();

const fakeTheme = { fg: (_c: string, s: string) => s, bold: (s: string) => s } as unknown as Theme;

function makeParams(overrides: Partial<Parameters<typeof renderBaseUrlEditor>[0]> = {}) {
  return { current: "http://localhost:20128/v1", theme: fakeTheme, onCommit: () => {}, onCancel: () => {}, ...overrides };
}

function editor(overrides: Partial<Parameters<typeof renderBaseUrlEditor>[0]> = {}) {
  return renderBaseUrlEditor(makeParams(overrides)) as unknown as {
    render: (w: number) => string[];
    handleInput: (d: string) => void;
    _input: { setValue(v: string): void; handleInput(d: string): void };
  };
}

test("renderBaseUrlEditor: renders title, prefilled value, and hint", () => {
  const e = editor({ current: "https://route.example/v1" });
  const joined = e.render(80).join("\n");
  assert.match(joined, /Base URL/);
  assert.match(joined, /https:\/\/route\.example\/v1/);
  assert.match(joined, /enter=save/);
});

test("renderBaseUrlEditor: Enter on valid prefilled value commits it", () => {
  const committed: Array<string | undefined> = [];
  const e = editor({ current: "https://route.example/v1", onCommit: (v) => committed.push(v) });
  e.handleInput("\n");
  assert.deepEqual(committed, ["https://route.example/v1"]);
});

test("renderBaseUrlEditor: empty input commits undefined (reset)", () => {
  const committed: Array<string | undefined> = [];
  const e = editor({ current: "https://route.example/v1", onCommit: (v) => committed.push(v) });
  e._input.setValue("");
  e.handleInput("\n");
  assert.deepEqual(committed, [undefined]);
});

test("renderBaseUrlEditor: invalid input shows error and does not commit", () => {
  const committed: Array<string | undefined> = [];
  let renders = 0;
  const e = editor({ current: "https://route.example/v1", onCommit: (v) => committed.push(v), requestRender: () => { renders++; } });
  e._input.setValue("not-a-url");
  e.handleInput("\n");
  assert.deepEqual(committed, []);
  assert.ok(renders >= 1, "error must request a re-render");
  assert.match(e.render(80).join("\n"), /Invalid base URL/);
});

test("renderBaseUrlEditor: Escape cancels without committing", () => {
  const committed: Array<string | undefined> = [];
  let cancelled = 0;
  const e = editor({ current: "https://route.example/v1", onCommit: (v) => committed.push(v), onCancel: () => { cancelled++; } });
  e.handleInput("\x1b");
  assert.deepEqual(committed, []);
  assert.equal(cancelled, 1);
});

test("renderBaseUrlEditor: injected resolver drives the error path", () => {
  const e = editor({
    current: "http://x",
    resolveBaseUrlInput: (raw) => ({ ok: false, error: `boom: ${raw}` }),
    requestRender: () => {},
  });
  e.handleInput("\n");
  assert.match(e.render(80).join("\n"), /boom: http:\/\/x/);
});
```

**1b. `test/search-config-toplevel.test.ts`（追加/修改）**
- `makeParams` 增加 `baseUrlPreview: "http://localhost:20128/v1"` 与 `onActivateBaseUrl: () => {}` 默认值。
- 新用例：
```ts
test("renderTopLevelMenu: renders third row with Base URL preview", () => {
  const params = makeParams({ currentProvider: "tavily-search", fetchPreview: "firecrawl", baseUrlPreview: "https://route.example/v1" });
  const joined = renderTopLevelMenu(params).render(80).join("\n") as string;
  assert.match(joined, /Base URL:\s+https:\/\/route\.example\/v1/);
});

test("renderTopLevelMenu: select on base-url row activates base-url editor", () => {
  let activated = "";
  const params = makeParams({
    onActivateSearchProvider: () => { activated = "search"; },
    onActivateFetchProvider: () => { activated = "fetch"; },
    onActivateBaseUrl: () => { activated = "base-url"; },
  });
  const component = renderTopLevelMenu(params) as unknown as { _sl: { onSelect?: (item: { value: string }) => void } };
  component._sl.onSelect?.({ value: "base-url" });
  assert.equal(activated, "base-url");
});

test("renderTopLevelMenu: long baseUrl preview is truncated", () => {
  const long = "https://" + "a".repeat(60) + "/v1";
  const joined = renderTopLevelMenu(makeParams({ baseUrlPreview: long })).render(80).join("\n") as string;
  assert.ok(joined.length < 120, "truncated preview must stay short");
  assert.match(joined, /…/);
});
```

**1c. `test/search-config-state-machine.test.ts`（追加）**
```ts
test("createMenuStateMachine: onActivateBaseUrl switches to sub-base-url mode", () => {
  const sm = createMenuStateMachine(makeDeps());
  sm.onActivateBaseUrl();
  assert.equal(sm.mode(), "sub-base-url");
});

test("createMenuStateMachine: base-url editor instance is cached across renders", () => {
  const sm = createMenuStateMachine(makeDeps());
  const tui = makeTui();
  sm.onActivateBaseUrl();
  const first = sm.getComponent(tui, fakeTheme);
  const second = sm.getComponent(tui, fakeTheme);
  assert.equal(first, second, "base-url editor must be the same cached instance");
});

test("createMenuStateMachine: editor commit returns to top, updates preview via resolveBaseUrl", () => {
  const deps = makeDeps();
  const sm = createMenuStateMachine(deps);
  sm.onActivateBaseUrl();
  // 通过暴露的 _input 提交合法值
  const comp = sm.getComponent(makeTui(), fakeTheme) as unknown as { handleInput: (d: string) => void };
  comp.handleInput("https://new.example/v1");
  comp.handleInput("\n");
  assert.equal(sm.mode(), "top");
});

test("createMenuStateMachine: base-url commit calls onCommitBaseUrl", () => {
  const committed: Array<string | undefined> = [];
  const sm = createMenuStateMachine(makeDeps({ onCommitBaseUrl: (v) => committed.push(v) }));
  sm.onActivateBaseUrl();
  const comp = sm.getComponent(makeTui(), fakeTheme) as unknown as { handleInput: (d: string) => void };
  comp.handleInput("https://new.example/v1");
  comp.handleInput("\n");
  assert.deepEqual(committed, ["https://new.example/v1"]);
});

test("createMenuStateMachine: editor Escape returns to top without committing", () => {
  const committed: Array<string | undefined> = [];
  const sm = createMenuStateMachine(makeDeps({ onCommitBaseUrl: (v) => committed.push(v) }));
  sm.onActivateBaseUrl();
  const comp = sm.getComponent(makeTui(), fakeTheme) as unknown as { handleInput: (d: string) => void };
  comp.handleInput("\x1b");
  assert.equal(sm.mode(), "top");
  assert.deepEqual(committed, []);
});

test("C1 regression: Down Down + Enter on top menu activates the base-url editor", () => {
  const sm = createMenuStateMachine(makeDeps());
  const tui = makeTui();
  const frame = () => sm.getComponent(tui, fakeTheme) as unknown as { handleInput: (d: string) => void };
  frame();
  frame().handleInput("\x1b[B");
  frame().handleInput("\x1b[B");
  const after = frame();
  after.handleInput("\r");
  assert.equal(sm.mode(), "sub-base-url", "three-row top menu: Down Down + Enter must activate base-url editor");
});
```

**1d. `test/command-register.test.ts`（追加）**
```ts
test("/omniroute-settings: top menu renders Base URL row; base-url reset commit refreshes models", async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "omniroute-cmd-basurl-test-"));
  const origPi = process.env.PI_AGENT_DIR;
  process.env.PI_AGENT_DIR = tmpDir;
  writeFileSync(join(tmpDir, "settings.json"), JSON.stringify({ "pi-provider-omniroute": { baseUrl: "https://cfg.example/v1" } }));
  try {
    await entry(mockPi());
    const refreshCalls: Array<{ providers?: string[]; force?: boolean }> = [];
    let factory: ((tui: unknown, theme: unknown, kb: unknown, done: (r?: unknown) => void) => unknown) | undefined;
    const ctx = {
      mode: "tui",
      modelRegistry: { getApiKeyForProvider: async () => "test-key", refresh: async (o: unknown) => { refreshCalls.push(o as { providers?: string[]; force?: boolean }); } },
      ui: { notify: () => {}, custom: async (f: typeof factory) => { factory = f; } },
    } as unknown as ExtensionCommandContext;
    await registeredCommands["omniroute-settings"]("", ctx);
    const fakeTheme = { fg: (_c: string, s: string) => s, bold: (s: string) => s } as unknown as Theme;
    const wrapped = factory!(makeTui(), fakeTheme, undefined, () => {}) as { render: (w: number) => string[]; handleInput: (d: string) => void };
    assert.match(wrapped.render(80).join("\n"), /Base URL:/);
    // Down Down Enter -> editor; Enter on empty -> reset commit
    wrapped.handleInput("\x1b[B");
    wrapped.handleInput("\x1b[B");
    wrapped.handleInput("\r");
    assert.match(wrapped.render(80).join("\n"), /enter=save/);
    wrapped.handleInput("\n");  // 空输入 = 重置
    assert.deepEqual(refreshCalls, [{ providers: ["omniroute"], force: true }], "reset commit must trigger model refresh");
    const cfg = JSON.parse(readFileSync(join(tmpDir, "settings.json"), "utf8"));
    assert.equal(cfg["pi-provider-omniroute"].baseUrl, undefined, "reset must remove baseUrl from settings block");
  } finally {
    if (origPi === undefined) delete process.env.PI_AGENT_DIR;
    else process.env.PI_AGENT_DIR = origPi;
  }
});
```
（新增 import：`mkdtempSync/readFileSync/writeFileSync` from node:fs、`tmpdir` from node:os、`join` from node:path。）

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- test/search-config-base-url-editor.test.ts test/search-config-toplevel.test.ts test/search-config-state-machine.test.ts test/command-register.test.ts`
Expected: 新用例 FAIL（`renderBaseUrlEditor` 不存在、`makeDeps` 缺新依赖导致 TS 报错、顶层只有两行）

- [ ] **Step 3: 实现**

**3a. `src/tools/search-config.ts`**
- import 增加 `Input` from `@earendil-works/pi-tui`。
- 新增 `truncatePreview` + `renderBaseUrlEditor`（见 Interfaces 的精确形状；`Input` 的 `onSubmit` 触发键为 `"\n"` 或 `tui.input.submit` 绑定，`onEscape` 触发键为 `tui.select.cancel` 绑定即 `"\x1b"`——已核实 pi-tui input.js）。
- `TopLevelMenuParams` 加 `baseUrlPreview: string`、`onActivateBaseUrl: () => void`；`renderTopLevelMenu` 的 items 改为三行，`onSelect` 分发：
```ts
const items: SelectItem[] = [
  { value: "search", label: `Search provider: ${preview}` },
  { value: "fetch", label: `Web Fetch provider: ${fetchPreview}` },
  { value: "base-url", label: `Base URL: ${truncatePreview(params.baseUrlPreview)}` },
];
selectList.onSelect = (item: SelectItem): void => {
  if (item.value === "fetch") params.onActivateFetchProvider();
  else if (item.value === "base-url") params.onActivateBaseUrl();
  else params.onActivateSearchProvider();
};
```
- `MenuStateMachineDeps` 加：
```ts
readonly initialBaseUrl: string;
readonly onCommitBaseUrl: (value: string | undefined) => void;
```
- 状态机内部：
  - `let mode: "top" | "sub-search" | "sub-fetch" | "sub-base-url" = "top";`
  - `let cachedBaseUrlEditor: Component | undefined;`
  - 公共方法 `onActivateBaseUrl: () => { mode = "sub-base-url"; cachedTopLevel = undefined; cachedBaseUrlEditor = undefined; }`
  - `getComponent` 的 top 分支：`renderTopLevelMenu` 传 `baseUrlPreview: deps.resolveBaseUrl()` 与 `onActivateBaseUrl` 闭包（`mode = "sub-base-url"` + 失效化 + `tui.requestRender()`）。
  - 新增 `if (mode === "sub-base-url")` 分支（放在 `sub-search` 分支之后、`sub-fetch` 之前）：
```ts
if (mode === "sub-base-url") {
  if (cachedBaseUrlEditor) return cachedBaseUrlEditor;
  cachedBaseUrlEditor = renderBaseUrlEditor({
    current: deps.resolveBaseUrl(),
    theme,
    requestRender: () => tui.requestRender(),
    onCommit: (value) => {
      cachedTopLevel = undefined;
      cachedBaseUrlEditor = undefined;
      deps.onCommitBaseUrl(value);
      mode = "top";
      tui.requestRender();
    },
    onCancel: () => {
      cachedTopLevel = undefined;
      cachedBaseUrlEditor = undefined;
      mode = "top";
      tui.requestRender();
    },
  });
  return cachedBaseUrlEditor;
}
```
  - `onCommit`/`onCancel`/`onEsc`（既有方法）的缓存失效列表补上 `cachedBaseUrlEditor = undefined`。
- `MenuStateMachine` 接口加 `onActivateBaseUrl(): void;`，`mode()` 类型加 `"sub-base-url"`。

**3b. `src/index.ts` settings 命令接线**
```ts
const sm = createMenuStateMachine({
  resolveApiKey: () => resolveApiKey(ctx),
  resolveBaseUrl: () => baseUrl,        // 模块级 let —— settings 管理的就是配置文件管理的值
  initialCurrentProvider: currentConfigProvider,
  initialFetchProvider: currentFetchProvider,
  initialBaseUrl: baseUrl,
  onCommitPersist: (provider) => { currentConfigProvider = provider; writeOmnirouteConfig(provider); },
  onCommitFetchPersist: (provider) => { currentFetchProvider = provider; writeOmnirouteConfig(provider, "fetch"); },
  onCommitBaseUrl: (value) => {
    writeOmnirouteBaseUrl(value);
    baseUrl = value ?? resolveOmnirouteBaseUrl();
    void refreshOmnirouteModels(ctx);
  },
  onClose: () => {},
});
```
- import 更新：`writeOmnirouteBaseUrl` 加入 search-config import；删除 `resolveBaseUrl` from `./tools/http.ts`（保留 `resolveApiKey`）。

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- test/search-config-base-url-editor.test.ts test/search-config-toplevel.test.ts test/search-config-state-machine.test.ts test/command-register.test.ts`
Expected: 全部 PASS（含既有 C1 回归：两行→三行后 Down+Enter 仍激活 fetch）

- [ ] **Step 5: 提交**

```bash
git add src/tools/search-config.ts src/index.ts test/search-config-base-url-editor.test.ts test/search-config-toplevel.test.ts test/search-config-state-machine.test.ts test/command-register.test.ts
git commit -m "feat: Base URL editor in /omniroute-settings (sub-base-url mode) with best-effort model refresh"
```

---

### Task 5: 工具侧解析链统一（http.ts）

**Files:**
- Modify: `src/tools/http.ts`
- Modify: `test/tools-http.test.ts`

**Interfaces:**
- Consumes: `resolveOmnirouteBaseUrl` from `./search-config.ts`
- Produces: `resolveBaseUrl(ctx)` 新语义 —— omniroute 模型 baseUrl 优先；否则 `resolveOmnirouteBaseUrl()`（config → env → default）。`src/tools/http.ts` 不再直接引用 `OMNIROUTE_DEFAULT_BASE_URL`。

- [ ] **Step 1: 写失败测试（更新 test/tools-http.test.ts）**

文件顶部加临时 `PI_AGENT_DIR` 隔离（避免开发者本机 `~/.pi/agent/settings.json` 的 omniroute 块干扰回退断言）：
```ts
import { before, after, beforeEach } from "node:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const origPiAgentDir = process.env.PI_AGENT_DIR;
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "omniroute-http-test-"));
  process.env.PI_AGENT_DIR = dir;
});
after(() => {
  if (origPiAgentDir === undefined) delete process.env.PI_AGENT_DIR;
  else process.env.PI_AGENT_DIR = origPiAgentDir;
});
```

替换/新增用例：
```ts
test("resolveBaseUrl: prefers current omniroute model baseUrl", () => {
  const ctx = ctxWith({ provider: "omniroute", baseUrl: "http://remote:9000/v1" } as ExtensionContext["model"]);
  assert.equal(resolveBaseUrl(ctx), "http://remote:9000/v1");
});

test("resolveBaseUrl: non-omniroute model falls back to config block baseUrl", () => {
  writeFileSync(join(dir, "settings.json"), JSON.stringify({ "pi-provider-omniroute": { baseUrl: "https://cfg.example/v1" } }));
  const ctx = ctxWith({ provider: "anthropic", baseUrl: "http://other/v1" } as ExtensionContext["model"]);
  assert.equal(resolveBaseUrl(ctx), "https://cfg.example/v1");
});

test("resolveBaseUrl: config block baseUrl wins over env", () => {
  writeFileSync(join(dir, "settings.json"), JSON.stringify({ "pi-provider-omniroute": { baseUrl: "https://cfg.example/v1" } }));
  const before = process.env.OMNIROUTE_BASE_URL;
  process.env.OMNIROUTE_BASE_URL = "http://env-host/v1";
  try {
    assert.equal(resolveBaseUrl(ctxWith(undefined)), "https://cfg.example/v1");
  } finally {
    if (before === undefined) delete process.env.OMNIROUTE_BASE_URL;
    else process.env.OMNIROUTE_BASE_URL = before;
  }
});

test("resolveBaseUrl: no model, no config -> env fallback", () => {
  const before = process.env.OMNIROUTE_BASE_URL;
  process.env.OMNIROUTE_BASE_URL = "http://env-host/v1";
  try {
    assert.equal(resolveBaseUrl(ctxWith(undefined)), "http://env-host/v1");
  } finally {
    if (before === undefined) delete process.env.OMNIROUTE_BASE_URL;
    else process.env.OMNIROUTE_BASE_URL = before;
  }
});

test("resolveBaseUrl: no model, no config, no env -> default constant", () => {
  const before = process.env.OMNIROUTE_BASE_URL;
  delete process.env.OMNIROUTE_BASE_URL;
  try {
    assert.equal(resolveBaseUrl(ctxWith(undefined)), OMNIROUTE_DEFAULT_BASE_URL);
  } finally {
    if (before !== undefined) process.env.OMNIROUTE_BASE_URL = before;
  }
});
```
删除原 `"ignores non-omniroute model, falls back to env"`（语义已被上面用例覆盖且更完整）。

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- test/tools-http.test.ts`
Expected: config 回退用例 FAIL（当前实现只查 env/默认）

- [ ] **Step 3: 实现**

`src/tools/http.ts`：
```ts
// src/tools/http.ts
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { resolveOmnirouteBaseUrl } from "./search-config.ts";

export function resolveBaseUrl(ctx: ExtensionContext): string {
  if (ctx.model?.provider === "omniroute" && ctx.model.baseUrl) {
    return ctx.model.baseUrl;
  }
  return resolveOmnirouteBaseUrl();   // config → env → default（spec B1）
}
```
删除 `import { OMNIROUTE_DEFAULT_BASE_URL } from "../auth.ts"`。依赖环检查：`http.ts → search-config.ts → auth.ts`，search-config 不反向依赖 http.ts，无环。

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- test/tools-http.test.ts test/tools-search.test.ts test/tools-web-fetch.test.ts test/lazy-fetch.test.ts`
Expected: 全部 PASS

- [ ] **Step 5: 提交**

```bash
git add src/tools/http.ts test/tools-http.test.ts
git commit -m "fix: unify tool-side baseUrl fallback through resolveOmnirouteBaseUrl (config-first)"
```

---

### Task 6: 文档更新 + 全量回归

**Files:**
- Modify: `README.md`、`README.zh-CN.md`
- 无新增代码

- [ ] **Step 1: 更新 README.md**

- 配置章节：说明 baseUrl 现在由 `/omniroute-settings` 菜单的 Base URL 条目管理（或直接编辑 `~/.pi/agent/settings.json` 的 `pi-provider-omniroute` 块 `baseUrl` 字段），解析优先级为配置块 → `OMNIROUTE_BASE_URL` env → 默认 `http://localhost:20128/v1`；空输入即重置为默认。配置块由扩展读写时保留 settings.json 其他键（packages/theme 等）。
- login 章节：`/login omniroute` 只提示 API key，不再询问 baseUrl；key 解析优先级为已存凭据 → `OMNIROUTE_API_KEY` env。
- 迁移说明：旧版两处遗留会自动一次性迁移到 `settings.json` 的 `pi-provider-omniroute` 块（启动时）：旧 `omniroute.json`（baseUrl+search+fetch，迁移成功后自动删除）与旧 auth.json 内保存的 baseUrl；无需手动操作。
- 同步更新 `README.zh-CN.md` 对应章节。

- [ ] **Step 2: 全量回归**

Run: `npm test`
Expected: 全部 PASS
Run: `npm run typecheck`
Expected: 无错误（tsc --noEmit）

- [ ] **Step 3: 提交**

```bash
git add README.md README.zh-CN.md
git commit -m "docs: document standard login and config-managed baseUrl"
```

---

## Self-Review（已执行）

**1. Spec 覆盖**
- provider-login：login 只提示 key（Task 1）、凭据不含 baseUrl/env（Task 1 断言 `cred.env === undefined`）、key 解析优先级（Task 1 resolve 用例）✓
- base-url-config：解析优先级 config→env→默认（Task 2 `resolveOmnirouteBaseUrl`、Task 5 回退用例）✓；一次性迁移（Task 3）✓；顶层菜单 Base URL 条目（Task 4 顶层用例）✓；校验/写入/空输入重置（Task 2 `parseBaseUrlInput`/`writeOmnirouteBaseUrl` + Task 4 编辑器用例 + 命令集成重置用例）✓；提交后尽力刷新（Task 3 `refreshOmnirouteModels` + Task 4 命令集成断言 `refresh({providers:["omniroute"],force:true})`）✓

**2. Placeholder 扫描**：无 "TBD/TODO"、"类似 Task N"、无"写测试"式空指令；每个代码步骤都含实际代码。唯一放宽处：Task 1 Step 1 要求执行者先核对 pi-ai `envApiKeyAuth` 实际返回形状（跨版本兼容性需要），断言已写成属性级而非 deepEqual。

**3. 类型一致性**
- `parseBaseUrlInput`/`BaseUrlInputResult`：Task 2 定义，Task 4（编辑器/状态机）消费，形状一致 ✓
- `writeOmnirouteBaseUrl(url: string | undefined)`：Task 2 定义，Task 3/4 消费 ✓
- `migrateLegacyConfig(): string | undefined`：Task 3 定义并用于 session_start（双源：旧 omniroute.json + auth.json；成功后删除旧文件）✓
- `refreshOmnirouteModels(ctx: ExtensionContext): Promise<void>`：Task 3 定义，Task 4 的 `onCommitBaseUrl` 调用 ✓
- `onCommitBaseUrl: (value: string | undefined) => void`：Task 3 之后的 `let baseUrl` 由 Task 4 的 commit 闭包更新；状态机 `current` 预填用 `deps.resolveBaseUrl()` 动态取值，避免重复状态同步 ✓
- 顶层条目 value 命名 "base-url" 在 renderTopLevelMenu onSelect 与测试 `_sl.onSelect` 中一致 ✓
- Input 触发键：编辑器与测试统一用 `"\n"` 提交、`"\x1b"` 取消（已核实 pi-tui input.js）✓

**4. 风险提示（实现时留意，无需改 spec）**
- `envApiKeyAuth` 的 resolve 对 `{ctx, credential}` 签名要求：`mockCtx` 需提供 `env()`；若 0.84.2 的 resolve 还调用 `ctx.fileExists` 等，测试 mock 需补齐（Step 1 已提示先核对实现）。
- 若宿主某版本 `modelRegistry.refresh` 不触发 provider `refreshModels`，仅影响"本次会话立即更新"，notify 兜底已覆盖（superpower-design §8）。
- `command-register` 测试的 `entry(mockPi())` 多次执行 + 模块级 `baseUrl` 状态：新增用例用临时 `PI_AGENT_DIR` 隔离并在 finally 恢复，不污染其他用例。

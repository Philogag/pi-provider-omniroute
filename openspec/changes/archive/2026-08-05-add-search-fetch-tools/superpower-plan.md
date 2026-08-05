---
change: add-search-fetch-tools
design-doc: openspec/changes/add-search-fetch-tools/superpower-design.md
base-ref: f49a2300d15b3d78529a5dd05681b40c9fb4f835
---

# add-search-fetch-tools 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: 使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现本计划。步骤使用 `- [ ]` 复选框语法跟踪。

**Goal:** 将 OmniRoute 的 `POST /v1/search` 与 `POST /v1/web/fetch` 封装为 pi function tool（`omniroute_web_search`、`omniroute_web_fetch`），复用现有 omniroute 凭据体系，纯增量，无新增运行时依赖。

**Architecture:** 三个新源文件 + 一个入口改动：`src/tools/http.ts` 是唯一接触网络与凭据的模块（凭据解析、统一请求、超时/abort、错误契约）；`src/tools/search.ts` 与 `src/tools/web-fetch.ts` 各含 TypeBox 参数 schema、纯函数（body 构建/结果格式化）与工具 execute；`src/index.ts` 启动时注册两个工具。所有用户可见文案为英文；工具默认启用、不提供 promptSnippet/promptGuidelines；`timeoutMs` 为工具自有参数（默认 30000ms，不进入请求体）。

**Tech Stack:** TypeScript（strict, NodeNext, ESM, `.ts` 扩展名导入）、`@sinclair/typebox`（参数 schema）、`@earendil-works/pi-coding-agent`（`defineTool` / `registerTool` / 类型）、node:test + `node:assert/strict`（测试，mock `globalThis.fetch`）。

## Global Constraints

- 无新增运行时依赖；仅用现有依赖（`@sinclair/typebox`、`@earendil-works/pi-coding-agent`、`@earendil-works/pi-ai`）。
- ESM：本地相对导入必须带 `.ts` 扩展名（如 `import { resolveApiKey } from "./http.ts"`）。
- `tsconfig.json` 为 strict + noEmit；任何任务完成后 `npm run typecheck` 必须通过。
- 测试运行 `npm test`（`node --test --experimental-strip-types`）。
- 工具名固定：`omniroute_web_search`、`omniroute_web_fetch`；参数 schema 外层与嵌套对象均 `additionalProperties: false`。
- `timeoutMs` 只用于本地超时控制，**不得**出现在发往服务端的请求体中。
- 所有返回给 agent 的文案（描述、错误、截断提示）为英文；无 key 指引必须包含 `/login omniroute` 字样。
- 不提供 `promptSnippet` / `promptGuidelines`。
- 任何 HTTP 请求不得在未配置 API key 或参数校验失败时发出（spec 场景）。
- 响应截断硬上限：search 20 000 字符、web-fetch 40 000 字符。

## File Structure

| 文件 | 职责 | 类型 |
|---|---|---|
| `src/tools/http.ts` | `resolveBaseUrl` / `resolveApiKey` / `omnirouteRequest` + `OmnirouteResult` 判别联合 | Create |
| `src/tools/search.ts` | `omniroute_web_search`：schema、`buildSearchBody`、`formatSearchResults`、execute | Create |
| `src/tools/web-fetch.ts` | `omniroute_web_fetch`：schema、`buildFetchBody`、`extractFetchContent`、execute | Create |
| `src/index.ts` | 注册两个工具（try/catch 不阻断 provider） | Modify |
| `test/tools-http.test.ts` | http.ts 单测 | Create |
| `test/tools-search.test.ts` | search 纯函数 + execute 集成（mock fetch） | Create |
| `test/tools-web-fetch.test.ts` | web-fetch 纯函数 + execute 集成（mock fetch） | Create |
| `test/lazy-fetch.test.ts` | `mockPi()` 增加 `registerTool` 桩 | Modify |
| `docs/roadmap.md` | 标记 Web 搜索/抓取工具已实现 | Modify |

**跨任务接口契约（后置任务依赖前置任务的精确签名）：**

```ts
// src/tools/http.ts
export function resolveBaseUrl(ctx: ExtensionContext): string;
export async function resolveApiKey(ctx: ExtensionContext): Promise<string | undefined>;
export type OmnirouteResult =
  | { ok: true; text: string; json?: unknown }
  | { ok: false; status: number; message: string; cancelled?: boolean };
export async function omnirouteRequest(
  path: string,
  body: unknown,
  opts: { apiKey: string; baseUrl: string; signal?: AbortSignal; timeoutMs: number },
): Promise<OmnirouteResult>;
```

```ts
// src/tools/search.ts
export const SEARCH_PROVIDERS: readonly string[];   // 14 项，见任务 3
export const searchParamsSchema: TObject;           // Static → SearchToolParams
export function buildSearchBody(params: SearchToolParams): Record<string, unknown>;
export function formatSearchResults(json: unknown, query: string): string;
export const searchTool: ReturnType<typeof defineTool>;  // name: "omniroute_web_search"
```

```ts
// src/tools/web-fetch.ts
export const FETCH_PROVIDERS: readonly string[];    // 4 项
export const fetchParamsSchema: TObject;            // Static → FetchToolParams
export function buildFetchBody(params: FetchToolParams): Record<string, unknown>;
export function extractFetchContent(json: unknown): string;
export const webFetchTool: ReturnType<typeof defineTool>;  // name: "omniroute_web_fetch"
```

```ts
// src/index.ts（追加）
pi.registerTool(searchTool);
pi.registerTool(webFetchTool);
```

---

## Task 1: `resolveBaseUrl` / `resolveApiKey`（凭据解析）

**Files:**
- Create: `src/tools/http.ts`（本次仅前两个函数）
- Test: `test/tools-http.test.ts`（本次仅这两个函数）

**Interfaces:**
- Consumes: `ExtensionContext`（来自 `@earendil-works/pi-coding-agent`）、`OMNIROUTE_DEFAULT_BASE_URL`（来自 `src/auth.ts`）
- Produces: `resolveBaseUrl(ctx: ExtensionContext): string`；`resolveApiKey(ctx: ExtensionContext): Promise<string | undefined>`

- [ ] **Step 1: 写失败测试**

`test/tools-http.test.ts`：

```ts
// test/tools-http.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { OMNIROUTE_DEFAULT_BASE_URL } from "../src/auth.ts";
import { resolveApiKey, resolveBaseUrl } from "../src/tools/http.ts";

function ctxWith(model: ExtensionContext["model"], apiKey?: string): ExtensionContext {
  return {
    model,
    modelRegistry: { getApiKeyForProvider: async () => apiKey },
  } as unknown as ExtensionContext;
}

test("resolveBaseUrl: prefers current omniroute model baseUrl", () => {
  const ctx = ctxWith({ provider: "omniroute", baseUrl: "http://remote:9000/api/v1" } as ExtensionContext["model"]);
  assert.equal(resolveBaseUrl(ctx), "http://remote:9000/api/v1");
});

test("resolveBaseUrl: ignores non-omniroute model, falls back to env", () => {
  const before = process.env.OMNIROUTE_BASE_URL;
  process.env.OMNIROUTE_BASE_URL = "http://env-host/api/v1";
  try {
    const ctx = ctxWith({ provider: "anthropic", baseUrl: "http://other/api/v1" } as ExtensionContext["model"]);
    assert.equal(resolveBaseUrl(ctx), "http://env-host/api/v1");
  } finally {
    if (before === undefined) delete process.env.OMNIROUTE_BASE_URL;
    else process.env.OMNIROUTE_BASE_URL = before;
  }
});

test("resolveBaseUrl: no model, no env -> default constant", () => {
  const before = process.env.OMNIROUTE_BASE_URL;
  delete process.env.OMNIROUTE_BASE_URL;
  try {
    assert.equal(resolveBaseUrl(ctxWith(undefined)), OMNIROUTE_DEFAULT_BASE_URL);
  } finally {
    if (before !== undefined) process.env.OMNIROUTE_BASE_URL = before;
  }
});

test("resolveApiKey: returns key from modelRegistry", async () => {
  assert.equal(await resolveApiKey(ctxWith(undefined, "k1")), "k1");
});

test("resolveApiKey: undefined when registry has none", async () => {
  assert.equal(await resolveApiKey(ctxWith(undefined, undefined)), undefined);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- test/tools-http.test.ts`
Expected: FAIL，错误为模块找不到（`Cannot find module '../src/tools/http.ts'`）

- [ ] **Step 3: 最小实现**

`src/tools/http.ts`：

```ts
// src/tools/http.ts
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { OMNIROUTE_DEFAULT_BASE_URL } from "../auth.ts";

export function resolveBaseUrl(ctx: ExtensionContext): string {
  if (ctx.model?.provider === "omniroute" && ctx.model.baseUrl) {
    return ctx.model.baseUrl;
  }
  return process.env.OMNIROUTE_BASE_URL ?? OMNIROUTE_DEFAULT_BASE_URL;
}

export async function resolveApiKey(ctx: ExtensionContext): Promise<string | undefined> {
  return ctx.modelRegistry.getApiKeyForProvider("omniroute");
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- test/tools-http.test.ts`
Expected: PASS（5 个测试）

- [ ] **Step 5: 提交**

```bash
git add src/tools/http.ts test/tools-http.test.ts
git commit -m "feat(tools): add omniroute credential resolution helpers"
```

---

## Task 2: `omnirouteRequest`（统一 HTTP 请求）

**Files:**
- Modify: `src/tools/http.ts`（追加）
- Test: `test/tools-http.test.ts`（追加）

**Interfaces:**
- Consumes: Task 1 的 `resolveBaseUrl` / `resolveApiKey`（本任务不直接用，但同文件共存）
- Produces: `OmnirouteResult` 判别联合与 `omnirouteRequest(path, body, opts)`（任务 5/7 依赖）

- [ ] **Step 1: 写失败测试（mock fetch）**

`test/tools-http.test.ts` 追加：

```ts
import { omnirouteRequest } from "../src/tools/http.ts";
import type { OmnirouteResult } from "../src/tools/http.ts";

function jsonResponse(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function installFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  const original = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return impl(String(url), init);
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

const OPTS = { apiKey: "test-key", baseUrl: "http://localhost:20128/api/v1", timeoutMs: 30_000 };

test("omnirouteRequest: sends POST with Bearer + JSON headers, joins baseUrl/path", async (t) => {
  const { calls, restore } = installFetch(async () => jsonResponse(200, { ok: true }));
  t.after(restore);
  const res = await omnirouteRequest("/search", { query: "pi" }, OPTS);
  assert.ok(res.ok);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://localhost:20128/api/v1/search");
  assert.equal(calls[0].init?.method, "POST");
  const headers = calls[0].init?.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Bearer test-key");
  assert.equal(headers["Content-Type"], "application/json");
  assert.equal(calls[0].init?.body, JSON.stringify({ query: "pi" }));
});

test("omnirouteRequest: strips trailing slash from baseUrl", async (t) => {
  const { calls, restore } = installFetch(async () => jsonResponse(200, {}));
  t.after(restore);
  await omnirouteRequest("/search", {}, { ...OPTS, baseUrl: "http://x/api/v1/" });
  assert.equal(calls[0].url, "http://x/api/v1/search");
});

test("omnirouteRequest: parses 2xx JSON into json field", async (t) => {
  const { restore } = installFetch(async () => jsonResponse(200, { results: [1] }));
  t.after(restore);
  const res = await omnirouteRequest("/search", {}, OPTS);
  assert.ok(res.ok);
  assert.deepEqual(res.json, { results: [1] });
});

test("omnirouteRequest: non-2xx returns structured error with server message", async (t) => {
  const { restore } = installFetch(async () => jsonResponse(429, { error: "rate limited" }));
  t.after(restore);
  const res = (await omnirouteRequest("/search", {}, OPTS)) as Extract<OmnirouteResult, { ok: false }>;
  assert.equal(res.ok, false);
  assert.equal(res.status, 429);
  assert.match(res.message, /429/);
  assert.match(res.message, /rate limited/);
});

test("omnirouteRequest: network failure -> cannot reach message", async (t) => {
  const { restore } = installFetch(async () => {
    throw new TypeError("fetch failed");
  });
  t.after(restore);
  const res = (await omnirouteRequest("/search", {}, OPTS)) as Extract<OmnirouteResult, { ok: false }>;
  assert.equal(res.ok, false);
  assert.equal(res.status, 0);
  assert.match(res.message, /Cannot reach OmniRoute at http:\/\/localhost:20128\/api\/v1/);
});

test("omnirouteRequest: timeout produces timed-out message (not cancelled)", async (t) => {
  const { restore } = installFetch(async () => {
    await new Promise((r) => setTimeout(r, 500));
    return jsonResponse(200, {});
  });
  t.after(restore);
  const res = (await omnirouteRequest("/search", {}, { ...OPTS, timeoutMs: 20 })) as Extract<OmnirouteResult, { ok: false }>;
  assert.equal(res.ok, false);
  assert.match(res.message, /timed out after 20ms/);
  assert.notEqual(res.cancelled, true);
});

test("omnirouteRequest: user abort -> cancelled result", async (t) => {
  const { restore } = installFetch(async () => {
    await new Promise((r) => setTimeout(r, 500));
    return jsonResponse(200, {});
  });
  t.after(restore);
  const ac = new AbortController();
  ac.abort();
  const res = (await omnirouteRequest("/search", {}, { ...OPTS, signal: ac.signal })) as Extract<OmnirouteResult, { ok: false }>;
  assert.equal(res.cancelled, true);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- test/tools-http.test.ts`
Expected: FAIL（`omnirouteRequest is not a function`）

- [ ] **Step 3: 实现 `omnirouteRequest`**

`src/tools/http.ts` 追加：

```ts
export type OmnirouteResult =
  | { ok: true; text: string; json?: unknown }
  | { ok: false; status: number; message: string; cancelled?: boolean };

export type OmnirouteRequestOptions = {
  apiKey: string;
  baseUrl: string;
  signal?: AbortSignal;
  timeoutMs: number;
};

export async function omnirouteRequest(
  path: string,
  body: unknown,
  opts: OmnirouteRequestOptions,
): Promise<OmnirouteResult> {
  const url = `${opts.baseUrl.replace(/\/+$/, "")}${path}`;

  let signal: AbortSignal | undefined = opts.signal;
  let timer: NodeJS.Timeout | undefined;
  const controller = new AbortController();
  if (typeof AbortSignal.any === "function") {
    const signals: AbortSignal[] = [AbortSignal.timeout(opts.timeoutMs)];
    if (opts.signal) signals.push(opts.signal);
    signal = AbortSignal.any(signals);
  } else {
    // 旧 Node 回退：手动 timer + controller
    timer = setTimeout(() => controller.abort(), opts.timeoutMs);
    opts.signal?.addEventListener("abort", () => controller.abort(), { once: true });
    signal = controller.signal;
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
      signal,
    });
    const text = await res.text();
    if (res.ok) {
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        // 非 JSON 响应（如 screenshot 二进制）——json 置空，走 text 兜底
      }
      return { ok: true, text, json };
    }
    let message = `OmniRoute ${path} failed: ${res.status}`;
    try {
      const err = JSON.parse(text) as { error?: unknown; message?: unknown; detail?: unknown };
      const detail =
        typeof err.error === "string"
          ? err.error
          : typeof err.message === "string"
            ? err.message
            : typeof err.detail === "string"
              ? err.detail
              : undefined;
      if (detail) message += ` (${detail})`;
    } catch {
      // 非 JSON 错误体——仅保留状态码
    }
    return { ok: false, status: res.status, message };
  } catch (err) {
    if (timer) clearTimeout(timer);
    if (err instanceof Error && err.name === "AbortError") {
      if (opts.signal?.aborted) {
        return { ok: false, status: 0, message: "cancelled", cancelled: true };
      }
      return { ok: false, status: 0, message: `OmniRoute ${path} timed out after ${opts.timeoutMs}ms` };
    }
    const reason = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 0, message: `Cannot reach OmniRoute at ${opts.baseUrl}: ${reason}` };
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- test/tools-http.test.ts`
Expected: PASS（全部测试，含任务 1 的 5 个）

- [ ] **Step 5: 提交**

```bash
git add src/tools/http.ts test/tools-http.test.ts
git commit -m "feat(tools): add omnirouteRequest with timeout, abort and error contract"
```

---

## Task 3: search schema + `buildSearchBody`

**Files:**
- Create: `src/tools/search.ts`（本次：常量、schema、`buildSearchBody`）
- Test: `test/tools-search.test.ts`（本次：schema 与 body 相关）

**Interfaces:**
- Consumes: 无（纯定义）
- Produces: `SEARCH_PROVIDERS`、`searchParamsSchema`（`Static` → `SearchToolParams`）、`buildSearchBody(params)`（任务 5 依赖）

- [ ] **Step 1: 写失败测试**

`test/tools-search.test.ts`：

```ts
// test/tools-search.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSearchBody, searchParamsSchema } from "../src/tools/search.ts";
import type { SearchToolParams } from "../src/tools/search.ts";

test("buildSearchBody: minimal params get explicit defaults, no timeoutMs", () => {
  const body = buildSearchBody({ query: "pi agent" });
  assert.deepEqual(body, {
    query: "pi agent",
    max_results: 5,
    search_type: "web",
    offset: 0,
    strict_filters: false,
  });
  assert.ok(!("timeoutMs" in body));
});

test("buildSearchBody: passes through optional fields when present", () => {
  const body = buildSearchBody({
    query: "pi",
    provider: "tavily-search",
    max_results: 10,
    search_type: "news",
    offset: 5,
    country: "CN",
    language: "zh",
    time_range: "day",
    filters: { include_domains: ["example.com"], safe_search: "strict" },
    strict_filters: true,
    timeoutMs: 60_000,
  });
  assert.equal(body.provider, "tavily-search");
  assert.equal(body.max_results, 10);
  assert.equal(body.search_type, "news");
  assert.deepEqual(body.filters, { include_domains: ["example.com"], safe_search: "strict" });
  assert.ok(!("timeoutMs" in body));
});

test("searchParamsSchema: provider enum rejects unknown value", async () => {
  const { Value } = await import("@sinclair/typebox/value");
  const ok = Value.Check(searchParamsSchema, { query: "pi", provider: "nope-search" });
  assert.equal(ok, false);
});

test("searchParamsSchema: additionalProperties rejected at top level", async () => {
  const { Value } = await import("@sinclair/typebox/value");
  const ok = Value.Check(searchParamsSchema, { query: "pi", bogus: 1 });
  assert.equal(ok, false);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- test/tools-search.test.ts`
Expected: FAIL（模块不存在 / `searchParamsSchema is not a function`）

- [ ] **Step 3: 实现 schema 与 `buildSearchBody`**

`src/tools/search.ts`：

```ts
// src/tools/search.ts
import { Type, type Static } from "@sinclair/typebox";

export const SEARCH_PROVIDERS = [
  "serper-search",
  "brave-search",
  "perplexity-search",
  "exa-search",
  "tavily-search",
  "firecrawl",
  "google-pse-search",
  "linkup-search",
  "ollama-search",
  "searchapi-search",
  "youcom-search",
  "searxng-search",
  "zai-search",
  "duckduckgo-free",
] as const;
export const SEARCH_TYPES = ["web", "news"] as const;
export const TIME_RANGES = ["any", "hour", "day", "week", "month", "year"] as const;

function stringEnum<T extends readonly string[]>(values: T) {
  return Type.Union(values.map((v) => Type.Literal(v)));
}

export const searchParamsSchema = Type.Object(
  {
    query: Type.String({ minLength: 1, maxLength: 500 }),
    provider: Type.Optional(stringEnum(SEARCH_PROVIDERS)),
    max_results: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
    search_type: Type.Optional(stringEnum(SEARCH_TYPES)),
    offset: Type.Optional(Type.Integer({ minimum: 0 })),
    country: Type.Optional(Type.String({ maxLength: 2 })),
    language: Type.Optional(Type.String({ minLength: 2, maxLength: 5 })),
    time_range: Type.Optional(stringEnum(TIME_RANGES)),
    content: Type.Optional(
      Type.Object(
        {
          snippet: Type.Optional(Type.Boolean()),
          full_page: Type.Optional(Type.Boolean()),
          format: Type.Optional(stringEnum(["text", "markdown"])),
          max_characters: Type.Optional(Type.Integer({ minimum: 100, maximum: 100000 })),
        },
        { additionalProperties: false },
      ),
    ),
    filters: Type.Optional(
      Type.Object(
        {
          include_domains: Type.Optional(Type.Array(Type.String({ maxLength: 253 }), { maxItems: 20 })),
          exclude_domains: Type.Optional(Type.Array(Type.String({ maxLength: 253 }), { maxItems: 20 })),
          safe_search: Type.Optional(stringEnum(["off", "moderate", "strict"])),
        },
        { additionalProperties: false },
      ),
    ),
    synthesis: Type.Optional(
      Type.Object(
        {
          strategy: Type.Optional(stringEnum(["none", "auto", "provider", "internal"])),
          model: Type.Optional(Type.String()),
          max_tokens: Type.Optional(Type.Integer({ minimum: 1, maximum: 4000 })),
        },
        { additionalProperties: false },
      ),
    ),
    provider_options: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    strict_filters: Type.Optional(Type.Boolean()),
    timeoutMs: Type.Optional(Type.Integer({ minimum: 1000, maximum: 120000 })),
  },
  { additionalProperties: false },
);
export type SearchToolParams = Static<typeof searchParamsSchema>;

export function buildSearchBody(params: SearchToolParams): Record<string, unknown> {
  const body: Record<string, unknown> = {
    query: params.query,
    max_results: params.max_results ?? 5,
    search_type: params.search_type ?? "web",
    offset: params.offset ?? 0,
    strict_filters: params.strict_filters ?? false,
  };
  const passthrough = [
    "provider",
    "country",
    "language",
    "time_range",
    "content",
    "filters",
    "synthesis",
    "provider_options",
  ] as const;
  for (const key of passthrough) {
    const value = params[key];
    if (value !== undefined) body[key] = value;
  }
  return body;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- test/tools-search.test.ts`
Expected: PASS。若 `@sinclair/typebox/value` 的 `Value.Check` 行为与断言不符（例如 `Type.Integer` 对 number 的判定），修正测试断言而非 schema——schema 以服务端 `v1SearchSchema` 为准。

- [ ] **Step 5: 提交**

```bash
git add src/tools/search.ts test/tools-search.test.ts
git commit -m "feat(tools): add web search params schema and body builder"
```

---

## Task 4: `formatSearchResults`（搜索结果格式化与截断）

**Files:**
- Modify: `src/tools/search.ts`（追加）
- Test: `test/tools-search.test.ts`（追加）

**Interfaces:**
- Consumes: 无（纯函数，输入为 `omnirouteRequest` 返回的 `json`）
- Produces: `formatSearchResults(json: unknown, query: string): string`（任务 5 依赖）

- [ ] **Step 1: 写失败测试**

`test/tools-search.test.ts` 追加：

```ts
import { formatSearchResults } from "../src/tools/search.ts";

test("formatSearchResults: formats title/url/snippet per result", () => {
  const json = {
    results: [
      { title: "Pi Agent", url: "https://pi.dev", snippet: "Coding agent" },
      { title: "GitHub", url: "https://github.com", snippet: "Hosting" },
    ],
  };
  const text = formatSearchResults(json, "pi agent");
  assert.match(text, /1\. Pi Agent/);
  assert.match(text, /URL: https:\/\/pi\.dev/);
  assert.match(text, /Coding agent/);
  assert.match(text, /2\. GitHub/);
  assert.match(text, /URL: https:\/\/github\.com/);
});

test("formatSearchResults: skips missing optional fields without throwing", () => {
  const json = { results: [{ title: "Only Title" }] };
  const text = formatSearchResults(json, "q");
  assert.match(text, /1\. Only Title/);
  assert.ok(!/undefined/.test(text));
});

test("formatSearchResults: truncates at result boundary over 20000 chars", () => {
  const longSnippet = "x".repeat(20_000);
  const json = {
    results: [
      { title: "A", url: "https://a", snippet: longSnippet },
      { title: "B", url: "https://b", snippet: "short" },
      { title: "C", url: "https://c", snippet: "short" },
    ],
  };
  const text = formatSearchResults(json, "q");
  assert.ok(text.length <= 20_000 + 200); // 硬上限 + 截断提示余量
  assert.match(text, /truncated: 2 of 3 results omitted/);
  assert.ok(!text.includes("1. B")); // 第 2 条在条目边界被截掉
});

test("formatSearchResults: raw JSON fallback when results missing", () => {
  const json = { weird: "shape" };
  const text = formatSearchResults(json, "q");
  assert.match(text, /weird/);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- test/tools-search.test.ts`
Expected: FAIL（`formatSearchResults is not a function`）

- [ ] **Step 3: 实现 `formatSearchResults`**

`src/tools/search.ts` 追加：

```ts
const SEARCH_RESULT_LIMIT = 20_000;

export function formatSearchResults(json: unknown, query: string): string {
  if (json && typeof json === "object" && Array.isArray((json as { results?: unknown }).results)) {
    const results = (json as { results: Array<Record<string, unknown>> }).results;
    const blocks: string[] = [];
    let total = 0;
    for (let i = 0; i < results.length; i++) {
      const r = results[i] ?? {};
      const lines = [`${i + 1}. ${typeof r.title === "string" && r.title ? r.title : "(untitled)"}`];
      if (typeof r.url === "string" && r.url) lines.push(`   URL: ${r.url}`);
      if (typeof r.snippet === "string" && r.snippet) lines.push(`   ${r.snippet}`);
      const block = lines.join("\n");
      if (total + block.length + 1 > SEARCH_RESULT_LIMIT && blocks.length > 0) {
        blocks.push(`[truncated: ${results.length - blocks.length} of ${results.length} results omitted]`);
        break;
      }
      blocks.push(block);
      total += block.length + 1;
    }
    if (blocks.length > 0) return blocks.join("\n\n");
    return `No results for query: ${query}`;
  }
  return JSON.stringify(json).slice(0, SEARCH_RESULT_LIMIT);
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- test/tools-search.test.ts`
Expected: PASS。注意"truncates at result boundary"断言依赖顺序：第一条 20k 片段本身接近上限，追加第 2 条时触发边界截断，提示为 `2 of 3`。若实现与断言不符，先检查边界条件（`>` 与 `blocks.length > 0`）再调测试。

- [ ] **Step 5: 提交**

```bash
git add src/tools/search.ts test/tools-search.test.ts
git commit -m "feat(tools): add search result formatting with boundary truncation"
```

---

## Task 5: `omniroute_web_search` 工具定义

**Files:**
- Modify: `src/tools/search.ts`（追加工具定义）
- Test: `test/tools-search.test.ts`（追加 execute 集成测试）

**Interfaces:**
- Consumes: Task 1 `resolveApiKey`/`resolveBaseUrl`；Task 2 `omnirouteRequest`；Task 3 schema/`buildSearchBody`；Task 4 `formatSearchResults`
- Produces: `searchTool`（`defineTool` 包裹；Task 8 注册）

- [ ] **Step 1: 写失败测试**

`test/tools-search.test.ts` 追加：

```ts
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { searchTool } from "../src/tools/search.ts";

function fakeCtx(apiKey: string | undefined, baseUrl?: string): ExtensionContext {
  return {
    model: baseUrl ? ({ provider: "omniroute", baseUrl } as ExtensionContext["model"]) : undefined,
    modelRegistry: { getApiKeyForProvider: async () => apiKey },
  } as unknown as ExtensionContext;
}

async function runSearch(
  params: unknown,
  ctx: ExtensionContext,
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>,
) {
  const original = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  if (fetchImpl) {
    globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return fetchImpl(String(url), init);
    }) as typeof fetch;
  } else {
    globalThis.fetch = (async () => {
      throw new Error("fetch should not be called");
    }) as typeof fetch;
  }
  try {
    const result = await searchTool.execute("call-1", params as never, undefined, undefined, ctx);
    return { result, calls };
  } finally {
    globalThis.fetch = original;
  }
}

test("searchTool: whitespace-only query -> error, no fetch", async () => {
  const { result, calls } = await runSearch({ query: "   " }, fakeCtx("key"));
  assert.equal(calls.length, 0);
  const text = (result.content as Array<{ type: string; text?: string }>)[0]?.text ?? "";
  assert.match(text, /query must be a non-empty/);
});

test("searchTool: missing api key -> guidance, no fetch", async () => {
  const { result, calls } = await runSearch({ query: "pi" }, fakeCtx(undefined));
  assert.equal(calls.length, 0);
  const text = (result.content as Array<{ type: string; text?: string }>)[0]?.text ?? "";
  assert.match(text, /\/login omniroute/);
});

test("searchTool: success formats results", async () => {
  const { result, calls } = await runSearch(
    { query: "pi" },
    fakeCtx("key", "http://localhost:20128/api/v1"),
    async () =>
      new Response(JSON.stringify({ results: [{ title: "Pi", url: "https://pi.dev", snippet: "s" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://localhost:20128/api/v1/search");
  const sentBody = JSON.parse(String(calls[0].init?.body));
  assert.equal(sentBody.query, "pi");
  assert.equal(sentBody.max_results, 5); // 默认值补齐
  const text = (result.content as Array<{ type: string; text?: string }>)[0]?.text ?? "";
  assert.match(text, /1\. Pi/);
});

test("searchTool: 429 propagates status", async () => {
  const { result } = await runSearch(
    { query: "pi" },
    fakeCtx("key"),
    async () => new Response(JSON.stringify({ error: "rate limited" }), { status: 429 }),
  );
  const text = (result.content as Array<{ type: string; text?: string }>)[0]?.text ?? "";
  assert.match(text, /429/);
});

test("searchTool: timeoutMs not sent in body", async () => {
  const { calls } = await runSearch(
    { query: "pi", timeoutMs: 60_000 },
    fakeCtx("key"),
    async () => new Response(JSON.stringify({ results: [] }), { status: 200 }),
  );
  const sentBody = JSON.parse(String(calls[0]?.init?.body));
  assert.ok(!("timeoutMs" in sentBody));
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- test/tools-search.test.ts`
Expected: FAIL（`searchTool is not a function`）

- [ ] **Step 3: 实现工具定义**

`src/tools/search.ts` 追加：

```ts
import { defineTool } from "@earendil-works/pi-coding-agent";
import type { ExtensionContext, AgentToolResult } from "@earendil-works/pi-coding-agent";
import { omnirouteRequest, resolveApiKey, resolveBaseUrl } from "./http.ts";

export const searchTool = defineTool({
  name: "omniroute_web_search",
  label: "OmniRoute Web Search",
  description:
    "Search the web or news via OmniRoute's configured search providers (Tavily, Brave, Exa, Serper, etc.). Returns ranked results with titles and URLs. Use for current events, fact lookup, and finding sources.",
  parameters: searchParamsSchema,
  prepareArguments(args: unknown): SearchToolParams {
    const a = args as { query?: unknown };
    if (typeof a.query === "string") return { ...args, query: a.query.trim() } as SearchToolParams;
    return args as SearchToolParams;
  },
  async execute(
    _toolCallId: string,
    params: SearchToolParams,
    signal: AbortSignal | undefined,
    _onUpdate: unknown,
    ctx: ExtensionContext,
  ): Promise<AgentToolResult> {
    const query = params.query.trim();
    if (query.length === 0) {
      return { content: [{ type: "text", text: "query must be a non-empty string" }] };
    }
    const apiKey = await resolveApiKey(ctx);
    if (!apiKey) {
      return {
        content: [
          {
            type: "text",
            text: "OmniRoute API key is not configured. Run /login omniroute or set OMNIROUTE_API_KEY.",
          },
        ],
      };
    }
    const baseUrl = resolveBaseUrl(ctx);
    const timeoutMs = params.timeoutMs ?? 30_000;
    const res = await omnirouteRequest("/search", buildSearchBody({ ...params, query }), {
      apiKey,
      baseUrl,
      signal,
      timeoutMs,
    });
    if (!res.ok) {
      return { content: [{ type: "text", text: res.cancelled ? "Search cancelled." : res.message }] };
    }
    return { content: [{ type: "text", text: formatSearchResults(res.json, query) }] };
  },
});
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- test/tools-search.test.ts`
Expected: PASS。若 `searchTool.execute` 的签名类型检查失败（`_onUpdate` 参数），确认 `AgentToolResult` / `AgentToolUpdateCallback` 的精确类型后微调标注，不要放宽 `ctx` 为 `any`。

- [ ] **Step 5: 提交**

```bash
git add src/tools/search.ts test/tools-search.test.ts
git commit -m "feat(tools): register omniroute_web_search tool"
```

---

## Task 6: web-fetch schema + `buildFetchBody` + `extractFetchContent`

**Files:**
- Create: `src/tools/web-fetch.ts`（本次：常量、schema、两个纯函数）
- Test: `test/tools-web-fetch.test.ts`（本次：schema 与纯函数）

**Interfaces:**
- Consumes: 无（纯定义）
- Produces: `FETCH_PROVIDERS`、`fetchParamsSchema`（`Static` → `FetchToolParams`）、`buildFetchBody(params)`、`extractFetchContent(json)`（任务 7 依赖）

- [ ] **Step 1: 写失败测试**

`test/tools-web-fetch.test.ts`：

```ts
// test/tools-web-fetch.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFetchBody, extractFetchContent, fetchParamsSchema } from "../src/tools/web-fetch.ts";
import type { FetchToolParams } from "../src/tools/web-fetch.ts";

test("buildFetchBody: minimal params get explicit defaults, no timeoutMs", () => {
  const body = buildFetchBody({ url: "https://example.com" });
  assert.deepEqual(body, {
    url: "https://example.com",
    format: "markdown",
    depth: 0,
    include_metadata: false,
  });
  assert.ok(!("timeoutMs" in body));
});

test("buildFetchBody: passes through optional fields", () => {
  const body = buildFetchBody({
    url: "https://example.com",
    provider: "firecrawl",
    format: "html",
    depth: 2,
    wait_for_selector: ".main",
    include_metadata: true,
    timeoutMs: 45_000,
  });
  assert.equal(body.provider, "firecrawl");
  assert.equal(body.format, "html");
  assert.equal(body.depth, 2);
  assert.equal(body.wait_for_selector, ".main");
  assert.ok(!("timeoutMs" in body));
});

test("fetchParamsSchema: invalid provider rejected", async () => {
  const { Value } = await import("@sinclair/typebox/value");
  assert.equal(Value.Check(fetchParamsSchema, { url: "https://x", provider: "nope" }), false);
});

test("fetchParamsSchema: invalid depth rejected", async () => {
  const { Value } = await import("@sinclair/typebox/value");
  assert.equal(Value.Check(fetchParamsSchema, { url: "https://x", depth: 7 }), false);
});

test("extractFetchContent: prefers content string, then markdown/html/text", () => {
  assert.equal(extractFetchContent({ content: "body" }), "body");
  assert.equal(extractFetchContent({ markdown: "# md" }), "# md");
  assert.equal(extractFetchContent({ html: "<p>h</p>" }), "<p>h</p>");
  assert.equal(extractFetchContent({ text: "plain" }), "plain");
});

test("extractFetchContent: object content field uses markdown/text", () => {
  assert.equal(extractFetchContent({ content: { markdown: "# obj" } }), "# obj");
  assert.equal(extractFetchContent({ content: { text: "obj text" } }), "obj text");
});

test("extractFetchContent: truncates over 40000 chars with notice", () => {
  const long = "y".repeat(50_000);
  const text = extractFetchContent({ markdown: long });
  assert.ok(text.length <= 40_000 + 100);
  assert.match(text, /truncated at 40000 chars/);
});

test("extractFetchContent: raw JSON fallback when nothing extractable", () => {
  const text = extractFetchContent({ weird: "shape" });
  assert.match(text, /weird/);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- test/tools-web-fetch.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

`src/tools/web-fetch.ts`：

```ts
// src/tools/web-fetch.ts
import { Type, type Static } from "@sinclair/typebox";

export const FETCH_PROVIDERS = ["firecrawl", "jina-reader", "tavily-search", "tinyfish"] as const;
export const FETCH_FORMATS = ["markdown", "html", "links", "screenshot"] as const;

function stringEnum<T extends readonly string[]>(values: T) {
  return Type.Union(values.map((v) => Type.Literal(v)));
}

export const fetchParamsSchema = Type.Object(
  {
    url: Type.String(),
    provider: Type.Optional(stringEnum(FETCH_PROVIDERS)),
    format: Type.Optional(stringEnum(FETCH_FORMATS)),
    depth: Type.Optional(Type.Union([Type.Literal(0), Type.Literal(1), Type.Literal(2)])),
    wait_for_selector: Type.Optional(Type.String({ maxLength: 256 })),
    include_metadata: Type.Optional(Type.Boolean()),
    timeoutMs: Type.Optional(Type.Integer({ minimum: 1000, maximum: 120000 })),
  },
  { additionalProperties: false },
);
export type FetchToolParams = Static<typeof fetchParamsSchema>;

export function buildFetchBody(params: FetchToolParams): Record<string, unknown> {
  const body: Record<string, unknown> = {
    url: params.url,
    format: params.format ?? "markdown",
    depth: params.depth ?? 0,
    include_metadata: params.include_metadata ?? false,
  };
  if (params.provider !== undefined) body.provider = params.provider;
  if (params.wait_for_selector !== undefined) body.wait_for_selector = params.wait_for_selector;
  return body;
}

const FETCH_CONTENT_LIMIT = 40_000;

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

export function extractFetchContent(json: unknown): string {
  if (json && typeof json === "object") {
    const obj = json as Record<string, unknown>;
    const content = obj.content;
    if (typeof content === "string") return truncate(content);
    if (content && typeof content === "object") {
      const inner = content as Record<string, unknown>;
      const innerText = asString(inner.markdown) ?? asString(inner.text);
      if (innerText !== undefined) return truncate(innerText);
    }
    for (const key of ["markdown", "html", "text"] as const) {
      const value = asString(obj[key]);
      if (value !== undefined) return truncate(value);
    }
  }
  return JSON.stringify(json).slice(0, FETCH_CONTENT_LIMIT);
}

function truncate(text: string): string {
  if (text.length <= FETCH_CONTENT_LIMIT) return text;
  return `${text.slice(0, FETCH_CONTENT_LIMIT)}\n\n[content truncated at ${FETCH_CONTENT_LIMIT} chars]`;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- test/tools-web-fetch.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/tools/web-fetch.ts test/tools-web-fetch.test.ts
git commit -m "feat(tools): add web fetch params schema, body builder and content extractor"
```

---

## Task 7: `omniroute_web_fetch` 工具定义

**Files:**
- Modify: `src/tools/web-fetch.ts`（追加工具定义）
- Test: `test/tools-web-fetch.test.ts`（追加 execute 集成测试）

**Interfaces:**
- Consumes: Task 1/2 的 http 模块；Task 6 的 schema/纯函数
- Produces: `webFetchTool`（`defineTool` 包裹；Task 8 注册）

- [ ] **Step 1: 写失败测试**

`test/tools-web-fetch.test.ts` 追加：

```ts
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { webFetchTool } from "../src/tools/web-fetch.ts";

function fakeCtx(apiKey: string | undefined, baseUrl?: string): ExtensionContext {
  return {
    model: baseUrl ? ({ provider: "omniroute", baseUrl } as ExtensionContext["model"]) : undefined,
    modelRegistry: { getApiKeyForProvider: async () => apiKey },
  } as unknown as ExtensionContext;
}

async function runFetch(
  params: unknown,
  ctx: ExtensionContext,
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>,
) {
  const original = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  if (fetchImpl) {
    globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return fetchImpl(String(url), init);
    }) as typeof fetch;
  } else {
    globalThis.fetch = (async () => {
      throw new Error("fetch should not be called");
    }) as typeof fetch;
  }
  try {
    const result = await webFetchTool.execute("call-1", params as never, undefined, undefined, ctx);
    return { result, calls };
  } finally {
    globalThis.fetch = original;
  }
}

test("webFetchTool: invalid URL -> error, no fetch", async () => {
  const { result, calls } = await runFetch({ url: "not-a-url" }, fakeCtx("key"));
  assert.equal(calls.length, 0);
  const text = (result.content as Array<{ type: string; text?: string }>)[0]?.text ?? "";
  assert.match(text, /url must be a valid http\(s\) URL/);
});

test("webFetchTool: non-http protocol -> error, no fetch", async () => {
  const { result, calls } = await runFetch({ url: "ftp://example.com/file" }, fakeCtx("key"));
  assert.equal(calls.length, 0);
  const text = (result.content as Array<{ type: string; text?: string }>)[0]?.text ?? "";
  assert.match(text, /url must be an http\(s\) URL/);
});

test("webFetchTool: missing api key -> guidance, no fetch", async () => {
  const { result, calls } = await runFetch({ url: "https://example.com" }, fakeCtx(undefined));
  assert.equal(calls.length, 0);
  const text = (result.content as Array<{ type: string; text?: string }>)[0]?.text ?? "";
  assert.match(text, /\/login omniroute/);
});

test("webFetchTool: success returns extracted content", async () => {
  const { result, calls } = await runFetch(
    { url: "https://example.com" },
    fakeCtx("key", "http://localhost:20128/api/v1"),
    async () =>
      new Response(JSON.stringify({ markdown: "# Hello" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://localhost:20128/api/v1/web/fetch");
  const sentBody = JSON.parse(String(calls[0].init?.body));
  assert.equal(sentBody.format, "markdown"); // 默认值补齐
  assert.equal(sentBody.depth, 0);
  const text = (result.content as Array<{ type: string; text?: string }>)[0]?.text ?? "";
  assert.match(text, /# Hello/);
});

test("webFetchTool: 401 propagates status", async () => {
  const { result } = await runFetch(
    { url: "https://example.com" },
    fakeCtx("key"),
    async () => new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }),
  );
  const text = (result.content as Array<{ type: string; text?: string }>)[0]?.text ?? "";
  assert.match(text, /401/);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- test/tools-web-fetch.test.ts`
Expected: FAIL（`webFetchTool is not a function`）

- [ ] **Step 3: 实现工具定义**

`src/tools/web-fetch.ts` 追加：

```ts
import { defineTool } from "@earendil-works/pi-coding-agent";
import type { ExtensionContext, AgentToolResult } from "@earendil-works/pi-coding-agent";
import { omnirouteRequest, resolveApiKey, resolveBaseUrl } from "./http.ts";

export const webFetchTool = defineTool({
  name: "omniroute_web_fetch",
  label: "OmniRoute Web Fetch",
  description:
    "Fetch and extract content from a URL via OmniRoute's configured web-fetch providers (Firecrawl, Jina Reader, Tavily Extract, TinyFish). Returns the page content as markdown by default.",
  parameters: fetchParamsSchema,
  async execute(
    _toolCallId: string,
    params: FetchToolParams,
    signal: AbortSignal | undefined,
    _onUpdate: unknown,
    ctx: ExtensionContext,
  ): Promise<AgentToolResult> {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(params.url);
    } catch {
      return { content: [{ type: "text", text: "url must be a valid http(s) URL" }] };
    }
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      return { content: [{ type: "text", text: "url must be an http(s) URL" }] };
    }
    const apiKey = await resolveApiKey(ctx);
    if (!apiKey) {
      return {
        content: [
          {
            type: "text",
            text: "OmniRoute API key is not configured. Run /login omniroute or set OMNIROUTE_API_KEY.",
          },
        ],
      };
    }
    const baseUrl = resolveBaseUrl(ctx);
    const timeoutMs = params.timeoutMs ?? 30_000;
    const res = await omnirouteRequest("/web/fetch", buildFetchBody(params), {
      apiKey,
      baseUrl,
      signal,
      timeoutMs,
    });
    if (!res.ok) {
      return { content: [{ type: "text", text: res.cancelled ? "Fetch cancelled." : res.message }] };
    }
    return { content: [{ type: "text", text: extractFetchContent(res.json) }] };
  },
});
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- test/tools-web-fetch.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/tools/web-fetch.ts test/tools-web-fetch.test.ts
git commit -m "feat(tools): register omniroute_web_fetch tool"
```

---

## Task 8: 注册工具 + 回归验证 + 文档

**Files:**
- Modify: `src/index.ts`（注册两个工具）
- Modify: `test/lazy-fetch.test.ts`（`mockPi()` 增加 `registerTool` 桩）
- Modify: `docs/roadmap.md`（标记工具已实现）

**Interfaces:**
- Consumes: Task 5 `searchTool`、Task 7 `webFetchTool`
- Produces: 可运行的扩展（启动即注册两个工具）

- [ ] **Step 1: 写失败测试（注册不抛错）**

`test/lazy-fetch.test.ts` 的 `mockPi()` 修改为：

```ts
function mockPi(): ExtensionAPI {
  return {
    registerProvider(p: Provider) {
      capturedProvider = p as Provider<"openai-completions">;
    },
    registerTool() {
      // 桩：扩展工厂注册工具不应影响现有 provider 测试
    },
  } as unknown as ExtensionAPI;
}
```

追加一个注册冒烟测试：

```ts
test("extension factory registers both web tools without throwing", async () => {
  await entry(mockPi() as unknown as Parameters<typeof entry>[0]);
  assert.ok(capturedProvider, "provider still registered");
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- test/lazy-fetch.test.ts`
Expected: 现有 5 个测试仍 PASS（工厂内 try/catch 吞掉 `registerTool` 的 TypeError 并 warn，不影响 provider 注册断言）。本步的真实变化在 Step 3：mockPi 增加 `registerTool` 桩后控制台无 warn、mockPi 成为合法 `ExtensionAPI`；新增冒烟测试断言注册不抛错且 provider 仍被注册。

- [ ] **Step 3: 实现注册**

`src/index.ts` 追加导入与注册（`pi.registerProvider(provider)` 之后）：

```ts
import { searchTool } from "./tools/search.ts";
import { webFetchTool } from "./tools/web-fetch.ts";

export default async function (pi: ExtensionAPI) {
  // ...现有 provider 注册不变...

  for (const tool of [searchTool, webFetchTool]) {
    try {
      pi.registerTool(tool);
    } catch (err) {
      console.warn(`[omniroute] failed to register tool ${tool.name}:`, err);
    }
  }
}
```

- [ ] **Step 4: 运行全部测试 + 类型检查**

Run: `npm test`
Expected: PASS（既有 auth/url/lazy-fetch 测试 + 三个新测试文件全部通过）

Run: `npm run typecheck`
Expected: 无错误

- [ ] **Step 5: 更新文档**

`docs/roadmap.md`：在 Phase 2 之后新增小节，例如：

```markdown
### Web 搜索/抓取工具（已实现，add-search-fetch-tools）

- `omniroute_web_search`：封装 `POST /api/v1/search`，参数镜像 `v1SearchSchema`。
- `omniroute_web_fetch`：封装 `POST /api/v1/web/fetch`，参数镜像 `v1WebFetchSchema`。
- 认证复用 omniroute provider 凭据；支持 `timeoutMs` 参数（默认 30s）。
```

- [ ] **Step 6: 提交**

```bash
git add src/index.ts test/lazy-fetch.test.ts docs/roadmap.md
git commit -m "feat(tools): register web search and fetch tools at extension startup"
```

---

## 自审结果（计划编写时执行）

**Spec 覆盖：** 逐条核对 `specs/web-search-tool/spec.md` 与 `specs/web-fetch-tool/spec.md` 的全部需求/场景：

| spec 场景 | 对应任务 |
|---|---|
| search 注册/路径/Content-Type | Task 5（execute 集成断言）+ Task 8 |
| search 最小参数请求体 | Task 3（`buildSearchBody`）+ Task 5 |
| search 空 query 拒绝 | Task 5（execute 防御校验 + prepareArguments trim）|
| search Bearer 头 | Task 2（`omnirouteRequest` 断言）|
| search 无 key 指引 | Task 5 |
| search 返回结果列表 | Task 4 + Task 5 |
| search 超长截断 | Task 4（条目边界 20k）|
| search 429 透传 | Task 2 + Task 5 |
| search 服务不可达 | Task 2（`Cannot reach`）|
| fetch 注册/路径 | Task 7 + Task 8 |
| fetch 最小参数请求体 | Task 6 + Task 7 |
| fetch 非法 URL / provider 拒绝 | Task 7（`new URL` 校验）/ Task 6（enum schema）|
| fetch Bearer 头 | Task 2（共用）|
| fetch 无 key 指引 | Task 7 |
| fetch 成功返回正文 | Task 6（`extractFetchContent`）+ Task 7 |
| fetch 正文超长截断 | Task 6（40k）|
| fetch 401 透传 | Task 2 + Task 7 |
| fetch 服务不可达 | Task 2（共用）|

**占位符扫描：** 无 TBD/TODO；所有代码步骤含完整可粘贴代码。

**类型一致性：** `OmnirouteResult` / `resolveApiKey` / `resolveBaseUrl` / `omnirouteRequest` 签名在 http.ts（Task 1/2）定义后，Task 5/7/8 使用完全一致；`SearchToolParams`（Task 3）被 Task 5 消费；`FetchToolParams`（Task 6）被 Task 7 消费；`searchTool`/`webFetchTool`（Task 5/7）被 Task 8 注册。`stringEnum` 辅助在 Task 3 与 Task 6 各自文件内定义（不同模块，无冲突）。

---

## 执行交接

计划已保存至 `openspec/changes/add-search-fetch-tools/superpower-plan.md`（base-ref `f49a2300d15b3d78529a5dd05681b40c9fb4f835`）。两种执行方式：

**1. Subagent-Driven（推荐）** — 每个任务派发独立 subagent，任务间审查，快速迭代
**2. Inline Execution** — 本会话内用 executing-plans 批量执行，带检查点审查

本变更的推荐入口：运行 **`/opsx-sp-apply`** 进入开发。

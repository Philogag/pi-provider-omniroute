# pi-provider-omniroute

> **简体中文**：[中文文档](README.zh-CN.md) · **English**：[README](README.md)

> Play on [Pi Agent](https://pi.dev) with [OmniRoute](https://github.com/diegosouzapw/OmniRoute) easily.

`pi-provider-omniroute` is a extention for Pi-Agent.  

It registers OmniRoute as a custom model provider for Pi Agent, and exposes more features from OmniRoute to Pi Agent.

> OmniRoute is a local-first AI API proxy/router. Pi is a terminal coding agent. This extension connects the two: you point Pi at your running OmniRoute instance, and Pi can chat with any routed model and call search/fetch tools without extra wiring.

## Features

- **Provider**
  - **OpenAI-compatible chat provider** — registers OmniRoute under the `omniroute` provider id, streams chat completions, and supports tool calling.
  - **Interactive login** — `/login omniroute` follows Pi's standard API-key flow and prompts for the API key only; the key can also come from the `OMNIROUTE_API_KEY` env var. The base URL is configured separately (see [Configuration](#configuration)).
  - **Auto-imported models** — at startup, fetches `GET /v1/models` and registers every routed model (e.g. `openai/gpt-4o`) as a Pi model.
  - **Lazy model refresh** — model list is fetched on demand, not eagerly on extension load, so Pi starts even if OmniRoute is offline.
- **Settings**
  - **`/omniroute-settings` TUI menu** — a two-level interactive menu: pick a default **Search provider** (from the live catalog with a static fallback) or **Web Fetch provider** (firecrawl / jina-reader / tavily-search / tinyfish), with a `✓` marker on the active provider in each submenu, or edit the **Base URL** in a small editor (Enter saves, empty input resets to the default, Esc cancels).
  - **Persistent config** — choices are saved to the `pi-provider-omniroute` block of the pi-global `settings.json` (`baseUrl` / `search.provider` / `fetch.provider`) and re-loaded on every session start.
- **Tool**
  - **`omniroute_web_search` tool** — wraps `POST /v1/search` with 14 search providers, 2 search types, 7 time ranges, country/language filters, and rich content extraction options.
  - **`omniroute_web_fetch` tool** — wraps `POST /v1/web/fetch` with 4 fetch providers (Firecrawl, Jina Reader, Tavily Extract, TinyFish), 4 output formats, depth, and selector wait.
  - **Configurable default provider** — both tools merge their `provider` param with the configured default at execution time (explicit param > configured provider > omit), so you can pin a default provider in `/omniroute-settings` without changing how the model calls the tools.
- **Cost telemetry** — real USD costs from OmniRoute's `X-OmniRoute-*` telemetry are written into Pi's usage/cost statistics, with full telemetry attached to each message's `diagnostics`.

## Requirements

- A running OmniRoute instance reachable from Pi
- Pi Agent ≥ 0.83

## Installation

```bash
pi install npm:@philogag/pi-provider-omniroute
```

> Development builds from source:
> `pi install git:github.com/Philogag/pi-provider-omniroute`

Then connect into your OmniRoute instance with `/login omniroute` and paste your API KEY (the only thing it asks for).

> Get the "OmniRoute base URL" from your OmniRoute Dashboard  
> -> "Endpoints" -> "API Endpoint" -> "Public"  
> Which should looks like "http://localhost:20128/v1"  
>
> The base URL is no longer part of `/login` — configure it via `/omniroute-settings` → **Base URL**, or edit the `pi-provider-omniroute` block of `~/.pi/agent/settings.json` directly (see [Configuration](#configuration)).

## Configuration

### 1. Base URL

The default is `http://localhost:20128/v1`. All of OmniRoute's OpenAI-compatible endpoints live under this prefix (`openai-completions` appends `/chat/completions`).

The base URL is managed from the **Base URL** entry of the `/omniroute-settings` menu, or by editing the `baseUrl` field of the `pi-provider-omniroute` block in `$PI_AGENT_DIR/settings.json` (or `~/.pi/agent/settings.json`) directly:

```json
{
  "pi-provider-omniroute": { "baseUrl": "https://your-host/v1" }
}
```

Resolution priority (highest first):

1. `baseUrl` in the `pi-provider-omniroute` block of `settings.json`
2. `OMNIROUTE_BASE_URL` env var
3. Default `http://localhost:20128/v1`

In the Base URL editor, type a new URL and press Enter to save; press Enter with an empty input to reset to the default; press Escape to cancel. When the extension reads or writes the block it preserves the other keys of `settings.json` (e.g. `packages`, `theme`).

### 2. API key

`/login omniroute` follows Pi's standard API-key flow and prompts for the API key only (it no longer asks for a base URL). The key is resolved in this order:

1. Stored credentials in Pi's `auth.json` (`$PI_AGENT_DIR/auth.json` or `~/.pi/agent/auth.json`)
2. `OMNIROUTE_API_KEY` env var

### 3. One-time migration of legacy config

Two legacy leftovers are migrated automatically into the `pi-provider-omniroute` block of `settings.json` at startup — no manual action needed:

- The old `omniroute.json` (`$PI_AGENT_DIR/omniroute.json`, holding `baseUrl` / `search` / `fetch`); the file is deleted after a successful migration.
- The `OMNIROUTE_BASE_URL` stored inside the old `auth.json` credential (base URL only).

Users who configured a custom base URL in a previous version will see it preserved automatically.

## Default tool providers

Both tools send their requests without a `provider` field unless one is explicitly given by the model. To pin a default provider for every call, use the built-in settings menu:

> **Note:** `/omniroute-settings` is a TUI-only command. It is registered only
> when Pi runs in interactive TUI mode — in `print` / `json` / `rpc` sessions
> the command does not exist (configure via `$PI_AGENT_DIR/settings.json`
> instead, see [Configuration](#configuration)).

```text
/omniroute-settings
```

This opens an interactive TUI menu (top-level → submenu) with the currently enabled provider marked with `✓`. Selections are persisted to the `pi-provider-omniroute` block of the pi-global config file at `$PI_AGENT_DIR/settings.json` (or `~/.pi/agent/settings.json`):

```json
{
  "pi-provider-omniroute": {
    "baseUrl": "http://localhost:20128/v1",
    "search": { "provider": "tavily-search" },
    "fetch": { "provider": "jina-reader" }
  }
}
```

At execution time each tool resolves its provider as **explicit param > configured default > omit** — e.g. with the config above, `omniroute_web_search` without a `provider` param uses `tavily-search`, and `omniroute_web_fetch` without one uses `jina-reader`. Pick `auto` in the menu to clear the stored provider and fall back to the server default.

### Cost telemetry

OmniRoute reports per-request cost data as SSE comment lines at the end of every streaming response body (`: x-omniroute-*`). The extension intercepts the byte stream, parses those lines, and wires the result into Pi's accounting:

- **Real costs in Pi's usage statistics** — `X-OmniRoute-Response-Cost` (a fixed-point USD amount, e.g. `0.0000190400`) overwrites each message's `usage.cost.total`, so Pi's cost/usage totals reflect what OmniRoute actually billed instead of the model's static price. Token counts are kept as parsed by Pi.
- **Cache hits bill at $0** — when `X-OmniRoute-Cache-Hit` is `true`, OmniRoute reports a `Response-Cost` of `0`; the extension applies it as-is, so cached turns show a cost of `0`.
- **Full telemetry in `diagnostics`** — every message carries a `omniroute-telemetry` diagnostic with `model`, `provider`, `tokensIn`, `tokensOut`, `cacheHit`, `responseCost`, and `latencyMs`, so you can inspect routing details for any turn.

The capture is best-effort and byte-transparent: if telemetry is absent (older OmniRoute, non-OmniRoute responses), the stream passes through untouched and Pi falls back to its static pricing.

## Development

```bash
# Type-check
npm run typecheck

# Run tests (Node's built-in test runner, no extra deps)
npm test
```

The test suite uses Node's `--experimental-strip-types` and exercises auth flows, URL validation, lazy model fetching, and both tools. No network access is required.

### Project layout

```text
src/
  index.ts              # Extension entry: registerProvider + registerTool
  auth.ts               # URL validation + API-key auth
  auth-credentials.ts   # Stored-credential resolution from auth.json
  tools/
    http.ts             # Shared HTTP helper, credential resolver, error contract
    search.ts           # omniroute_web_search
    web-fetch.ts        # omniroute_web_fetch
    search-config.ts    # /omniroute-settings menu state machine + settings.json block persistence
test/                   # Mirrors src/ layout
docs/
  roadmap.md            # Long-term plan (phases 1–4)
  omniroute-openapi.yaml # Vendored OmniRoute v3.8.50 OpenAPI spec
openspec/               # Spec-driven change tracking
```

## Roadmap

This extension follows a phased plan. See [`docs/roadmap.md`](docs/roadmap.md) for full detail.

- **Phase 1 ✅** OpenAI-compatible provider + auto-imported models + lazy fetch.
- **Phase 2 🚧** Wrap core admin endpoints as tools: `omniroute_providers_*`, `omniroute_models_*`, `omniroute_keys_*`, `omniroute_usage_*`, `omniroute_combos_*`, `omniroute_fallback_*`, `omniroute_telemetry_*`. Search/fetch shipped under `add-search-fetch-tools`.
- **Phase 3** Memory, compression, settings/pricing, CLI/embedded services.
- **Phase 4** Cost/usage display via `X-OmniRoute-*` response headers, dynamic skill discovery from `/api/agent-skills`, model metadata enrichment from `/api/models/catalog` and `/api/pricing/models`.

## License

MIT. See [`LICENSE`](LICENSE).

## Acknowledgements

- [OmniRoute](https://github.com/diegosouzapw/OmniRoute) by diegosouzapw — the proxy this extension targets.
- [Pi Agent](https://pi.dev) by earendil-works — the host agent runtime.

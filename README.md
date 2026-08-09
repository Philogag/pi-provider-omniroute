# pi-provider-omniroute

> **简体中文**：[中文文档](README.zh-CN.md) · **English**：[README](README.md)

> Play on [Pi Agent](https://pi.dev) with [OmniRoute](https://github.com/diegosouzapw/OmniRoute) easily.

`pi-provider-omniroute` is a extention for Pi-Agent.  

It registers OmniRoute as a custom model provider for Pi Agent, and exposes more features from OmniRoute to Pi Agent.

> OmniRoute is a local-first AI API proxy/router. Pi is a terminal coding agent. This extension connects the two: you point Pi at your running OmniRoute instance, and Pi can chat with any routed model and call search/fetch tools without extra wiring.

## Features

- **Provider**
  - **OpenAI-compatible chat provider** — registers OmniRoute under the `omniroute` provider id with a **static model list** (fetched once from `GET /v1/models` at startup; degraded to an empty list with a warning if OmniRoute is unreachable), streams chat completions, and supports tool calling.
  - **Standard stored credentials** — the API key comes from Pi's normal `/login` credential store (no custom auth flow), so key handling follows Pi's own security model.
  - **Configurable base URL** — the server URL is resolved from `omniroute.json` → `$OMNIROUTE_BASE_URL` → `http://localhost:20128/v1`, and can be edited interactively from `/omniroute-settings`.
- **Settings**
  - **`/omniroute-settings` TUI menu** — a three-level interactive menu: pick a default **Search provider** (from the live catalog with a static fallback), a default **Web Fetch provider** (firecrawl / jina-reader / tavily-search / tinyfish), or edit the **Base URL** — each entry shows the currently active value.
  - **Persistent config** — choices are saved to the pi-global `omniroute.json` (`search.provider` / `fetch.provider` / root `baseUrl`) and re-loaded on every session start.
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
pi install git:github.com/Philogag/pi-provider-omniroute
```

Then connect into your OmniRoute instance: set your API key with Pi's normal credential store (`/login omniroute`) and (optionally) pin the base URL in `/omniroute-settings` or via `$OMNIROUTE_BASE_URL`.


> Get the "OmniRoute base URL" from your OmniRoute Dashboard  
> -> "Endpoints" -> "API Endpoint" -> "Public"  
> Which should looks like "http://localhost:20128/v1"   

## Default tool providers

Both tools send their requests without a `provider` field unless one is explicitly given by the model. To pin a default provider for every call, use the built-in settings menu:

```text
/omniroute-settings
```

This opens an interactive TUI menu (top-level → provider submenu) with the currently enabled provider marked with `✓`. Selections are persisted to the pi-global config file at `$PI_AGENT_DIR/omniroute.json` (or `~/.pi/agent/omniroute.json`). Note: a Base URL change takes effect after the next restart, since the provider is registered at extension load.

```json
{
  "baseUrl": "http://localhost:20128/v1",
  "search": { "provider": "tavily-search" },
  "fetch": { "provider": "jina-reader" }
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

The test suite uses Node's `--experimental-strip-types` and exercises auth flows, URL validation, model list fetching, settings persistence, cost telemetry, and both tools. No network access is required.

### Project layout

```text
src/
  index.ts              # Extension entry: registerProvider + registerTool
  auth.ts               # URL validation helpers (default base URL + normalize)
  auth-credentials.ts   # Stored-credential resolution from auth.json
  tools/
    http.ts             # Shared HTTP helper, credential resolver, error contract
    search.ts           # omniroute_web_search
    web-fetch.ts        # omniroute_web_fetch
    search-config.ts    # /omniroute-settings menu state machine + omniroute.json persistence
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

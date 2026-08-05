# pi-provider-omniroute

> Play on [Pi Agent](https://pi.dev) with [OmniRoute](https://github.com/diegosouzapw/OmniRoute) easily.

`pi-provider-omniroute` is a extention for Pi-Agent.  

It registers OmniRoute as a custom model provider for Pi Agent, and exposes more features from OmniRoute to Pi Agent.

> OmniRoute is a local-first AI API proxy/router. Pi is a terminal coding agent. This extension connects the two: you point Pi at your running OmniRoute instance, and Pi can chat with any routed model and call search/fetch tools without extra wiring.

## Features

- **Provider**
  - **OpenAI-compatible chat provider** — registers OmniRoute under the `omniroute` provider id, streams chat completions, and supports tool calling.
  - **Interactive login** — `/login` prompts for an API key and base URL, with retry on invalid URLs and a sensible default of `http://localhost:20128/v1`.
  - **Auto-imported models** — at startup, fetches `GET /v1/models` and registers every routed model (e.g. `openai/gpt-4o`) as a Pi model.
  - **Lazy model refresh** — model list is fetched on demand, not eagerly on extension load, so Pi starts even if OmniRoute is offline.
- **Tool**
  - **`omniroute_web_search` tool** — wraps `POST /v1/search` with 14 search providers, 2 search types, 7 time ranges, country/language filters, and rich content extraction options.
  - **`omniroute_web_fetch` tool** — wraps `POST /v1/web/fetch` with 4 fetch providers (Firecrawl, Jina Reader, Tavily Extract, TinyFish), 4 output formats, depth, and selector wait.

## Requirements

- A running OmniRoute instance reachable from Pi
- Pi Agent ≥ 0.83

## Installation

```bash
pi install git:github.com/Philogag/pi-provider-omniroute
```

Then connect into your OmniRoute instance with `/login omniroute` and paste your API KEY and base URL


> Get the "OmniRoute base URL" from your OmniRoute Dashboard  
> -> "Endpoints" -> "API Endpoint" -> "Public"  
> Which should looks like "http://localhost:20128/v1"   

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
  auth.ts               # URL validation + interactive /login flow
  auth-credentials.ts   # Stored-credential resolution from auth.json
  tools/
    http.ts             # Shared HTTP helper, credential resolver, error contract
    search.ts           # omniroute_web_search
    web-fetch.ts        # omniroute_web_fetch
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

// src/index.ts — pi extension entry
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import type { Model, Context, SimpleStreamOptions, Api } from "@earendil-works/pi-ai";
import { streamSimple as compatStreamSimple } from "@earendil-works/pi-ai/compat";
import { searchTool, setSearchConfigReader } from "./tools/search.ts";
import { webFetchTool, setFetchConfigReader, normalizeFetchProvider } from "./tools/web-fetch.ts";
import { readOmnirouteConfig, createMenuStateMachine, writeOmnirouteConfig, resolveOmnirouteBaseUrl } from "./tools/search-config.ts";
import { resolveApiKey, resolveBaseUrl } from "./tools/http.ts";
import type { OmnirouteTelemetry } from "./tools/usage-telemetry.ts";
import { withOmnirouteFetch, wrapStreamWithCost } from "./tools/usage-telemetry.ts";

let currentConfigProvider: string | undefined = undefined;
setSearchConfigReader(() => currentConfigProvider);

let currentFetchProvider: string | undefined = undefined;
setFetchConfigReader(() => currentFetchProvider);

type OmnirouteModel = Model<"omniroute">;

interface OmnirouteModelEntry {
  id: string;
  name?: string;
  context_length?: number;
  max_input_tokens?: number;
  max_output_tokens?: number;
  capabilities?: {
    tool_calling?: boolean;
    reasoning?: boolean;
    thinking?: boolean;
    temperature?: boolean;
    vision?: boolean;
  };
  input_modalities?: string[];
}

function pickInt(...vs: Array<number | undefined>): number | undefined {
  for (const v of vs) {
    if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  }
  return undefined;
}

const THINKING_LEVEL_MAP = {
  minimal: "minimal",
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "high",
  max: "high",
} as const;

function toOmnirouteModel(m: OmnirouteModelEntry, baseUrl: string): OmnirouteModel {
  const result: OmnirouteModel = {
    id: m.id,
    name: typeof m.name === "string" ? m.name : m.id,
    api: "omniroute" as const,
    provider: "omniroute",
    baseUrl,
    reasoning: m.capabilities?.reasoning === true,
    thinkingLevelMap:
      m.capabilities?.thinking === true ? THINKING_LEVEL_MAP : undefined,
    input:
      m.capabilities?.vision === true ||
      (Array.isArray(m.input_modalities) && m.input_modalities.includes("image"))
        ? ["text", "image"]
        : ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: pickInt(m.max_input_tokens, m.context_length) ?? 128000,
    maxTokens: pickInt(m.max_output_tokens) ?? 4096,
  };
  return result;
}

export default async function (pi: ExtensionAPI) {
  const baseUrl = resolveOmnirouteBaseUrl();

  let models: OmnirouteModel[] = [];
  try {
    const res = await fetch(`${baseUrl}/models`);
    if (!res.ok) {
      console.warn(`[omniroute] /models failed: ${res.status}; using empty model list`);
    } else {
      const { data } = (await res.json()) as { data: OmnirouteModelEntry[] };
      if (Array.isArray(data)) models = data.map((m) => toOmnirouteModel(m, baseUrl));
      else console.warn(`[omniroute] /models response missing data array; using empty model list`);
    }
  } catch (err) {
    console.warn(`[omniroute] /models fetch failed: ${err instanceof Error ? err.message : err}; using empty model list`);
  }

  const streamSimple = (
    model: Model<Api>,
    context: Context,
    options?: SimpleStreamOptions,
  ) => {
    let telemetry: OmnirouteTelemetry | undefined = undefined;
    const captured = withOmnirouteFetch(fetch, (t) => { telemetry = t; });
    return wrapStreamWithCost(
      compatStreamSimple(model, context, { ...options, fetch: captured }),
      () => telemetry,
    );
  };

  pi.registerProvider("omniroute", {
    baseUrl,
    api: "omniroute",
    streamSimple,
    models,
  });

  for (const tool of [searchTool, webFetchTool]) {
    try {
      pi.registerTool(tool);
    } catch (err) {
      console.warn(`[omniroute] failed to register tool ${tool.name}:`, err);
    }
  }

  // Load persisted search provider config (omniroute.json) on session start.
  // Optional call: the host may not implement `on` (e.g. test doubles for the
  // existing use-models-metadata mock which only registers provider + tool).
  pi.on?.("session_start", async () => {
    const cfg = readOmnirouteConfig();
    currentConfigProvider = cfg.search?.provider;
    currentFetchProvider = normalizeFetchProvider(cfg.fetch?.provider);
  });

  // /omniroute-settings: two-level menu (top → Search provider submenu) rendered
  // as a TUI overlay. In non-TUI modes we only notify (spec G3); the menu itself
  // requires an API key, so we resolve it before opening any UI.
  // Optional call: the test double for lazy-fetch registers only provider + tool
  // (same reason `on` above is optional). Real hosts implement registerCommand.
  pi.registerCommand?.("omniroute-settings", {
    description: "OmniRoute settings (search / web-fetch provider)",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      if (ctx.mode !== "tui") {
        ctx.ui.notify("/omniroute-settings requires TUI mode", "error");
        return;
      }
      // Verify the API key before opening the menu (spec G3).
      const apiKey = await resolveApiKey(ctx);
      if (!apiKey) {
        ctx.ui.notify("OmniRoute API key is not configured. Run /login omniroute or set OMNIROUTE_API_KEY.", "error");
        return;
      }
      const sm = createMenuStateMachine({
        resolveApiKey: () => resolveApiKey(ctx),
        resolveBaseUrl: () => resolveBaseUrl(ctx),
        initialCurrentProvider: currentConfigProvider,
        initialFetchProvider: currentFetchProvider,
        onCommitPersist: (provider) => {
          currentConfigProvider = provider;
          writeOmnirouteConfig(provider);
        },
        onCommitFetchPersist: (provider) => {
          currentFetchProvider = provider;
          writeOmnirouteConfig(provider, "fetch");
        },
        onClose: () => {},
      });
      await ctx.ui.custom((tui, theme, _kb, done) => {
        // Resolve the component fresh on each frame/input so the wrapped render
        // and handleInput always delegate to the current mode's component. The
        // state machine's getComponent returns a fresh component reflecting the
        // live mode ("top" vs "sub"), so capturing it once would freeze the
        // wrapper to mode "top" and the provider submenu would never render.
        const wrapped: Component = {
          render: (w: number) => sm.getComponent(tui, theme).render(w),
          invalidate: () => sm.getComponent(tui, theme).invalidate(),
          handleInput: (data: string) => {
            // Top-level Esc closes the overlay; submenu Esc is forwarded to the
            // current mode's component which handles its own cancel/back.
            if (data === "\x1b" && sm.mode() === "top") {
              done(undefined);
              return;
            }
            sm.getComponent(tui, theme).handleInput?.(data);
            tui.requestRender();
          },
        };
        return wrapped;
      });
    },
  });
}



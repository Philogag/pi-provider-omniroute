// src/index.ts — pi extension entry
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import type { Provider, Model, Context, StreamOptions, SimpleStreamOptions } from "@earendil-works/pi-ai";
import { stream, streamSimple } from "@earendil-works/pi-ai/compat";
import { omnirouteApiKeyAuth, OMNIROUTE_DEFAULT_BASE_URL } from "./auth.ts";
import { resolveStoredBaseUrl } from "./auth-credentials.ts";
import { searchTool, setSearchConfigReader } from "./tools/search.ts";
import { webFetchTool } from "./tools/web-fetch.ts";
import { readOmnirouteConfig, createMenuStateMachine, writeOmnirouteConfig } from "./tools/search-config.ts";
import { resolveApiKey, resolveBaseUrl } from "./tools/http.ts";

let currentConfigProvider: string | undefined = undefined;
setSearchConfigReader(() => currentConfigProvider);

type OmnirouteModel = Model<"openai-completions">;

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
    api: "openai-completions" as const,
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
  const storedBaseUrl = resolveStoredBaseUrl();
  const baseUrl = storedBaseUrl ?? process.env.OMNIROUTE_BASE_URL ?? OMNIROUTE_DEFAULT_BASE_URL;

  let models: OmnirouteModel[] = [];

  const provider: Provider<"openai-completions"> = {
    id: "omniroute",
    name: "OmniRoute",
    baseUrl,
    auth: { apiKey: omnirouteApiKeyAuth() },
    getModels: () => models,
    async refreshModels({ signal }) {
      const res = await fetch(`${baseUrl}/models`, { signal });
      if (!res.ok) throw new Error(`OmniRoute /models failed: ${res.status}`);
      const { data } = (await res.json()) as { data: OmnirouteModelEntry[] };
      models = data.map((m) => toOmnirouteModel(m, baseUrl));
    },
    stream: (
      model: OmnirouteModel,
      context: Context,
      options?: StreamOptions,
    ) => stream(model, context, options as never),
    streamSimple: (
      model: OmnirouteModel,
      context: Context,
      options?: SimpleStreamOptions,
    ) => streamSimple(model, context, options),
  };

  pi.registerProvider(provider);

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
    currentConfigProvider = cfg.provider;
  });

  // /omniroute-settings: two-level menu (top → Search provider submenu) rendered
  // as a TUI overlay. In non-TUI modes we only notify (spec G3); the menu itself
  // requires an API key, so we resolve it before opening any UI.
  // Optional call: the test double for lazy-fetch registers only provider + tool
  // (same reason `on` above is optional). Real hosts implement registerCommand.
  pi.registerCommand?.("omniroute-settings", {
    description: "OmniRoute settings (search provider, etc.)",
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
      const smTheme = getSettingsListTheme();
      // The resolvers below are bound closures capturing the command ctx, which
      // injects the real ctx into the state machine's async catalog fetch.
      const sm = createMenuStateMachine({
        resolveApiKey: () => resolveApiKey(ctx),
        resolveBaseUrl: () => resolveBaseUrl(ctx),
        initialCurrentProvider: currentConfigProvider,
        theme: smTheme,
        onCommitPersist: (provider) => {
          currentConfigProvider = provider;
          writeOmnirouteConfig(provider);
        },
        onClose: () => {},
      });
      await ctx.ui.custom((tui, _theme, _kb, done) => {
        const comp = sm.getComponent(tui, smTheme);
        const wrapped: Component = {
          render: (w: number) => comp.render(w),
          invalidate: () => comp.invalidate(),
          handleInput: (data: string) => {
            // Top-level Esc closes the overlay; submenu Esc is forwarded to the
            // menu component which handles its own cancel/back navigation.
            if (data === "\x1b" && sm.mode() === "top") {
              done(undefined);
              return;
            }
            comp.handleInput?.(data);
            tui.requestRender();
          },
        };
        return wrapped;
      });
    },
  });
}



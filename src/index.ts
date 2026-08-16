// src/index.ts — pi extension entry
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import type { Provider, Model, Context, StreamOptions, SimpleStreamOptions, RefreshModelsContext } from "@earendil-works/pi-ai";
import { stream, streamSimple } from "@earendil-works/pi-ai/compat";
import { omnirouteApiKeyAuth } from "./auth.ts";
import { searchTool, setSearchConfigReader } from "./tools/search.ts";
import { webFetchTool, setFetchConfigReader, normalizeFetchProvider } from "./tools/web-fetch.ts";
import { readOmnirouteConfig, createMenuStateMachine, writeOmnirouteConfig, writeOmnirouteBaseUrl, resolveOmnirouteBaseUrl, migrateLegacyConfig } from "./tools/search-config.ts";
import { resolveApiKey } from "./tools/http.ts";
import type { OmnirouteTelemetry } from "./tools/usage-telemetry.ts";
import { withOmnirouteFetch, wrapStreamWithCost } from "./tools/usage-telemetry.ts";

let currentConfigProvider: string | undefined = undefined;
setSearchConfigReader(() => currentConfigProvider);

let currentFetchProvider: string | undefined = undefined;
setFetchConfigReader(() => currentFetchProvider);

// /omniroute-settings is TUI-only (its overlay needs ctx.ui.custom). The run
// mode is only visible via session_start's ExtensionContext, so registration
// happens on the first TUI session_start; repeated events (new/resume/fork)
// must not re-register the command (spec R1/R2).
let settingsCommandRegistered = false;

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
  // Precedence: settings.json `pi-provider-omniroute` block baseUrl →
  // OMNIROUTE_BASE_URL env → default. Legacy sources (old omniroute.json and
  // the auth.json credential env) are migrated once into the block at session
  // start (see migrateLegacyConfig).
  let baseUrl = resolveOmnirouteBaseUrl();

  let models: OmnirouteModel[] = [];

  // Best-effort refresh of the omniroute model list after the baseUrl changed
  // (migration or menu edit). Never throws: on failure we warn and notify so
  // the models are picked up on the next session.
  async function refreshOmnirouteModels(ctx: ExtensionContext): Promise<void> {
    try {
      // Newer hosts accept {providers, force}; the installed 0.83.0 host takes
      // no arguments and ignores extras — the call shape is harmless either way.
      const refresh = ctx.modelRegistry.refresh as unknown as (opts: { providers: string[]; force: boolean }) => Promise<void>;
      await refresh({ providers: ["omniroute"], force: true });
    } catch (err) {
      console.warn("[omniroute] model refresh after baseUrl change failed:", err);
      try {
        ctx.ui.notify("Base URL 已更新，模型将在下次会话刷新", "info");
      } catch {
        // Test doubles may not provide ui.
      }
    }
  }

  const provider: Provider<"openai-completions"> = {
    id: "omniroute",
    name: "OmniRoute",
    baseUrl,
    auth: { apiKey: omnirouteApiKeyAuth() },
    getModels: () => models,
    async refreshModels(context) {
      const { signal } = context;
      // pi-ai 0.84.1 passes {stored, publish, allowNetwork, credential, force, signal};
      // pi-ai 0.83 passes {store, allowNetwork, force, signal}. Handle both, and
      // tolerate bare {signal} (unit-test doubles).
      const c = context as RefreshModelsContext & {
        stored?: Readonly<{ models?: readonly OmnirouteModel[] }>;
        publish?: (publication: {
          persist?: { models: OmnirouteModel[]; checkedAt?: number } | null;
          update?: () => void;
        }) => Promise<boolean>;
        store?: { read(): Promise<unknown>; write(entry: unknown): Promise<void> };
      };
      const allowNetwork = c.allowNetwork !== false; // undefined → network allowed (tests, 0.83 restore)
      const publish = c.publish;
      const store = c.store;

      // Restore phase: publish the persisted catalog back into the sync list.
      if (c.stored?.models) {
        const restored = (c.stored.models as readonly OmnirouteModel[]).filter((m) => m.provider === "omniroute");
        if (publish) {
          const ok = await publish({ update: () => { models = [...restored]; } });
          if (!ok) return;
        } else {
          models = [...restored];
        }
      } else if (store && !allowNetwork) {
        // 0.83-style restore-from-store on the offline phase.
        try {
          const entry = (await store.read()) as { models?: readonly OmnirouteModel[] } | undefined;
          if (entry?.models) models = entry.models.filter((m) => m.provider === "omniroute");
        } catch {
          // Best-effort restore; keep current list on failure.
        }
      }

      if (!allowNetwork || signal?.aborted) return;

      const res = await fetch(`${baseUrl}/models`, { signal });
      if (!res.ok) throw new Error(`OmniRoute /models failed: ${res.status}`);
      const { data } = (await res.json()) as { data: OmnirouteModelEntry[] };
      const refreshed = data.map((m) => toOmnirouteModel(m, baseUrl));
      if (signal?.aborted) return;

      if (publish) {
        await publish({
          persist: { models: refreshed, checkedAt: Date.now() },
          update: () => { models = refreshed; },
        });
      } else {
        models = refreshed;
        if (store) {
          try {
            await store.write({ models: refreshed, checkedAt: Date.now() });
          } catch {
            // Persistence is best-effort; the in-memory list is already updated.
          }
        }
      }
    },
    stream: (
      model: OmnirouteModel,
      context: Context,
      options?: StreamOptions,
    ) => {
      let telemetry: OmnirouteTelemetry | undefined = undefined;
      const captured = withOmnirouteFetch(fetch, (t) => { telemetry = t; });
      return wrapStreamWithCost(
        stream(model, context, { ...options, fetch: captured } as never),
        () => telemetry,
      );
    },
    streamSimple: (
      model: OmnirouteModel,
      context: Context,
      options?: SimpleStreamOptions,
    ) => {
      let telemetry: OmnirouteTelemetry | undefined = undefined;
      const captured = withOmnirouteFetch(fetch, (t) => { telemetry = t; });
      return wrapStreamWithCost(
        streamSimple(model, context, { ...options, fetch: captured }),
        () => telemetry,
      );
    },
  };

  pi.registerProvider(provider);

  for (const tool of [searchTool, webFetchTool]) {
    try {
      pi.registerTool(tool);
    } catch (err) {
      console.warn(`[omniroute] failed to register tool ${tool.name}:`, err);
    }
  }

  // Load persisted search provider config (settings.json block) on session
  // start, and run the one-time migration of legacy baseUrl sources (old
  // omniroute.json + auth.json credential env) into the block. After a
  // migration, re-stamp the module-level baseUrl and best-effort refresh the
  // model list so it reflects the migrated URL.
  // Optional call: the host may not implement `on` (e.g. test doubles for the
  // existing use-models-metadata mock which only registers provider + tool).
  pi.on?.("session_start", async (_ev: unknown, ctx: ExtensionContext) => {
    const migrated = migrateLegacyConfig();
    if (migrated !== undefined) {
      baseUrl = migrated;
      await refreshOmnirouteModels(ctx);
    }
    const cfg = readOmnirouteConfig();
    currentConfigProvider = cfg.search?.provider;
    currentFetchProvider = normalizeFetchProvider(cfg.fetch?.provider);

    // Register the TUI-only settings command only when running in TUI mode.
    // print/json/rpc sessions must not expose /omniroute-settings (spec R1).
    if (ctx.mode === "tui") registerSettingsCommand(pi);
  });

  // /omniroute-settings: two-level menu (top → Search provider submenu) rendered
  // as a TUI overlay. Registered only on the first TUI session_start (see the
  // session_start handler); the handler's non-TUI notify branch was removed
  // because the command no longer exists outside TUI mode.
  function registerSettingsCommand(pi: ExtensionAPI): void {
    if (settingsCommandRegistered) return;
    settingsCommandRegistered = true;
    pi.registerCommand?.("omniroute-settings", {
      description: "OmniRoute settings (search / web-fetch provider)",
      handler: async (_args: string, ctx: ExtensionCommandContext) => {
        // Verify the API key before opening the menu.
        const apiKey = await resolveApiKey(ctx);
        if (!apiKey) {
          ctx.ui.notify("OmniRoute API key is not configured. Run /login omniroute or set OMNIROUTE_API_KEY.", "error");
          return;
        }
        const sm = createMenuStateMachine({
          resolveApiKey: () => resolveApiKey(ctx),
          resolveBaseUrl: () => baseUrl,
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
          onCommitBaseUrl: (value) => {
            writeOmnirouteBaseUrl(value);
            baseUrl = value ?? resolveOmnirouteBaseUrl();
            void refreshOmnirouteModels(ctx);
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
}

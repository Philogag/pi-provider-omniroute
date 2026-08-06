// src/index.ts — pi extension entry
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Provider, Model, Context, StreamOptions, SimpleStreamOptions } from "@earendil-works/pi-ai";
import { stream, streamSimple } from "@earendil-works/pi-ai/compat";
import { omnirouteApiKeyAuth, OMNIROUTE_DEFAULT_BASE_URL } from "./auth.ts";
import { resolveStoredBaseUrl } from "./auth-credentials.ts";
import { searchTool } from "./tools/search.ts";
import { webFetchTool } from "./tools/web-fetch.ts";

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

function toOmnirouteModel(m: OmnirouteModelEntry, baseUrl: string): OmnirouteModel {
  const result: OmnirouteModel = {
    id: m.id,
    name: m.id,
    api: "openai-completions" as const,
    provider: "omniroute",
    baseUrl,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: pickInt(m.max_input_tokens, m.context_length) ?? 128000,
    maxTokens: 4096,
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
}



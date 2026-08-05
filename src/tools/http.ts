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

/**
 * Pure URL validation/normalization for OmniRoute baseUrl values.
 * Used at /login time (with retry) and conceptually reusable at startup.
 */

import type { ApiKeyAuth, AuthInteraction } from "@earendil-works/pi-ai";

export const OMNIROUTE_DEFAULT_BASE_URL = "http://localhost:20128/v1";

export function validateAndNormalizeBaseUrl(input: string): string {
  const trimmed = input.trim();
  if (trimmed === "") return OMNIROUTE_DEFAULT_BASE_URL;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(`Invalid base URL: ${JSON.stringify(input)}`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`base URL must use http(s): got ${url.protocol}`);
  }
  if (!url.hostname) {
    throw new Error(`base URL missing hostname: ${JSON.stringify(input)}`);
  }

  // Non-fatal warning when /v1 path segment is missing — chat calls may 404.
  if (!/\/v1\/?$/.test(url.pathname)) {
    console.warn(
      `[omniroute] base URL ${JSON.stringify(trimmed)} does not end with /v1 — chat calls may 404`,
    );
  }

  return trimmed;
}

const MAX_URL_RETRIES = 1;

async function promptBaseUrlWithRetry(
  interaction: AuthInteraction,
  defaultUrl: string,
): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_URL_RETRIES; attempt++) {
    const raw = await interaction.prompt({
      type: "text",
      message: `Enter OmniRoute base URL (default: ${defaultUrl})`,
      placeholder: defaultUrl,
    });
    try {
      return validateAndNormalizeBaseUrl(raw);
    } catch (err) {
      lastError = err;
      if (attempt === MAX_URL_RETRIES) throw err;
    }
  }
  /* c8 ignore next */
  throw lastError instanceof Error ? lastError : new Error("unreachable");
}

export function omnirouteApiKeyAuth(): ApiKeyAuth {
  return {
    name: "OmniRoute API key",
    login: async (interaction: AuthInteraction) => {
      const key = await interaction.prompt({
        type: "secret",
        message: "Enter OmniRoute API key",
      });
      const baseUrl = await promptBaseUrlWithRetry(
        interaction,
        OMNIROUTE_DEFAULT_BASE_URL,
      );
      return {
        type: "api_key",
        key,
        env: { OMNIROUTE_BASE_URL: baseUrl },
      };
    },
    resolve: async ({ ctx, credential }) => {
      if (credential?.key) {
        const baseUrl = credential.env?.OMNIROUTE_BASE_URL;
        return {
          auth: { apiKey: credential.key, ...(baseUrl ? { baseUrl } : {}) },
          env: credential.env,
          source: "stored credential",
        };
      }
      const envKey = await ctx.env("OMNIROUTE_API_KEY");
      const envBase = await ctx.env("OMNIROUTE_BASE_URL");
      if (envKey) {
        return {
          auth: { apiKey: envKey, ...(envBase ? { baseUrl: envBase } : {}) },
          env: envBase ? { OMNIROUTE_BASE_URL: envBase } : undefined,
          source: "OMNIROUTE_API_KEY",
        };
      }
      return undefined;
    },
    check: async ({ ctx, credential }) => {
      if (credential?.key) {
        return { type: "api_key", source: "stored credential" };
      }
      const envKey = await ctx.env("OMNIROUTE_API_KEY");
      if (envKey) {
        return { type: "api_key", source: "OMNIROUTE_API_KEY" };
      }
      return undefined;
    },
  };
}

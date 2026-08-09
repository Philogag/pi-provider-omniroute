/**
 * Pure URL validation/normalization for OmniRoute baseUrl values.
 * Used at /login time and conceptually reusable at startup.
 */

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

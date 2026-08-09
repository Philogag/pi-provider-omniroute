// src/tools/http.ts
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { OMNIROUTE_DEFAULT_BASE_URL } from "../auth.ts";
import { resolveOmnirouteBaseUrl } from "./search-config.ts";

export function resolveBaseUrl(ctx: ExtensionContext): string {
  if (ctx.model?.provider === "omniroute" && ctx.model.baseUrl) {
    return ctx.model.baseUrl;
  }
  return resolveOmnirouteBaseUrl();
}

export async function resolveApiKey(ctx: ExtensionContext): Promise<string | undefined> {
  return ctx.modelRegistry.getApiKeyForProvider("omniroute");
}

export type OmnirouteResult =
  | { ok: true; text: string; json?: unknown }
  | { ok: false; status: number; message: string; cancelled?: boolean };

export type OmnirouteRequestOptions = {
  apiKey: string;
  baseUrl: string;
  signal?: AbortSignal;
  timeoutMs: number;
};

export async function omnirouteRequest(
  path: string,
  body: unknown,
  opts: OmnirouteRequestOptions,
): Promise<OmnirouteResult> {
  const url = `${opts.baseUrl.replace(/\/+$/, "")}${path}`;

  let signal: AbortSignal | undefined = opts.signal;
  let timer: NodeJS.Timeout | undefined;
  const controller = new AbortController();
  if (typeof AbortSignal.any === "function") {
    const signals: AbortSignal[] = [AbortSignal.timeout(opts.timeoutMs)];
    if (opts.signal) signals.push(opts.signal);
    signal = AbortSignal.any(signals);
  } else {
    // 旧 Node 回退：手动 timer + controller
    timer = setTimeout(() => controller.abort(), opts.timeoutMs);
    opts.signal?.addEventListener("abort", () => controller.abort(), { once: true });
    signal = controller.signal;
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
      signal,
    });
    const text = await res.text();
    if (res.ok) {
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        // 非 JSON 响应（如 screenshot 二进制）——json 置空，走 text 兜底
      }
      return { ok: true, text, json };
    }
    let message = `OmniRoute ${path} failed: ${res.status}`;
    try {
      const err = JSON.parse(text) as { error?: unknown; message?: unknown; detail?: unknown };
      const detail =
        typeof err.error === "string"
          ? err.error
          : typeof err.message === "string"
            ? err.message
            : typeof err.detail === "string"
              ? err.detail
              : undefined;
      if (detail) message += ` (${detail})`;
    } catch {
      // 非 JSON 错误体——仅保留状态码
    }
    return { ok: false, status: res.status, message };
  } catch (err) {
    if (timer) clearTimeout(timer);
    if (err instanceof Error && err.name === "AbortError") {
      if (opts.signal?.aborted) {
        return { ok: false, status: 0, message: "cancelled", cancelled: true };
      }
      return { ok: false, status: 0, message: `OmniRoute ${path} timed out after ${opts.timeoutMs}ms` };
    }
    const reason = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 0, message: `Cannot reach OmniRoute at ${opts.baseUrl}: ${reason}` };
  }
}

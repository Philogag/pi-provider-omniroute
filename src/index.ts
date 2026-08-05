// src/index.ts — pi extension 入口
import type { ExtensionAPI, ProviderModelConfig } from "@earendil-works/pi-coding-agent";

const DEFAULT_BASE_URL = "http://localhost:20128/api/v1";

const MODEL_DEFAULTS: Omit<ProviderModelConfig, "id" | "name"> = {
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128000,
  maxTokens: 4096,
};

export default async function (pi: ExtensionAPI) {
  const apiKey = process.env.OMNIROUTE_API_KEY;
  const baseUrl = process.env.OMNIROUTE_BASE_URL ?? DEFAULT_BASE_URL;

  // 注册 provider（立即可见，models 初始为空）
  pi.registerProvider("omniroute", {
    baseUrl,
    // 动态认证策略：env 存在用 "local" 占位（无认证），缺失则引用 env
    apiKey: apiKey ? "local" : "$OMNIROUTE_API_KEY",
    api: "openai-completions",
    models: [],
    // 支持运行时刷新：pi update --models
    async refreshModels({ signal }) {
      const res = await fetch(`${baseUrl}/models`, { signal });
      if (!res.ok) throw new Error(`OmniRoute /models failed: ${res.status}`);
      const { data } = await res.json() as { data: Array<{ id: string }> };
      return data.map(
        (m): ProviderModelConfig => ({ id: m.id, name: m.id, ...MODEL_DEFAULTS }),
      );
    },
  });

  // 启动时尝试拉取模型（优雅降级）
  await tryRegisterModels(baseUrl, pi);
}

async function tryRegisterModels(baseUrl: string, pi: ExtensionAPI): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(`${baseUrl}/models`, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { data } = await res.json() as { data: Array<{ id: string }> };
    const models: ProviderModelConfig[] = data.map(
      (m) => ({ id: m.id, name: m.id, ...MODEL_DEFAULTS }),
    );
    // 用真实模型替换初始空列表
    pi.registerProvider("omniroute", { models });
  } catch (err) {
    clearTimeout(timeout);
    console.warn(`[omniroute] OmniRoute unavailable, skipping model registration: ${err}`);
  }
}

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
  // TODO: 实现完整逻辑（Task 4）
  console.log("[omniroute] Extension loaded (skeleton)");
}

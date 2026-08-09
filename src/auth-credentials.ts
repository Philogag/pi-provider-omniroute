import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface StoredCredential {
  type?: string;
  key?: string;
  env?: Record<string, string>;
}

export function resolveAuthJsonPath(): string {
  const fromEnv = process.env.PI_AGENT_DIR;
  if (fromEnv) return join(fromEnv, "auth.json");
  return join(homedir(), ".pi", "agent", "auth.json");
}

export function readCredential(): StoredCredential | undefined {
  const path = resolveAuthJsonPath();
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    console.warn(
      `[omniroute] failed to read auth.json at ${path}: ${(err as Error).message}`,
    );
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.warn(
      `[omniroute] auth.json at ${path} is malformed JSON: ${(err as Error).message}`,
    );
    return undefined;
  }
  if (!parsed || typeof parsed !== "object") return undefined;
  const cred = (parsed as Record<string, unknown>)["omniroute"];
  if (!cred || typeof cred !== "object") return undefined;
  return cred as StoredCredential;
}

import { readFileSync, writeFileSync, mkdirSync, renameSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
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

export function resolveStoredBaseUrl(): string | undefined {
  const cred = readCredential();
  if (!cred) return undefined;
  return cred.env?.OMNIROUTE_BASE_URL;
}

// Removes `OMNIROUTE_BASE_URL` from the omniroute credential's env in
// auth.json. Called after a successful source-② migration (auth.json legacy
// env → settings.json block) so that: (1) a later explicit Base URL reset
// (spec B4: empty input deletes the block field) cannot be resurrected by the
// next session_start, and (2) the legacy value stops participating in any
// resolution (spec B1). Atomic tmp+rename, preserves every other provider and
// key in the file. Returns true when the key was actually removed; false when
// there was nothing to remove or the write failed (warned — the env is kept so
// the next startup can retry).
export function stripStoredBaseUrlEnv(): boolean {
  const path = resolveAuthJsonPath();
  let root: Record<string, unknown>;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
    root = parsed as Record<string, unknown>;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    console.warn(
      `[omniroute] failed to read auth.json at ${path} before stripping baseUrl env: ${(err as Error).message}`,
    );
    return false;
  }
  const cred = root["omniroute"];
  if (!cred || typeof cred !== "object" || Array.isArray(cred)) return false;
  const env = (cred as Record<string, unknown>)["env"];
  if (!env || typeof env !== "object" || Array.isArray(env)) return false;
  const envRec = env as Record<string, unknown>;
  if (!("OMNIROUTE_BASE_URL" in envRec)) return false;
  delete envRec.OMNIROUTE_BASE_URL;
  if (Object.keys(envRec).length === 0) delete (cred as Record<string, unknown>)["env"];
  try {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = path + ".tmp";
    writeFileSync(tmp, JSON.stringify(root, null, 2) + "\n", { mode: 0o600 });
    renameSync(tmp, path);
  } catch (err) {
    console.warn(
      `[omniroute] failed to write auth.json at ${path}: ${(err as Error).message}`,
    );
    try {
      unlinkSync(path + ".tmp");
    } catch {
      /* ignore */
    }
    return false;
  }
  return true;
}

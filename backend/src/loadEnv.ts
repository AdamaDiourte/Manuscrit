/**
 * Charge le premier fichier `.env` trouvé (racine monorepo ou backend).
 * N’écrase jamais une variable déjà définie dans process.env.
 * À importer en premier dans server.ts.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function applyEnvFile(path: string): boolean {
  if (!existsSync(path)) return false;
  const text = readFileSync(path, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
  return true;
}

export function loadEnvFiles(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, "../../.env"),
    resolve(here, "../.env"),
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), "../.env"),
  ];
  for (const path of candidates) {
    if (applyEnvFile(path)) return;
  }
}

loadEnvFiles();

import {execFileSync, spawn} from "node:child_process";
import {existsSync, readFileSync} from "node:fs";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import net from "node:net";

const windows = process.platform === "win32";
const npm = windows ? "npm.cmd" : "npm";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Charge `.env` racine dans process.env (sans écraser l’existant). */
function loadRootEnv() {
  const path = resolve(root, ".env");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
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
}

loadRootEnv();

function canReach(port, host = "127.0.0.1", ms = 400) {
  return new Promise((resolve) => {
    const socket = net.connect({port, host}, () => {
      socket.end();
      resolve(true);
    });
    socket.on("error", () => resolve(false));
    socket.setTimeout(ms, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

/** Tue l’arbre de processus (sous Windows, `child.kill()` ne suffit pas avec shell). */
function killTree(pid) {
  if (!pid) return;
  try {
    if (windows) {
      execFileSync("taskkill", ["/pid", String(pid), "/T", "/F"], {
        stdio: "ignore",
      });
    } else {
      process.kill(pid, "SIGTERM");
    }
  } catch {
    // déjà mort
  }
}

/** PID en écoute sur le port, ou null. */
function listenerPid(port) {
  try {
    if (windows) {
      const out = execFileSync("netstat", ["-ano"], {encoding: "utf8"});
      const needle = `:${port}`;
      for (const line of out.split(/\r?\n/)) {
        if (!line.includes("LISTENING") || !line.includes(needle)) continue;
        const parts = line.trim().split(/\s+/);
        const local = parts[1] || "";
        if (!local.endsWith(needle)) continue;
        const pid = Number(parts[parts.length - 1]);
        if (Number.isFinite(pid) && pid > 0) return pid;
      }
      return null;
    }
    const out = execFileSync("lsof", ["-ti", `tcp:${port}`, "-sTCP:LISTEN"], {
      encoding: "utf8",
    });
    const pid = Number(out.trim().split(/\s+/)[0]);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function freePort(port) {
  const pid = listenerPid(port);
  if (!pid || pid === process.pid) return;
  console.info(`Port ${port} occupé (PID ${pid}) — arrêt du processus.`);
  killTree(pid);
}

const postgresUp = await canReach(55432);
const env = {
  ...process.env,
  NODE_ENV: "development",
  ...(postgresUp
    ? {
        DATABASE_URL:
          process.env.DATABASE_URL ||
          "postgres://manuscrit:local_dev@127.0.0.1:55432/manuscrit",
      }
    : {MANUSCRIT_STORAGE: "filesystem"}),
};

if (!postgresUp) {
  console.info(
    "PostgreSQL indisponible sur 55432 — mode stockage fichier local.",
  );
}

// Évite les conflits laissés par un Ctrl+C précédent sous Windows.
freePort(5173);
freePort(3000);

const processes = ["backend", "frontend"].map((workspace) =>
  spawn(npm, ["run", "dev", "-w", workspace], {
    stdio: "inherit",
    env,
    shell: windows,
  }),
);

let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of processes) killTree(child.pid);
}

for (const child of processes) child.on("exit", (code) => stop(code ?? 0));
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));

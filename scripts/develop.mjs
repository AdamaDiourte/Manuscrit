import {spawn} from "node:child_process";
import net from "node:net";

const windows = process.platform === "win32";
const npm = windows ? "npm.cmd" : "npm";

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
  for (const child of processes) child.kill();
}

for (const child of processes) child.on("exit", (code) => stop(code ?? 0));
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));

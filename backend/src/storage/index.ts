import type {ObjectStore} from "./types";

const filesystem =
  process.env.MANUSCRIT_STORAGE === "filesystem" || !process.env.DATABASE_URL;

const mod = filesystem
  ? await import("./filesystem.mjs")
  : await import("./postgres.mjs");

export const env = {
  ...(mod.env as NodeJS.ProcessEnv),
  BUCKET: (mod.env as {BUCKET: ObjectStore}).BUCKET,
};

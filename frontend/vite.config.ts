import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {defineConfig} from "vite";
import react from "@vitejs/plugin-react";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export default defineConfig({
  plugins: [react()],
  // VITE_* depuis le `.env` à la racine du monorepo.
  envDir: root,
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    open: true,
    proxy: {"/api": "http://127.0.0.1:3000"},
  },
});



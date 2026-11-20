/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ALLOW_SIMULATION?: string;
  readonly VITE_MAX_TEXT_CHARS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the ranking/history API. Defaults to `/api` (served by MSW). */
  readonly VITE_API_BASE_URL?: string
  /** Axios timeout in milliseconds. Defaults to 4000. */
  readonly VITE_API_TIMEOUT_MS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

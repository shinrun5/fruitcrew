/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Absolute API origin for builds that don't run same-origin with the
   * backend (e.g. the Capacitor native shell, which loads from
   * capacitor://localhost). Web builds leave this unset and use the
   * relative /api path instead. */
  readonly VITE_API_BASE?: string
}

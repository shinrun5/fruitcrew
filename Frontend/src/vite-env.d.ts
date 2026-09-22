/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Absolute API origin for builds that don't run same-origin with the
   * backend (e.g. the Capacitor native shell, which loads from
   * capacitor://localhost). Web builds leave this unset and use the
   * relative /api path instead. */
  readonly VITE_API_BASE?: string
  /** Google Cloud OAuth 2.0 "Web application" client ID (console.cloud.google.com
   * -> APIs & Services -> Credentials). Unset = the Google sign-in button
   * doesn't render, rather than shipping a broken one. */
  readonly VITE_GOOGLE_CLIENT_ID?: string
}

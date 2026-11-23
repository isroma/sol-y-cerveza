/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Price suggestions API base URL (api/); unset hides the suggest form. */
  readonly VITE_PRICES_API?: string
  /** Cloudflare Turnstile site key (public). */
  readonly VITE_TURNSTILE_SITE_KEY?: string
  /** '1' ships the self-removing service worker (README, kill switch). */
  readonly VITE_SW_KILL_SWITCH?: string
}

/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Price suggestions API base URL (api/); unset hides the suggest form. */
  readonly VITE_PRICES_API?: string
  /** Cloudflare Turnstile site key (public). */
  readonly VITE_TURNSTILE_SITE_KEY?: string
}

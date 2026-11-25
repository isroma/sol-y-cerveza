/** Bindings and vars; a secret that was never set is undefined at runtime. */
export type Env = {
  DB: D1Database
  ALLOWED_ORIGINS: string
  TERRACES_URL: string
  TURNSTILE_SECRET?: string
  ADMIN_TOKEN?: string
  IP_SALT?: string
  OWNER_TOKEN?: string
  ANTHROPIC_API_KEY?: string
}

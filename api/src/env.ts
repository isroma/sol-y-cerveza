/** Bindings and vars; a secret that was never set is undefined at runtime. */
export type Env = {
  DB: D1Database
  ALLOWED_ORIGINS: string
  TERRACES_URL: string
  /**
   * The build fingerprint CI deploys with (`wrangler deploy --var BUILD_ID:…`,
   * .github/workflows/deploy-api.yml), served by GET /v1/version. Unset when
   * the Worker was deployed without one, e.g. by hand.
   */
  BUILD_ID?: string
  TURNSTILE_SECRET?: string
  ADMIN_TOKEN?: string
  IP_SALT?: string
  OWNER_TOKEN?: string
  /** The owner's login (POST /v1/login), which hands out OWNER_TOKEN. */
  OWNER_USERNAME?: string
  OWNER_PASSWORD?: string
}

# Price suggestions API

A Cloudflare Worker with a D1 database: visitors suggest beer prices, and prices that 5 people agree on are served to the app. The design is in [ADR-0005](../docs/adr/0005-price-suggestions.md).

| Endpoint | Who | What |
| --- | --- | --- |
| `POST /v1/suggestions` | the app | `{venueId, item, brand, cents, token}` (the token comes from Turnstile) |
| `GET /v1/prices` | the app | prices with consensus, cached for 5 minutes |
| `GET /v1/admin/suggestions` | the admin view | pending suggestions (`Authorization: Bearer <ADMIN_TOKEN>`) |
| `POST /v1/admin/resolve` | the admin view | `{venueId, item, brand, cents, status: accepted \| rejected}` |

## Local development

```bash
cp .dev.vars.example .dev.vars   # Turnstile test keys that always pass
npm ci
npm run migrate:local
npm run dev                      # http://localhost:8787
```

## First deploy (once)

1. Create a free Cloudflare account, then run `npx wrangler login` in `api/`.
2. Run `npx wrangler d1 create sol-y-cerveza` and put the `database_id` it prints into `wrangler.toml`.
3. Run `npm run migrate:remote`.
4. In the Cloudflare dashboard, go to Turnstile, add a widget for the hostnames `isroma.github.io` and `localhost`, and note its site key and secret key.
5. Set the secrets:
   - `npx wrangler secret put TURNSTILE_SECRET`
   - `npx wrangler secret put ADMIN_TOKEN` (any long random string)
   - `npx wrangler secret put IP_SALT` (another long random string)
6. Run `npm run deploy` and note the `*.workers.dev` URL.

# Price suggestions API

A Cloudflare Worker with a D1 database: visitors suggest beer prices, and prices that 5 people (on 5 different networks) agree on are served to the app. Visitors can also report venues that moved, closed or are missing, and whether a venue has a terrace and where; reports only wait for the owner's review. The design is in [ADR-0005](../docs/adr/0005-price-suggestions.md) and, for terraces, [ADR-0009](../docs/adr/0009-terrace-reports.md).

| Endpoint | Who | What |
| --- | --- | --- |
| `POST /v1/suggestions` | the app | `{venueId, item, brand, cents, token}` (the token comes from Turnstile) |
| `GET /v1/prices` | the app | prices with consensus, cached for 5 minutes |
| `GET /v1/admin/suggestions` | the admin view | pending suggestions (`Authorization: Bearer <ADMIN_TOKEN>`) |
| `POST /v1/admin/resolve` | the admin view | `{venueId, item, brand, cents, status: accepted \| rejected}` |
| `GET /v1/owner/check` | owner mode | 200 when `Authorization: Bearer <OWNER_TOKEN>` is right |
| `PUT` / `DELETE /v1/owner/prices` | owner mode | `{venueId, item, brand, cents}`: a confirmed price, dated today (Madrid) |
| `POST /v1/owner/photo` | owner mode | `{image, mediaType}` → `{proposals, notes, barName}`, read by the Claude API (`ANTHROPIC_API_KEY`) |
| `GET /v1/admin/owner-prices` | the admin view | owner prices, for the import into `venue_prices.csv` |
| `POST /v1/reports` | the app | `{kind: move, venueId, lat, lon, token}`, `{kind: closed, venueId, token}` or `{kind: add, name, venueKind, terrace, lat, lon, token}`; for terraces `{kind: terrace, venueId, terrace: true \| false, token}` or `{kind: pin, venueId, lat, lon, token}` (Turnstile action `report`) |
| `GET /v1/admin/reports` | the admin view | pending reports: `closed` grouped per venue and `terrace` per venue and answer (`reporters` = distinct networks), `move`, `pin` and `add` one per row, most reporters first |
| `POST /v1/admin/reports/resolve` | the admin view | `{ids, status: accepted \| rejected}` → `{updated}` |

Reports are never applied by the API: the owner accepts them in the admin view, which writes `venue_review.csv`. A `move` must be within 500 m and a `pin` within 150 m of the venue's published position (`400 {error: "invalid position"}` otherwise). One open report of each kind per voter and venue; a new one replaces the old one (a terrace "yes" can become a "no").

## Spam and bot guardrails

Nothing about a visitor is kept in the browser: cookies or local storage would be wiped by exactly the person we want to stop, so closing the browser or opening a private window changes nothing. The API decides everything from the request:

- **Turnstile**: the token must pass, and come from the app's widget (`action: 'suggest'` for prices, `'report'` for venue reports) on a hostname in `ALLOWED_ORIGINS`. Turnstile tokens are single-use. The test secrets in `.dev.vars.example` skip the hostname and action checks.
- **Voter**: the IPv4 address, or the IPv6 /64 (a device can pick any address in its /64, so all of them are one voter). One vote per voter per venue, item and brand; a new vote replaces the old one.
- **Network**: the IPv4 /24 or IPv6 /48. Consensus and the review queue count distinct networks, so a person who gets new addresses (airplane mode, a router restart, a new IPv6 address) still counts once. Friends at the same bar on the same Wi-Fi count once too, which is the price of this rule.
- **Caps** (every accepted request counts, re-votes and venue reports included; 429 with `Retry-After` when hit): 20 a day per voter, 60 a day per network, 15 an hour per venue from everyone (reports of missing venues share the venue key `new`). The log behind them (`suggestion_events`) holds hashes only and is pruned after 48 hours.
- **Validity**: plausible prices only, venues in the published data only.
- Only hashes are stored, salted with `IP_SALT`; never an IP address.

The numbers live in `src/logic.ts`. A determined attacker with many networks (a residential proxy pool) can still get through; the review queue in the admin, where any suggestion can be rejected, is the last line.

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
   - `npx wrangler secret put OWNER_TOKEN` (another long random string: the owner-mode key)
   - `npx wrangler secret put ANTHROPIC_API_KEY` (for owner photo reading)
6. Run `npm run deploy` and note the `*.workers.dev` URL.

## Updating

When a PR adds a migration (for example `0004_venue_reports.sql` for venue reports), apply it before deploying the code that uses it:

```bash
npm run migrate:remote
npm run deploy
```

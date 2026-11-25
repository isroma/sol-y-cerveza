# Price suggestions API

A Cloudflare Worker with a D1 database: visitors suggest beer prices, and prices that 5 people (on 5 different networks) agree on are served to the app. Visitors can also report venues that moved, closed or are missing, and whether a venue has a terrace and where; reports only wait for the owner's review. The design is in [ADR-0005](../docs/adr/0005-price-suggestions.md) and, for terraces, [ADR-0009](../docs/adr/0009-terrace-reports.md).

| Endpoint                          | Who            | What                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /v1/suggestions`            | (unused)       | `{venueId, item, brand, cents, token}` (the token comes from Turnstile, action `suggest`); the app no longer calls it: the card back sends prices through `POST /v1/changes`                                                                                                                                                                                                                                                                        |
| `GET /v1/prices`                  | the app        | prices with consensus, except rejected ones; cached for 5 minutes (see below)                                                                                                                                                                                                                                                                                                                                                                       |
| `GET /v1/admin/suggestions`       | the admin view | pending suggestions (`Authorization: Bearer <ADMIN_TOKEN>`)                                                                                                                                                                                                                                                                                                                                                                                         |
| `POST /v1/admin/resolve`          | the admin view | `{venueId, item, brand, cents, status: accepted \| rejected}`; a rejected price never counts again, until it is accepted                                                                                                                                                                                                                                                                                                                            |
| `GET /v1/owner/check`             | owner mode     | 200 when `Authorization: Bearer <OWNER_TOKEN>` is right                                                                                                                                                                                                                                                                                                                                                                                             |
| `PUT` / `DELETE /v1/owner/prices` | owner mode     | `{venueId, item, brand, cents}`: a confirmed price, dated today (Madrid); a `PUT` also lifts a rejection of that exact price                                                                                                                                                                                                                                                                                                                        |
| `POST /v1/owner/photo`            | owner mode     | `{image, mediaType}` → `{proposals, notes, barName}`, read by Workers AI (`@cf/google/gemma-4-26b-a4b-it`, the `AI` binding); at most 50 a day                                                                                                                                                                                                                                                                                                                                |
| `GET /v1/admin/owner-prices`      | (unused)       | owner prices, meant for an import into `venue_prices.csv` that is not built yet (nothing in `web/` calls it)                                                                                                                                                                                                                                                                                                                                        |
| `POST /v1/reports`                | the app        | `{kind: move, venueId, lat, lon, token}`, `{kind: closed, venueId, token}` or `{kind: add, name, venueKind, terrace, lat, lon, token}`; for terraces `{kind: terrace, venueId, terrace: true \| false, token}` or `{kind: pin, venueId, lat, lon, token}` (Turnstile action `report`). The app sends only `add` ("¿Falta un bar? Añádelo"); its moves and closures go through `POST /v1/changes`, and no app UI sends `terrace` or `pin` yet (#210) |
| `POST /v1/changes`                | the app        | The card back: `{venueId, token, price?: {item, brand, cents}, move?: {lat, lon}, closed?: true}`, at least one part (Turnstile action `change`). One bot check for all; each part is validated as on its own endpoint and counts once towards the caps; stored together or not at all                                                                                                                                                              |
| `GET /v1/admin/reports`           | the admin view | pending reports: `closed` grouped per venue and `terrace` per venue and answer (`reporters` = distinct networks), `move`, `pin` and `add` one per row, most reporters first                                                                                                                                                                                                                                                                         |
| `POST /v1/admin/reports/resolve`  | the admin view | `{ids, status: accepted \| rejected}` → `{updated}`                                                                                                                                                                                                                                                                                                                                                                                                 |

**Rejected prices.** Rejecting a price in the admin's Suggestions queue records its venue, item, brand and cents in `rejected_prices`: from then on no vote for it counts, neither the same voters voting again nor new networks, and it no longer shows in the queue. To undo a rejection, accept that price (`POST /v1/admin/resolve` with `status: accepted`; its earlier votes count again) or save it as an owner price at the same cents.

**Prices cache.** `GET /v1/prices` is cached for 5 minutes in the browser (`Cache-Control`) and in the Worker: in the data centre's Cache API under one key whatever the query string, and for 60 seconds in the isolate's memory. Owner price writes and admin resolves purge both, but only in the data centre and isolate that took the write, so elsewhere a change can take up to 5 minutes to show. New visitor votes don't purge it. CORS headers are added per request, so one cached answer serves every allowed origin.

Reports are never applied by the API: the owner accepts them in the admin view, which writes `venue_review.csv`. A `move` must be within 500 m and a `pin` within 150 m of the venue's published position (`400 {error: "invalid position"}` otherwise). One open report of each kind per voter and venue; a new one replaces the old one (a terrace "yes" can become a "no").

## Spam and bot guardrails

Nothing about a visitor is kept in the browser: cookies or local storage would be wiped by exactly the person we want to stop, so closing the browser or opening a private window changes nothing. The API decides everything from the request:

- **Turnstile**: the token must pass, and come from the app's widget (`action: 'suggest'` for `POST /v1/suggestions`, `'report'` for `POST /v1/reports`, `'change'` for the card back's `POST /v1/changes`) on a hostname in `ALLOWED_ORIGINS`. Turnstile tokens are single-use. The test secrets in `.dev.vars.example` skip the hostname and action checks, and pass only on a request to `localhost`, `127.0.0.1` or `[::1]`: a deployed Worker with a test secret fails every bot check (and logs why).
- **Voter**: the IPv4 address, or the IPv6 /64 (a device can pick any address in its /64, so all of them are one voter). One vote per voter per venue, item and brand; a new vote replaces the old one.
- **Network**: the IPv4 /24 or IPv6 /48. Consensus and the review queue count distinct networks, so a person who gets new addresses (airplane mode, a router restart, a new IPv6 address) still counts once. Friends at the same bar on the same Wi-Fi count once too, which is the price of this rule.
- **Caps** (every accepted request counts, re-votes and venue reports included; 429 with `Retry-After` when hit): 20 a day per voter, 60 a day per network, 15 an hour per venue from everyone (a report of a missing venue counts against its area instead: a cell of about 1 km, `new:<lat>,<lon>` to 2 decimals). A change from the card's back counts once per part (price, move, closed) and goes in only if all its parts fit. The check and the logging are one SQL statement, so parallel requests can't slip past a cap. The log behind them (`suggestion_events`) holds hashes only and is pruned after 48 hours.
- **Validity**: plausible prices only, venues in the published data only.
- Only hashes are stored, salted with `IP_SALT`; never an IP address. If `IP_SALT` is unset or shorter than 16 characters, `POST /v1/suggestions`, `POST /v1/reports` and `POST /v1/changes` answer `503 {error: "not configured"}` (and log why) rather than hash with a guessable salt.
- **Body size**: 8 KB for every JSON body (7 MB for a photo), counted in bytes; a larger `Content-Length` is refused before reading, and a body without one stops being read at the limit (`413`).
- **Photos**: owner mode may send at most 50 photos to Workers AI in any 24 hours (`PHOTO_DAILY_LIMIT` in `src/photo.ts`, counted in `owner_photo_events`), so a leaked `OWNER_TOKEN` can't use up the free daily allowance; then `429` with `Retry-After`. Invalid photos don't count.

The numbers live in `src/logic.ts`. A determined attacker with many networks (a residential proxy pool) can still get through; the review queue in the admin, where any suggestion can be rejected, is the last line.

## Code

| File                                                               | What                                                                                                    |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `src/index.ts`                                                     | the Worker: the endpoint list, `route()` and CORS                                                       |
| `src/env.ts`                                                       | `Env`, the bindings, vars and secrets                                                                   |
| `src/http.ts`                                                      | JSON responses, size-capped bodies, bearer tokens                                                       |
| `src/guard.ts`                                                     | the published venues (cached per isolate), Turnstile, `IP_SALT` and hashing, the caps (`takeAllowance`) |
| `src/routes/prices.ts`                                             | suggestions, `GET /v1/prices` and its cache, the admin's suggestions queue                              |
| `src/routes/reports.ts`                                            | `POST /v1/reports`, `POST /v1/changes` and the admin's reports queue                                    |
| `src/routes/owner.ts`                                              | owner mode (prices, photos) and `GET /v1/admin/owner-prices`                                            |
| `src/logic.ts`, `src/reports.ts`, `src/changes.ts`, `src/photo.ts` | pure rules: parsing, limits, consensus, the report queue, photo reading                                 |

## Local development

```bash
cp .dev.vars.example .dev.vars   # Turnstile test keys that pass on localhost
npm ci
npm run migrate:local
npm run dev                      # http://localhost:8787
```

An older `.dev.vars` with `IP_SALT=local-salt` is now too short: copy the new example's value (any 16 characters or more).

| Script                                     | What                                                                                                 | Needs Cloudflare login |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------- | ---------------------- |
| `npm run check`                            | `format:check`, `lint` (oxlint), `typecheck` (tsc for the Worker and for the Worker test) and `test` | no                     |
| `npm run format`                           | Prettier, the settings of `web/`                                                                     | no                     |
| `npm run build:dry`                        | bundles the Worker as `wrangler deploy` would, into `dist/`, without uploading                       | no                     |
| `npm run migrate:local`                    | applies `migrations/` to the local D1 in `.wrangler/`                                                | no                     |
| `npm run migrate:remote`, `npm run deploy` | the live database and Worker                                                                         | yes                    |

`npm test` includes `src/index.test.ts`, which bundles the Worker, runs it in workerd through Miniflare with a local D1 that has every migration applied, and sends it real requests; terraces.json, Turnstile and Workers AI are stubbed (the `AI` binding is a fake RPC service), so it needs no network. (`@cloudflare/vitest-pool-workers` would be the usual tool, but no release supports vitest 5 yet.) `miniflare` and `esbuild` are pinned to the versions `wrangler` depends on: bump them together.

## First deploy (once)

1. Create a free Cloudflare account, then run `npx wrangler login` in `api/`.
2. Run `npx wrangler d1 create sol-y-cerveza` and put the `database_id` it prints into `wrangler.toml`.
3. Run `npm run migrate:remote`.
4. In the Cloudflare dashboard, go to Turnstile, add a widget for the hostnames `isroma.github.io` and `localhost`, and note its site key and secret key.
5. Set the secrets:
   - `npx wrangler secret put TURNSTILE_SECRET`
   - `npx wrangler secret put ADMIN_TOKEN` (any long random string)
   - `npx wrangler secret put IP_SALT` (another long random string, at least 16 characters)
   - `npx wrangler secret put OWNER_TOKEN` (another long random string: the owner-mode key)
6. Run `npm run deploy` and note the `*.workers.dev` URL.

## Updating

When a PR adds a migration (for example `0006_rejected_prices.sql`, which adds `rejected_prices`, fills it with the prices already rejected, and adds `owner_photo_events` for the photo cap), apply it before deploying the code that uses it:

```bash
npm run migrate:remote
npm run deploy
```

Once deploys from GitHub are on (below), merging to `main` does both.

**Migrations must be backwards compatible.** They are applied before the new code is deployed, so for a while (and for good, if the deploy then fails) the Worker that is already live runs against the new schema. Add tables, columns with defaults and indexes; drop or rename only in a later PR, once no deployed code uses the old name. CI applies every migration to an empty local D1 (`wrangler d1 migrations apply --local`), so a migration that does not run fails the PR.

## Deploys from GitHub

`.github/workflows/deploy-api.yml` applies the migrations (`wrangler d1 migrations apply sol-y-cerveza --remote`) and deploys the Worker (`wrangler deploy`). CI calls it from its `deploy-api` job once `ci-ok` passes on a push to `main`, on the commit CI tested; it can also be run by hand from Actions on `main`. It runs after every green CI on `main`, whether or not `api/` changed: both steps do nothing new when nothing changed, and that never misses a change whose own deploy was skipped because a newer commit had already landed. Only `main`'s newest commit is deployed (an older one never replaces it), two deploys never overlap, and a newer merge never cancels a deploy between its migration and its Worker upload.

It does nothing until you turn it on:

1. Create a Cloudflare API token (My Profile → API Tokens → Create Token, custom token) for your account only, with **Account → Workers Scripts → Edit** and **Account → D1 → Edit**. (Written from memory of the Cloudflare and wrangler docs, which were not reachable when this was written; if wrangler reports a missing permission, the "Edit Cloudflare Workers" template plus D1 Edit is the documented fallback.) Note your account ID (Workers & Pages → Overview, or `npx wrangler whoami`).
2. In the GitHub repository, Settings → Environments → New environment `cloudflare`. Under Deployment branches and tags choose Selected branches and add `main`.
3. In that environment, add the secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
4. Settings → Secrets and variables → Actions → Variables: add the repository variable `DEPLOY_API` = `true`. Delete it (or set anything else) to stop deploying from GitHub.

The Worker's own secrets (`TURNSTILE_SECRET`, `ADMIN_TOKEN` and the rest) stay in Cloudflare: `wrangler deploy` keeps them.

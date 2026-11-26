# Price suggestions API

A Cloudflare Worker with a D1 database: visitors suggest beer prices, and prices that 5 people (on 5 different networks) agree on are served to the app. Visitors can also report venues that moved, closed or are missing, and whether a venue has a terrace and where; reports only wait for the owner's review. And they can say the sun is on a terrace now: where 3 networks agree, the API serves a correction to that terrace's horizon. It also keeps anonymous daily usage counters (see [Usage counters](#usage-counters)). The design is in [ADR-0005](../docs/adr/0005-price-suggestions.md), for terraces [ADR-0009](../docs/adr/0009-terrace-reports.md), for the sun [ADR-0012](../docs/adr/0012-sun-reports.md) and for the counters [ADR-0013](../docs/adr/0013-anonymous-usage-counters.md).

| Endpoint                          | Who                | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /v1/suggestions`            | (unused)           | `{venueId, item, brand, cents, token}` (the token comes from Turnstile, action `suggest`); the app no longer calls it: the card back sends prices through `POST /v1/changes`                                                                                                                                                                                                                                                                                                                                       |
| `GET /v1/prices`                  | the app            | prices with consensus, except rejected ones; cached for 5 minutes (see below)                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `GET /v1/admin/suggestions`       | the admin view     | pending suggestions (`Authorization: Bearer <ADMIN_TOKEN>`)                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `POST /v1/admin/resolve`          | the admin view     | `{venueId, item, brand, cents, status: accepted \| rejected}`; a rejected price never counts again, until it is accepted                                                                                                                                                                                                                                                                                                                                                                                           |
| `POST /v1/login`                  | the app (`/admin`) | `{username, password}` → `{token}` (`OWNER_TOKEN`) when they match `OWNER_USERNAME` and `OWNER_PASSWORD`; `401` otherwise, `429` past 5 attempts per network in 15 minutes or 30 from everyone in an hour                                                                                                                                                                                                                                                                                                          |
| `GET /v1/owner/check`             | owner mode         | 200 when `Authorization: Bearer <OWNER_TOKEN>` is right                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `PUT` / `DELETE /v1/owner/prices` | owner mode         | `{venueId, item, brand, cents}`: a confirmed price, dated today (Madrid); a `PUT` also lifts a rejection of that exact price                                                                                                                                                                                                                                                                                                                                                                                       |
| `POST /v1/owner/changes`          | owner mode         | The card back as the owner's change: `{venueId, price?, move?, closed?, terrace?, pin?, sun?}`, no token. A price, or sun, is saved as confirmed and served at once; a move, closed, terrace answer or pin is stored as a report marked `by_owner`, which the admin applies without review                                                                                                                                                                                                                         |
| `POST /v1/owner/reports`          | owner mode         | `{kind: add, name, venueKind, terrace, lat, lon}` (or any report kind), no token, marked `by_owner` like the above                                                                                                                                                                                                                                                                                                                                                                                                 |
| `GET /v1/admin/owner-prices`      | (unused)           | owner prices, meant for an import into `venue_prices.csv` that is not built yet (nothing in `web/` calls it)                                                                                                                                                                                                                                                                                                                                                                                                       |
| `POST /v1/reports`                | the app            | `{kind: move, venueId, lat, lon, token}`, `{kind: closed, venueId, token}` or `{kind: add, name, venueKind, terrace, lat, lon, token}`; for terraces `{kind: terrace, venueId, terrace: true \| false, token}` or `{kind: pin, venueId, lat, lon, token}` (Turnstile action `report`). The app sends only `add` ("¿Falta un bar? Añádelo"); its moves and closures go through `POST /v1/changes`, which also carries the card's `terrace` and `pin` (#210)                                                         |
| `POST /v1/changes`                | the app            | The card back: `{venueId, token, price?: {item, brand, cents}, move?: {lat, lon}, closed?: true, terrace?: true \| false, pin?: {lat, lon}, sun?: true}`, at least one part (Turnstile action `change`). One bot check for all; each part is validated as on its own endpoint (`terrace` and `pin` as those report kinds, replacing the voter's open one) and counts once towards the caps; stored together or not at all. A `pin` with `terrace: false` is refused (`400 {error: "invalid pin with no terrace"}`) |
| `GET /v1/admin/reports`           | the admin view     | pending reports: `closed` grouped per venue and `terrace` per venue and answer (`reporters` = distinct networks), `move`, `pin` and `add` one per row, most reporters first (the owner's own, `owner: true`, before all)                                                                                                                                                                                                                                                                                           |
| `POST /v1/admin/reports/resolve`  | the admin view     | `{ids, status: accepted \| rejected}` → `{updated}`                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `GET /v1/sun`                     | the app            | horizon corrections from sun reports (see below), cached like `/v1/prices`                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `GET /v1/version`                 | CI's deploy        | `{build}`: the build fingerprint this Worker was deployed with (the `BUILD_ID` variable), or `null` when it was deployed without one; `Cache-Control: no-store`. See [Deploys from GitHub](#deploys-from-github)                                                                                                                                                                                                                                                                                                   |
| `GET /v1/admin/sun`               | the admin view     | pending sun reports, one entry per venue and season: `{ids, venueId, leafOff, sightings: [{id, azimuth, altitude, at}], reporters, shown, last}`, most reporters first                                                                                                                                                                                                                                                                                                                                             |
| `POST /v1/admin/sun/resolve`      | the admin view     | `{ids, status: accepted \| rejected}` → `{ok: true}`; a rejection blocks each report's slice of sky for a year                                                                                                                                                                                                                                                                                                                                                                                                     |
| `GET /v1/admin/sun/accepted`      | the admin view     | every accepted sun report (visitors' and the owner's) of the last 365 days, by id: `{reports: [{id, venueId, leafOff, azimuth, altitude, at}]}`, degrees to 1 decimal; the admin copies them into `pipeline/data/sun_corrections.csv`                                                                                                                                                                                                                                                                              |
| `POST /v1/events`                 | the app            | `{events: [{name, value?}]}`, at most 20 (`400` beyond, or for a body of another shape; `413` over 4 KB): anonymous usage counters. No bot check, no hashing, nothing about the visitor; each allowlisted (name, value) adds one to today's counter (Madrid date), anything else is dropped without a word. `204`, `Cache-Control: no-store`. The app sends it as `text/plain`, so no preflight                                                                                                                    |
| `GET /v1/admin/stats?days=N`      | the owner (curl)   | `{rows: [{day, name, value, count}]}` for the last N Madrid days, today included (default 30, also for a `days` that isn't a whole number from 1 up; at most 90, longer ranges are a `wrangler d1 execute` query, below), newest day first, then name and value; `Cache-Control: no-store`                                                                                                                                                                                                                         |

**Rejected prices.** Rejecting a price in the admin's Suggestions queue records its venue, item, brand and cents in `rejected_prices`: from then on no vote for it counts, neither the same voters voting again nor new networks, and it no longer shows in the queue. To undo a rejection, accept that price (`POST /v1/admin/resolve` with `status: accepted`; its earlier votes count again) or save it as an owner price at the same cents.

**Prices cache.** `GET /v1/prices` (and `GET /v1/sun` the same way, under its own key) is cached for 5 minutes in the browser (`Cache-Control`) and in the Worker: in the data centre's Cache API under one key whatever the query string, and for 60 seconds in the isolate's memory. Owner price writes and admin resolves purge both (for `GET /v1/sun`, the owner's sun reports and sun resolves), but only in the data centre and isolate that took the write, so elsewhere a change can take up to 5 minutes to show. New visitor votes don't purge it. CORS headers are added per request, so one cached answer serves every allowed origin.

**Sun reports** ([ADR-0012](../docs/adr/0012-sun-reports.md)). `sun: true` in a change says the sun is on the terrace now. The Worker computes the sun's azimuth and altitude at the venue's published position when it receives the report (suncalc), and refuses it with `400 {error: "sun is down"}` under 2°, or when the venue has no position. A report counts for the horizon bins within 5° of the sun's azimuth, in its season (leaf-off from 1 December to 15 March by Madrid date, or leaf-on), for 365 days. Where 3 networks report within that spread, `GET /v1/sun` caps the bin at the 3rd-lowest of their altitudes (each network at its lowest) less a 2° margin, as approximate; an accepted report, or the owner's own, caps it at its altitude less the margin, as confirmed. A voter's new report for the venue and season within 5° of their pending one replaces it. Rejecting reports records their slices in `sun_rejections`, where no consensus counts for a year. The answer:

```json
{
  "corrections": [
    {
      "venueId": "osm:node/123",
      "leafOff": false,
      "from": 171,
      "to": 186,
      "altitude": 243,
      "confirmed": false,
      "reporters": 3,
      "last": "2026-11-25T12:31:04.000Z"
    }
  ]
}
```

One entry per run of adjacent bins with the same cap and `confirmed`; `from` and `to` are inclusive bins, `from > to` across north; `altitude` is in tenths of a degree, like `horizon`. Sorted by venue, season, `confirmed` and `from`. It is cached as the prices are (below), and purged by the owner's sun reports and by resolves.

Reports are never applied by the API: the owner accepts them in the admin view, which writes `venue_review.csv`. A `move` must be within 500 m and a `pin` within 150 m of the venue's published position (`400 {error: "invalid position"}` otherwise). One open report of each kind per voter and venue; a new one replaces the old one (a terrace "yes" can become a "no").

## Spam and bot guardrails

Nothing about a visitor is kept in the browser: cookies or local storage would be wiped by exactly the person we want to stop, so closing the browser or opening a private window changes nothing. The API decides everything from the request:

- **Turnstile**: the token must pass, and come from the app's widget (`action: 'suggest'` for `POST /v1/suggestions`, `'report'` for `POST /v1/reports`, `'change'` for the card back's `POST /v1/changes`) on a hostname in `ALLOWED_ORIGINS`. Turnstile tokens are single-use. The test secrets in `.dev.vars.example` skip the hostname and action checks, and pass only on a request to `localhost`, `127.0.0.1` or `[::1]`: a deployed Worker with a test secret fails every bot check (and logs why).
- **Voter**: the IPv4 address, or the IPv6 /64 (a device can pick any address in its /64, so all of them are one voter). One vote per voter per venue, item and brand; a new vote replaces the old one.
- **Network**: the IPv4 /24 or IPv6 /48. Consensus and the review queue count distinct networks, so a person who gets new addresses (airplane mode, a router restart, a new IPv6 address) still counts once. Friends at the same bar on the same Wi-Fi count once too, which is the price of this rule.
- **Caps** (every accepted request counts, re-votes and venue reports included; 429 with `Retry-After` when hit): 20 a day per voter, 60 a day per network, 15 an hour per venue from everyone (a report of a missing venue counts against its area instead: a cell of about 1 km, `new:<lat>,<lon>` to 2 decimals). A change from the card's back counts once per part (price, move, closed, sun) and goes in only if all its parts fit. The check and the logging are one SQL statement, so parallel requests can't slip past a cap. The log behind them (`suggestion_events`) holds hashes only and is pruned after 48 hours.
- **Validity**: plausible prices only, venues in the published data only.
- Only hashes are stored, salted with `IP_SALT`; never an IP address. If `IP_SALT` is unset or shorter than 16 characters, `POST /v1/suggestions`, `POST /v1/reports` and `POST /v1/changes` answer `503 {error: "not configured"}` (and log why) rather than hash with a guessable salt.
- **Logs**: the Worker keeps no per-request invocation logs (`[observability.logs] invocation_logs = false` in `wrangler.toml`). Entries for errors remain in Workers Logs (`console.error`, such as the misconfigurations above, and uncaught exceptions) and may carry Cloudflare's own request metadata, which we have not inspected. Don't log request details (IP, headers, bodies) in `console.*`: the root README's Privacy section describe what is kept.
- **Body size**: 8 KB for every JSON body (4 KB for `POST /v1/events`), counted in bytes; a larger `Content-Length` is refused before reading, and a body without one stops being read at the limit (`413`).

The numbers live in `src/logic.ts`. A determined attacker with many networks (a residential proxy pool) can still get through; the review queue in the admin, where any suggestion can be rejected, is the last line.

## Usage counters

`POST /v1/events` keeps daily aggregate counters of how the app is used, and nothing else ([ADR-0013](../docs/adr/0013-anonymous-usage-counters.md)): one row per Madrid date, event name and value in `event_counts`, with a count. No IP (not even hashed), no voter or session id, no user agent, referrer, free text or position is read or stored, so the endpoint needs neither Turnstile nor `IP_SALT`. The allowlist is `web/src/data/telemetryEvents.ts`, which the Worker imports, so the app and the API can't disagree:

| Event          | Value                                             | When                                                      |
| -------------- | ------------------------------------------------- | --------------------------------------------------------- |
| `open`         | `phone` or `desktop` (the 900 px breakpoint)      | a page load                                               |
| `venue_open`   | the venue id, only if it is in the published data | a venue card opens (map, list, search or a link)          |
| `card_back`    |                                                   | a card turns to its back                                  |
| `time_change`  | the hour, `00` … `23` (Madrid)                    | the time slider comes to rest (1.5 s after the last move) |
| `filter`       | `sunNow` or `onlyTerrace`                         | a filter is switched on                                   |
| `search`       |                                                   | the first time the search box is typed in, per page load  |
| `locate`       |                                                   | the locate button is tapped                               |
| `add_open`     |                                                   | "¿Falta un bar? Añádelo" opens                            |
| `suggest_sent` |                                                   | a card-back change is sent and accepted                   |
| `sun_report`   |                                                   | a change with "the sun is here now" is sent and accepted  |

The app (`web/src/telemetry.ts`) sends nothing without an API, with Global Privacy Control or Do Not Track on, or in owner mode, and the admin never sends any. Anyone can inflate the counts: there are no caps, because a cap needs to know who is asking. The venue check and the fixed values keep the table bounded at about (venues + 40) rows a day whatever is sent.

**Reading the numbers.** With the admin token:

```bash
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  "https://<your-worker>.workers.dev/v1/admin/stats?days=7"
```

Or straight from the database (`npx wrangler login` first, in `api/`), for any range: for example each event's total from the UTC date 30 days ago (SQLite's `date('now', ...)` is UTC; `day` is a Madrid date, so the edge can be off by one day), and the most opened venues of all time:

```bash
npx wrangler d1 execute sol-y-cerveza --remote --command \
  "SELECT name, value, SUM(count) AS total FROM event_counts
   WHERE day >= date('now', '-30 days') GROUP BY name, value ORDER BY name, total DESC"
npx wrangler d1 execute sol-y-cerveza --remote --command \
  "SELECT value AS venue, SUM(count) AS opens FROM event_counts
   WHERE name = 'venue_open' GROUP BY value ORDER BY opens DESC LIMIT 20"
```

## Code

| File                                               | What                                                                                                    |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `src/index.ts`                                     | the Worker: the endpoint list, `route()` and CORS                                                       |
| `src/env.ts`                                       | `Env`, the bindings, vars and secrets                                                                   |
| `src/http.ts`                                      | JSON responses, size-capped bodies, bearer tokens                                                       |
| `src/guard.ts`                                     | the published venues (cached per isolate), Turnstile, `IP_SALT` and hashing, the caps (`takeAllowance`) |
| `src/routes/prices.ts`                             | suggestions, `GET /v1/prices` and its cache, the admin's suggestions queue                              |
| `src/routes/reports.ts`                            | `POST /v1/reports`, `POST /v1/changes` and the admin's reports queue                                    |
| `src/routes/owner.ts`                              | owner mode (prices, changes, reports) and `GET /v1/admin/owner-prices`                                  |
| `src/routes/events.ts`                             | `POST /v1/events` and `GET /v1/admin/stats`, the usage counters                                         |
| `src/logic.ts`, `src/reports.ts`, `src/changes.ts` | pure rules: parsing, limits, consensus, the report queue                                                |
| `src/sun.ts`                                       | pure rules of sun reports: the sun's position, the season, corrections and the sun queue                |
| `src/events.ts`                                    | pure rules of the usage counters: parsing, the allowlist check, adding up a batch, the stats window     |
| `scripts/deployCheck.ts`                           | CI's deploy guard (run by `scripts/deploy-check.ts`): build fingerprint, live build                     |

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
   - `npx wrangler secret put OWNER_USERNAME` and `npx wrangler secret put OWNER_PASSWORD` (the owner's login at `/admin`)
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

`.github/workflows/deploy-api.yml` applies the migrations (`wrangler d1 migrations apply sol-y-cerveza --remote`) and deploys the Worker (`wrangler deploy`). CI calls it from its `deploy-api` job once `ci-ok` passes on a push to `main`, on the commit CI tested; it can also be run by hand from Actions on `main`, and behaves the same. Only `main`'s newest commit is deployed (an older one never replaces it), two deploys never overlap, and a newer merge never cancels a deploy between its migration and its Worker upload.

**Skip and verify.** It runs after every green CI on `main`, but uploads only what the live Worker is not already running, and fails when an upload does not take effect:

1. It builds the Worker without uploading it (`wrangler deploy --dry-run`, no credentials needed) and fingerprints the build: sha256 over the bundled JavaScript (not the source map, which holds absolute paths), `wrangler.toml`, every file in `migrations/` (names and contents) and the wrangler version, kept to 32 hex characters (128 bits). Code from outside `api/` that the Worker imports (`web/src/data/`) is in the bundle, so it counts; a change that leaves the bundle as it was (a comment, the docs) does not.
2. It asks the live API (`GET /v1/version` on the `PRICES_API` repository variable, the same URL the site is built with) which build it runs. **Only** when the answer is exactly that fingerprint does it skip the migrations and the upload, with a notice naming the build. Anything else deploys as before: another build, `null`, a `404`, an error, a timeout (10 s), an answer that is not the expected JSON, or `PRICES_API` unset. A docs-only merge therefore doesn't upload the Worker again or call Cloudflare's API.
3. When it deploys, it applies the migrations, then uploads with `--var BUILD_ID:<fingerprint>` (a plain variable alongside `[vars]`; it doesn't change the bundle) and asks `GET /v1/version` again, up to 13 times 5 s apart (about a minute), until it reports the new build. If it never does, the job fails with an error naming the build expected and the last answer seen. With `PRICES_API` unset this check can't run: the job passes with a warning.

The rules live in `scripts/deployCheck.ts` (tested in `scripts/deployCheck.test.ts`), and the workflow's steps call `node scripts/deploy-check.ts fingerprint <outdir>`, `decide` and `verify` (reading `API_URL` and `BUILD`); you can run them locally the same way.

**Deploying by hand.** A plain `npx wrangler deploy` leaves `BUILD_ID` unset, so the live API reports `build: null` and the next CI run on `main` deploys again and stamps it. To stamp a deploy by hand, from a clean checkout of `main` after the migrations:

```sh
npx wrangler deploy --dry-run --outdir /tmp/worker
BUILD=$(node scripts/deploy-check.ts fingerprint /tmp/worker | sed -n 's/^build=//p')
npx wrangler deploy --var "BUILD_ID:$BUILD"
```

It does nothing until you turn it on:

1. Create a Cloudflare API token (My Profile → API Tokens → Create Token, custom token) for your account only, with **Account → Workers Scripts → Edit** and **Account → D1 → Edit**. (Written from memory of the Cloudflare and wrangler docs, which were not reachable when this was written; if wrangler reports a missing permission, the "Edit Cloudflare Workers" template plus D1 Edit is the documented fallback.) Note your account ID (Workers & Pages → Overview, or `npx wrangler whoami`).
2. In the GitHub repository, Settings → Environments → New environment `cloudflare`. Under Deployment branches and tags choose Selected branches and add `main`.
3. In that environment, add the secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. The `deploy` job in `deploy-api.yml` declares the environment, and CI's `deploy-api` job calls it with `secrets: inherit`; without that the two came through empty when CI called it (a manual run was unaffected). Because inherit makes every repository secret available to `deploy-api.yml`, that file must read no secret but these two and `github.token`, and the caller job must stay limited to pushes to `main`.
4. Settings → Secrets and variables → Actions → Variables: add the repository variable `DEPLOY_API` = `true`. Delete it (or set anything else) to stop deploying from GitHub.

The Worker's own secrets (`TURNSTILE_SECRET`, `ADMIN_TOKEN` and the rest) stay in Cloudflare: `wrangler deploy` keeps them.

# ADR-0013: Anonymous usage counters

- Status: accepted (2026-11-26)
- Date: 2026-11-26
- Issue: #485
- Amended (2026-11-26, #495): the Worker no longer keeps per-request invocation logs (`[observability.logs] invocation_logs = false` in `api/wrangler.toml`). Workers Logs still hold entries for errors (`console.error`, uncaught exceptions), which may carry Cloudflare's own request metadata; we have not inspected what that metadata includes. Cloudflare's and GitHub Pages' own infrastructure logs are unchanged and outside our control. "What we control, and what we don't" below describes the state before this change. README.md's Privacy section describe what is stored now.

## Context

The owner wants to see how visitors use the app, to know what to improve: how many people open it, on phones or desktops, which venues they look at, which hours they check, whether they use the filters, search, the locate button and the card's back. Until now nothing was measured. GitHub Pages gives no visitor numbers, and the API only sees the few people who send a suggestion.

The app's promise to visitors is that nothing about them is kept: the API's guardrails store only salted hashes, and only for the cap log (ADR-0005). Usage numbers must not break that.

## Decision

The app counts a short, fixed list of events into **daily aggregate counters** in the API's D1 database, and nothing else.

1. **The principle: counters only.** Nothing about a visitor is ever stored or derivable. No cookie, no localStorage or sessionStorage, no visitor or session id, no IP address (not even hashed), no user agent, no referrer, no free text, no coordinates. A stored row is a Madrid calendar date, an event name, a value and a count (`event_counts`, migration `0010_event_counts.sql`); an event adds one to its row and is then gone. Events are not timestamped, ordered or linked to each other, so no row can be traced back to a person or a visit.
2. **A fixed allowlist.** The names and values are in one file, `web/src/data/telemetryEvents.ts`, which the app and the Worker both import (as they share `geo.ts`), so the two can't drift apart. Each name has a fixed set of values or none. The one open-ended value is the venue id of `venue_open`, which the Worker counts only for a venue in the published data (the same `TERRACES_URL` check as the suggestion routes). Anything else is dropped without a word. The events: `open` (`phone` or `desktop`), `venue_open` (venue id), `card_back`, `time_change` (the hour, `00` … `23`, Madrid, once the slider rests), `filter` (`sunNow` or `onlyTerrace`, switched on), `search` (once per page load, never the text), `locate` (never the position or whether permission was given), `add_open`, `suggest_sent` and `sun_report`.
3. **One small request, now and then.** `web/src/telemetry.ts` keeps events in memory and sends them together in one `POST /v1/events` (at most 20 events) a few seconds later, when 20 are waiting, or when the page is hidden (`fetch` with `keepalive`, so it still goes as the tab closes). The body is JSON sent as `text/plain`, so the browser sends it without a CORS preflight, with `credentials: 'omit'` and `referrerPolicy: 'no-referrer'`. It never retries, never throws and never makes the visitor wait. The endpoint has no Turnstile and does not touch the hashing in `guard.ts`, so it does not depend on `IP_SALT`; it answers `204` (`400` for a malformed body).
4. **GPC and DNT respected.** With Global Privacy Control (`navigator.globalPrivacyControl`) or Do Not Track (`navigator.doNotTrack === '1'`) on, the app sends nothing. It also sends nothing without an API (`VITE_PRICES_API` unset), in owner mode (the owner's own use would skew the numbers) or from the admin.
5. **No unique visitors.** Counting distinct people needs something that recognises a person again (a cookie, a stored id, a hashed IP), which is exactly what the principle rules out. `open` counts page loads, not people; that is enough to see trends.
6. **No consent banner.** Our reasoning, not legal advice: nothing is stored on or read from the visitor's device for this (no cookie, no storage), and no personal data is processed (no identifier, no IP stored, nothing that can single out a person), so there is nothing to ask consent for. The README's Privacy note says what is counted and what is not.
7. **The owner reads them** with `GET /v1/admin/stats?days=N` (the admin token, like the other `/v1/admin/*` routes; at most 90 days) or straight from D1, for any range, with `wrangler d1 execute` ([api/README.md](../../api/README.md#usage-counters)).

## Alternatives considered

- **A third-party analytics service** (Google Analytics, Plausible, Cloudflare Web Analytics and the like): rejected. Each is another party receiving every visitor's request, IP and user agent, under its own terms and retention; most set or read identifiers, and several would need a consent banner. Our own counters keep the data in the database we already run, with exactly the fields we chose.
- **Workers Analytics Engine:** rejected for now. It would suit the volume, but it is another binding and product to set up, its data is kept for a limited time and read through a separate SQL API, and it would hold the same counters D1 already can. D1 needs nothing new and keeps the numbers as long as the owner wants.
- **Counting per session or per visitor:** rejected, see decision 5.

## Consequences

- One migration, `api/migrations/0010_event_counts.sql`, additive; CI's deploy applies it before the new Worker goes live (`deploy-api.yml`), as every migration.
- **Anyone can inflate the counts.** There is no bot check and no cap, because a cap needs to know who is asking. The numbers are a guide to trends, not an audit. If they are ever abused, a cap on the whole endpoint (not per visitor) is the step that keeps the principle.
- **Bounded cardinality.** Fixed values plus published venue ids keep the table at about (venues + 40) rows a day at most (around 700 today, hence the 90-day cap on `GET /v1/admin/stats`), whatever anyone sends, and every request is at most 20 events and 4 KB.
- **Counters only.** Questions that need sequences or people (funnels, retention, time on the page, where visitors come from) can't be answered, by design. Adding an event means adding it to the allowlist file; adding an identifier, an IP, free text or coordinates is never allowed (CLAUDE.md invariants).
- **What we control, and what we don't.** The principle covers what the app sends and what our database stores. Cloudflare, which runs the Worker, keeps its own short-lived request logs for every API request (Workers Logs, `[observability]` in `wrangler.toml`, with no sampling), as it already did for `GET /v1/prices` and `GET /v1/sun`; GitHub Pages, which serves the site, keeps its own too. We don't know exactly which request metadata those logs hold, and we never copy any of it into our data.

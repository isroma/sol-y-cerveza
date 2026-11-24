# ADR-0005: Beer prices from curators and visitors

- Status: Accepted
- Date: 2026-11-23
- Issue: #8

## Context

The app shows a typical beer price per venue: a caña (draught) and tercios (33 cl bottles) by brand. No open dataset has bar prices. A probe of the 141 known venue websites (2026-11-23) found 0 published beer prices. Google Maps, TripAdvisor, Instagram and delivery apps have prices but forbid scraping and redistribution (see CLAUDE.md, "Data and licensing").

## Decision

Two sources:

1. **Curators** enter prices in the local admin view (`venue_prices.csv`, published like any data change). These go into `terraces.json` as `prices` and are shown as confirmed.
2. **Visitors** suggest prices in the app. They go to a small API (`api/`): a Cloudflare Worker with a D1 database.
   - **Bots:** every suggestion needs a valid Cloudflare Turnstile token.
   - **Spam:** one vote per person (a salted SHA-256 of the IP) per venue, item and brand, where a new vote replaces the old one. There is a cap of 20 suggestions per person per day. (Tightened in "Guardrails against repeat voters" below.)
   - **Validity:** prices outside plausible ranges (caña 0,50–6,00 €, tercio 0,80–8,00 €) are rejected, and so is any venue that isn't in the published data.
   - **Automatic display:** when at least 5 people agree on the same price within 12 months, `GET /v1/prices` returns it. The app shows it marked as approximate ("~1,50 €"). Rejected suggestions never count.
   - **Review queue:** all pending suggestions show up in the admin view. Accepting one turns it into a curator price (and ships with Publish); rejecting hides it.

Cloudflare was chosen over Supabase because Turnstile, the Worker and D1 come from one account on the free tier, and a free Supabase project pauses after a week without traffic.

### Guardrails against repeat voters (2026-11-24, #196)

A salted IP hash alone let one person count as many: every address in an IPv6 /64 was a new person, a new mobile IP (airplane mode) was a new person, re-votes didn't count toward the cap, and Turnstile tokens weren't tied to our site. Changes:

- **Voter** = IPv4 address or IPv6 /64. **Network** = IPv4 /24 or IPv6 /48. Both stored as salted hashes.
- Consensus (the 5) counts distinct **networks**. Rows from before this change count as their own network each.
- Caps count every accepted request (a `suggestion_events` log, pruned after 48 h): 20 a day per voter, 60 a day per network, 15 an hour per venue.
- Turnstile must report our hostname and the widget's action `suggest`.
- No browser-side identity (cookie, local storage, fingerprint): it is cleared by exactly the person it should stop, and fingerprinting would need a consent banner.

Accepted risk: people sharing a network (a bar's Wi-Fi, some mobile CGNAT ranges) count as one toward consensus, and an attacker with a residential proxy pool can still reach 5. The review queue remains the backstop.

### Owner mode (2026-11-23)

The owner records prices at the bar from their phone, without the laptop.

- **Unlocking:** a private link carrying `OWNER_TOKEN` turns on owner mode on the public site. The token is kept in the phone's local storage.
- **Saving:** the venue card gets price fields, which save straight to `owner_prices` in D1 (`PUT /v1/owner/prices`). `GET /v1/prices` serves those prices as confirmed (no "~"), replacing visitor prices for the same item. They're dated with the Madrid date.
- **Photo:** "Foto de la carta" sends a downscaled photo to `POST /v1/owner/photo`, which reads the prices and the bar's name with the Claude API, using the same prompt and price rules as the admin's photo reader (`web/src/data/photoReading.ts`). The photo isn't stored.
- **Auto-save:** the app saves clear readings for a clearly matched bar and asks for anything unclear. The bar is matched by the card that's open, or, for a photo from the library, by its GPS location and the name on the menu.
- **Scope of the token:** `OWNER_TOKEN` can only add or remove prices; it can't touch the suggestion queue or the repo. A leaked token means bad prices, which the owner can delete, and the token can be replaced with `wrangler secret put`.
- **Repo copy:** the admin's "Import phone prices" copies owner prices into `venue_prices.csv`, so the repo keeps the full record and Publish ships them as usual.

### Venue reports (2026-11-24, #200)

Visitors can also report that a venue is in the wrong place (`move`), no longer exists (`closed`) or is missing (`add`), through `POST /v1/reports` on the same Worker.

- **Never applied automatically.** Unlike prices, a report can't be shown at runtime: a moved or new venue needs the pipeline to compute its terrace horizon from the LiDAR model, and a wrongly closed venue would vanish from the map. So there is no consensus threshold; every report waits in the admin's Reports queue, the owner accepts it into `venue_review.csv`, and it ships with Publish like any review. The queue groups `closed` reports per venue and shows how many networks sent them, as evidence, not as a trigger.
- **Same guardrails as prices.** Turnstile (action `report`), the same voter and network hashes, and the shared `suggestion_events` caps (an `add` counts against the venue key `new`). One open `move` and one open `closed` per voter and venue; a new one replaces the old one.
- **Validity:** positions inside the Badajoz box; a `move` at most 500 m from the published position (a correction, not a relocation); `move` and `closed` only for venues in the published data; names for an `add` cleaned and 2 to 60 characters, no links.

## Consequences

- The site stays static: suggested prices load at runtime, so a consensus shows up without a rebuild.
- **Privacy:** no raw IP addresses, accounts or cookies are stored. The salt is a Worker secret, so the hashes can't be reversed by someone who reads the database.
- The owner needs a Cloudflare account. Setup steps are in `api/README.md`.
- The threshold (5) and the ranges live in `api/src/logic.ts`; the report rules in `api/src/reports.ts`.

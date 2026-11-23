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
   - **Spam:** one vote per person (a salted SHA-256 of the IP) per venue, item and brand, where a new vote replaces the old one. There is a cap of 20 suggestions per person per day.
   - **Validity:** prices outside plausible ranges (caña 0,50–6,00 €, tercio 0,80–8,00 €) are rejected, and so is any venue that isn't in the published data.
   - **Automatic display:** when at least 5 people agree on the same price within 12 months, `GET /v1/prices` returns it. The app shows it marked as approximate ("~1,50 €"). Rejected suggestions never count.
   - **Review queue:** all pending suggestions show up in the admin view. Accepting one turns it into a curator price (and ships with Publish); rejecting hides it.

Cloudflare was chosen over Supabase because Turnstile, the Worker and D1 come from one account on the free tier, and a free Supabase project pauses after a week without traffic.

### Owner mode (2026-11-23)

The owner records prices at the bar from their phone, without the laptop.

- **Unlocking:** a private link carrying `OWNER_TOKEN` turns on owner mode on the public site. The token is kept in the phone's local storage.
- **Saving:** the venue card gets price fields, which save straight to `owner_prices` in D1 (`PUT /v1/owner/prices`). `GET /v1/prices` serves those prices as confirmed (no "~"), replacing visitor prices for the same item. They're dated with the Madrid date.
- **Photo:** "Foto de la carta" sends a downscaled photo to `POST /v1/owner/photo`, which reads the prices and the bar's name with the Claude API, using the same prompt and price rules as the admin's photo reader (`web/src/data/photoReading.ts`). The photo isn't stored.
- **Auto-save:** the app saves clear readings for a clearly matched bar and asks for anything unclear. The bar is matched by the card that's open, or, for a photo from the library, by its GPS location and the name on the menu.
- **Scope of the token:** `OWNER_TOKEN` can only add or remove prices; it can't touch the suggestion queue or the repo. A leaked token means bad prices, which the owner can delete, and the token can be replaced with `wrangler secret put`.
- **Repo copy:** the admin's "Import phone prices" copies owner prices into `venue_prices.csv`, so the repo keeps the full record and Publish ships them as usual.

## Consequences

- The site stays static: suggested prices load at runtime, so a consensus shows up without a rebuild.
- **Privacy:** no raw IP addresses, accounts or cookies are stored. The salt is a Worker secret, so the hashes can't be reversed by someone who reads the database.
- The owner needs a Cloudflare account. Setup steps are in `api/README.md`.
- The threshold (5) and the ranges live in `api/src/logic.ts`.

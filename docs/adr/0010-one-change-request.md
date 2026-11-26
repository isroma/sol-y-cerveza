# ADR-0010: One change request from the card back

- Status: accepted (2026-11-24)
- Date: 2026-11-24
- Amended (2026-11-26): `POST /v1/changes` also carries the terrace answer (`terrace: true | false`) and the tables pin (`pin: {lat, lon}`) of [ADR-0009](0009-terrace-reports.md), each a venue report counted as one part; a `pin` with `terrace: false` is refused. The app UI that sends them is still to come (#210).
- Issue: #242 (and #233, #235, #239 before it)

## Context

The venue card got a back for suggesting changes (#234): a price (caña, or a tercio by brand), "Ubicación" to move the venue on the map, and a "Ya no existe" switch, with one Enviar. The API had one endpoint per kind of change, each behind its own Cloudflare Turnstile check with its own action: `POST /v1/suggestions` (action `suggest`, [ADR-0005](0005-price-suggestions.md)) and `POST /v1/reports` (action `report`, ADR-0005 "Venue reports"). A Turnstile token works once, for one action, so the back ran one check per part it sent.

What happened next, in order:

- #236 started both checks as the back opened, so their tokens were ready while the visitor typed, instead of loading Cloudflare's script after the first keystroke.
- On the live site Cloudflare then showed a box for each check. #240 started only the price check on open and the report check when "Ya no existe" was turned on. Its notes say a visitor sending a price and "Ya no existe" together could still meet two checks, and that one box in every case needs one combined request, verified once.

## Decision

The card back sends everything in **one request behind one Turnstile check**.

1. **One endpoint.** `POST /v1/changes` (`api/src/changes.ts`, #243) takes `{venueId, token, price?, move?, closed?}` with at least one part, and one token from a widget with action `change`.
2. **Same rules as each part's own endpoint.** The price goes through `parseSuggestion` (range, brand), a move and a closed report through `parseReport` (inside the Badajoz box, a move at most 500 m from the published position), and the venue must be in the published data.
3. **All or nothing.** Every part is written in one D1 batch, so the change is stored together or not at all. Nothing is stored when any part is refused.
4. **Caps as if sent separately.** The spam and rate caps of ADR-0005 are checked for the request, and each part is logged as one event, so it counts towards the caps as its own request would.
5. **The app** (#245) sends the price, the new location and "Ya no existe" in that one request. The location picker's button became **Listo**, which brings the spot back to the card's back to be sent with the rest; the draft and its token live in App, so the trip to the map runs no second check. A token older than 4 minutes is dropped and checked again (Turnstile tokens last 5).
6. **The check starts with the back.** After a run where the check started on the first edit (#245), the owner asked for it to start as soon as "Sugerir un cambio" turns the card, with only a spinner while it runs (#246, #250).
7. **The old endpoints stay.** `POST /v1/reports` still takes the add-a-venue picker's reports (its own check, action `report`). `POST /v1/suggestions` is kept for older cached copies of the app, but the app no longer calls it.

## Consequences

- Cloudflare shows at most one box per change, whatever the visitor sends.
- The Worker had to be deployed before the web change: until then the live API had no `/v1/changes` and every send from the card back would have failed (#245, "Notes for the reviewer"). `DEPLOY_API` wasn't set, so that deploy was by hand.
- Turnstile's real widget only runs on the site's own host, so the checks were tested with Cloudflare's test keys, not against production behaviour.
- Rules for each kind of change still live in one place (`api/src/logic.ts`, `api/src/reports.ts`); `changes.ts` only combines them.

## Alternatives considered

- **Two checks, started at different times** (#240): fewer boxes than #236, but still two for a price plus "Ya no existe".
- **Start every check on open** (#236): tokens ready sooner, but Cloudflare showed a box per check.

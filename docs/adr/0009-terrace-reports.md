# ADR-0009: Terrace reports from visitors

- Status: Accepted
- Date: 2026-11-24
- Issue: #210

## Context

The dataset has 695 venues. The owner has reviewed 106; none of the other 607 has a terrace marked, because no open source says whether a bar puts tables outside. The owner can't survey them all alone, and the people who walk past these bars every day already use the app.

Visitors can already suggest prices (ADR-0005) and report a venue that moved, closed or is missing (ADR-0005, "Venue reports"). Neither covers the main gap: whether a venue has a terrace, and where its tables are.

## Decision

Two more kinds of venue report, through the same `POST /v1/reports`, table (`venue_reports`) and queue:

| Kind | The visitor says | Accepting it in the admin writes to `venue_review.csv` |
| --- | --- | --- |
| `terrace` | "It has a terrace" or "It has none" (`terrace: true \| false`) | status `terrace` or `no_terrace` |
| `pin` | "The terrace is here" (a point at most 150 m from the published venue) | status `terrace` with that terrace position |

**Nothing applies by itself.** The dataset is a committed file built offline: a terrace needs a horizon from the LiDAR rasters before the app can say anything about its sun, so a report can't be shown at runtime the way a price can. Every report waits in the admin's Reports queue; accepting one writes the same review row the admin writes by hand, and it ships with Publish and the next build.

**Agreement only raises priority.** The queue groups `terrace` answers per venue and answer, with `reporters` = distinct networks, the count that price consensus uses. So the owner sees "Terrace: yes · 4 people" next to "Terrace: no · 1 person" and starts with the venues most people agree on. A `pin` is one entry per report, like a `move`, because two positions rarely agree to the metre.

**The guardrails are the price ones, unchanged.** Turnstile action `report`, the same voter (IPv4 or IPv6 /64) and network (IPv4 /24 or IPv6 /48) hashes, and the shared `suggestion_events` caps (20 a day per voter, 60 per network, 15 an hour per venue). One open answer and one open pin per voter and venue: a new one replaces the old one, so a "yes" can become a "no" but never counts twice. Positions must be inside the Badajoz box, and the venue must be in the published data. No free text.

`api/migrations/0005_terrace_reports.sql` rebuilds `venue_reports` with the wider `CHECK` rules (SQLite can't alter a constraint) and keeps every row and id.

## Alternatives considered

- **Auto-apply on consensus** (for example 5 networks say yes): rejected. The result would be a terrace without a horizon, so no sun answer, and a coordinated group could flip a venue. The queue sorted by agreement keeps the owner's review cheap.
- **A pin that also answers yes**: kept separate. A visitor who knows there are tables but not exactly where should still be able to say so in one tap, and the owner can accept a yes and a pin independently.

## Follow-up (not built)

A served "community says terrace: yes" flag. `GET /v1/reports/terraces` could list venues where at least 5 networks said yes and none (or far fewer) said no, cached like `/v1/prices`, and the card of a still-unconfirmed venue could say "Terraza según visitantes" instead of "Terraza sin confirmar". It would help before the owner gets to a venue, but it still shows no sun (no horizon until the build), and it needs its own anti-flip rule. Worth it only if the queue falls behind; decide after seeing real volumes.

## Consequences

- One migration; the owner runs `npm run migrate:remote` before `npm run deploy` in `api/`.
- The site stays static, and nothing a visitor sends reaches `terraces.json` without the owner.
- Terrace answers share the caps with prices and the other reports.

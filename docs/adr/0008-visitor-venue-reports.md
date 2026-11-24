# ADR-0008: Visitor venue and terrace reports

- Status: Accepted
- Date: 2026-11-24
- Issues: #201, #202, #210

## Context

The dataset has 695 venues. The owner has reviewed 106; none of the other 607 has a terrace marked, and some venues are closed, misplaced or missing. The owner can't survey them all alone. Visitors already suggest beer prices through the API (ADR-0005), and the same people walk past these bars every day.

Unlike a price, a venue fact can't be shown at runtime: a moved venue, a terrace position or a new venue needs the pipeline to compute its horizon from the LiDAR rasters. The dataset is `web/public/data/terraces.json`, a committed file built offline.

## Decision

Visitors report five kinds of fact, all through `POST /v1/reports` on the existing Worker:

| Kind | What the visitor says | Accepting it in the admin writes to `venue_review.csv` |
| --- | --- | --- |
| `terrace` | "It has a terrace" / "It has none" | status `terrace` / `no_terrace` |
| `pin` | "The terrace is here" (a point ≤ 150 m from the venue) | status `terrace` with that terrace position |
| `move` | "The venue is somewhere else" (≤ 500 m away) | the venue position |
| `closed` | "It's closed / doesn't exist" | `not_venue` (an added `review:` venue is deleted) |
| `add` | "A bar is missing": name, kind, terrace yes/no, position | a new `review:` venue (`terrace` when the visitor said so) |

**Nothing applies by itself.** Every report waits in the admin's Reports queue until the owner accepts or rejects it. Accepting writes the same review row the admin writes by hand, so it ships with Publish and the next build, like any review.

**Consensus only raises priority.** The queue lists `closed` grouped per venue and `terrace` grouped per venue and answer, with `reporters` = distinct networks (the same count as price consensus), most reporters first. The yes and no counts for a venue show side by side, so a split answer is visible. `move`, `pin` and `add` are one entry per report, because two positions rarely agree to the metre.

**Abuse guardrails are the price ones (ADR-0005), not new ones:**

- Turnstile, with its own action `report` (a price token can't be replayed as a report, and the other way round), on our hostnames.
- The same voter (IPv4 or IPv6 /64) and network (IPv4 /24 or IPv6 /48) hashes, salted with `IP_SALT`.
- The same caps, counted in the same `suggestion_events` log, so prices and reports share them: 20 a day per voter, 60 a day per network, 15 an hour per venue. All new-venue reports share one venue key (`new`).
- One open report per voter, venue and kind; a new one replaces the old one (a "yes" can become a "no"). A voter may report several new venues.
- Positions must be inside the Badajoz box (south 38.84, west −7.04, north 38.92, east −6.92), rounded to 6 decimals; `move` and `pin` must stay near the published venue; venue reports need a venue in the published data.

**No free text** except the name of a missing bar: 2–60 characters after cleaning (commas, quotes and line breaks become spaces), letters, digits and the punctuation names use, at least one letter, nothing that looks like a link. No comments, photos or contact details are stored.

## Alternatives considered

- **Auto-apply on consensus** (e.g. 5 networks say "terrace: yes"): rejected for now. The dataset is built offline and committed; a runtime overlay would show venues as terraces with no horizon (no sun answer), and a coordinated group could flip a venue. The owner's review is cheap with the queue sorted by agreement.
- **A separate table per kind or a separate Worker**: rejected; one `reports` table and the existing Worker, identity and caps keep one system to secure.

## Follow-up (not built)

A served "community says terrace: yes" flag: `GET /v1/reports/terraces` could return venues where at least 5 networks said yes and none (or far fewer) said no, and the app could show "Terraza según visitantes" on those still-unconfirmed venues. It would help visitors before the owner gets to them, but it shows no sun (there is no horizon until the build), so it is only worth it if the queue falls behind. Decide after seeing real report volumes.

## Consequences

- One new D1 table (`api/migrations/0004_reports.sql`); the owner runs `npm run migrate:remote` and `npm run deploy` in `api/`.
- The site stays static, and nothing a visitor sends reaches `terraces.json` without the owner.
- The 429 caps are shared: a visitor who spends 20 requests on prices can't send reports that day, and the other way round.

# ADR-0012: Sun reports from visitors

- Status: accepted (2026-11-25)
- Date: 2026-11-25
- Amended (2026-11-26, #463): accepted corrections are also in the dataset. Accepted reports are recorded in `pipeline/data/sun_corrections.csv`, which the build turns, with the same rules as `GET /v1/sun`'s confirmed runs, into an optional `sun_corrections` list per terrace in `terraces.json` ([data contract](../data-contract.md)). The app applies that list as confirmed corrections, merged with the API's, so they hold with no API at all. The model's horizons stay untouched. The admin side (writing the CSV from the API's accepted reports, and shipping it with Publish) lands in its own PR (#463).
- Issue: #364
- Amended (2026-11-27, #527): shade reports are accepted too, when the weather at that moment shows the sun was out ([ADR-0014](0014-shade-reports.md)). Decision 1 and the rejected "Shade reports too" below describe the state before that.
- Amended (2026-11-27, #535): in the leaf-on season a cap that contradicts a deciduous crown applies across the whole crown, down to the leaf-off horizon there ([ADR-0015](0015-sun-reports-span-deciduous-crowns.md)).

## Context

The app's sun answer comes from a model: a 360° horizon per terrace, computed offline from a LiDAR surface model (ADR-0002, ADR-0007), compared with the sun's position. The model is sometimes wrong. A tree was pruned, an awning is gone, the surface model has a lamp post or the edge of a crown where there is open sky, and a terrace sitting in sun shows as shade. The people sitting there can see it; nothing lets them say so.

Issue #364 asked whether visitors could correct this. The owner asked for it to be built, with a consensus threshold like prices (ADR-0005) and a balance between the model and the reports.

## Decision

From the venue card's back, a visitor can say **"the sun is on this terrace now"**. It is one more part of the card back's one request (`sun: true` in `POST /v1/changes`, ADR-0010), and it lowers that terrace's horizon where the sun was, once enough people agree. The API side is built here (`api/src/sun.ts`, `api/src/routes/sun.ts`, migration `0009_sun_reports.sql`); the app side is `web/src/sun/corrections.ts` and the card back (`web/src/reports/SuggestChange.tsx`), and the admin side the Inbox's Sun filter ([docs/admin.md](../admin.md#sun-reports)).

1. **Sun only, no shade.** Shade can be a cloud, and the app ignores weather by design (owner, 2026-11-23). A visitor in shade under a clear sky and one under a cloud look the same to us; a visitor in sun is unambiguous.
2. **The server decides where the sun was.** The Worker stamps the report with the instant it receives it and computes the sun's azimuth and altitude itself, with suncalc (the app's library and version), at the venue's published position. Nothing comes from the device: no clock, no geolocation, no free text. A report is refused with `400 {error: "sun is down"}` when the sun is under `MIN_SUN_ALTITUDE = 2°`, and a venue without a published position is refused too.
3. **A report corrects the horizon, not a time slot.** Sun seen with the sun at azimuth A and altitude H means the horizon near A is below H. A correction caps the horizon bins within `SUN_SPREAD_DEGREES = 5` of A (11 bins) at `H - SUN_MARGIN_DEGREES` (2°), floored to tenths of a degree. The app takes the lower of the model's horizon and the cap, so a correction made at 13:00 also answers 13:10, and tomorrow.
   - **Why a 2° margin:** from midsummer to midwinter the sun's path drops by up to about 0.4° a day (around the September equinox), so a cap exactly at H would stop helping within days at that hour. 2° keeps it valid for a week or two of the sun's descent, and still only claims sky the visitor's sun was well inside.
   - **Why ±5°:** the sun moves about 1° of azimuth every 4 minutes near noon, and the published position is the venue's, not the visitor's table. A 10° slice covers the minutes either side of the report and the width of a terrace, without reaching sky nobody saw.
4. **Seasons stay apart.** A report counts only in the season it was made in, leaf-off (by Madrid date, the rule of ADR-0007: while Sentinel-2 sees the deciduous crowns bare, 1 December to 15 April at the latest) or leaf-on. Sun through bare branches in January says nothing about July.
5. **Consensus of 3 networks.** A visitor correction is served when `SUN_THRESHOLD = 3` distinct networks (the IPv4 /24 or IPv6 /48 of ADR-0005, not voters) report within the spread of a bin, in that season. The cap there is the **3rd-lowest** altitude among them (each network counted once, at its lowest altitude there), minus the margin: the level at least 3 networks support.
   - **Why 3 and not the 5 of prices:** a price needs 5 networks on one number for a venue. A sun report only counts in a 10° slice of sky and in one season, so reports spread much thinner, and 5 per slice would practically never be reached in a one-city app. A wrong "sun" is also cheaper than a wrong price: it is shown as approximate, it only ever adds sun, and the owner's queue is the backstop.
6. **Balance between the model and visitors.** The model stays the default answer everywhere. Visitor consensus only ever adds sun, only inside the slice of sky they saw, only down to the altitude they saw (less the margin), only in that season, and it shows as approximate ("~", like visitor prices) until the owner confirms it. Reports older than `SUN_WINDOW_DAYS = 365` stop counting.
7. **The owner reviews.** Every pending report shows in the admin's queue (`GET /v1/admin/sun`), below or at the threshold, one entry per venue and season, with `shown` when it is already behind a served consensus.
   - **Accept:** the reports become confirmed. One accepted report is enough on its own: the cap is the lowest accepted altitude in the spread, minus the margin, served without "~".
   - **Reject:** the reports stop counting, and each one's slice (its bin ± 5°, that season) is recorded in `sun_rejections`: for `SUN_WINDOW_DAYS` no visitor consensus lowers that venue's horizon there, whoever reports it, so a coordinated group can't bring it back with new networks.
   - **The owner's own report** in owner mode (`POST /v1/owner/changes`) is stored accepted (`by_owner`), so it shows at once as confirmed, like an owner price.
8. **The same guardrails as the rest of the card back.** One Turnstile check for the whole change, the sun report counts as one part towards the caps (ADR-0005, ADR-0010), and every part is stored in one D1 batch or none is. The same voter reporting the same venue again in the same season within the spread of a pending report replaces it.
9. **Served like prices.** `GET /v1/sun` lists runs of adjacent bins with the same cap (`from`, `to`, inclusive, `from > to` across north; `altitude` in tenths of a degree, as `horizon`), confirmed or not, cached for 5 minutes and purged by the owner's writes and resolves, exactly as `GET /v1/prices`.

This changes one invariant: sun reports, like prices, are shown on consensus without review. Venue reports (moves, closures, missing venues, terraces) still never apply on their own.

## Alternatives considered

- **Shade reports too:** rejected. Shade can be weather, which the app deliberately ignores, so a shade report can't be told apart from a cloud.
- **Requiring the visitor's location:** rejected for now. It would need a permission prompt, would still be spoofable, and would turn away visitors who decline. The venue's published position, the caps and the consensus carry the load instead.
- **Applying corrections to the dataset automatically:** rejected. `terraces.json` is built offline and changes only through the owner's Publish (CLAUDE.md invariants); corrections are served by the API, beside the data.
- **Threshold 5, as prices:** rejected for the reason in decision 5: reports per slice and season are too thin to reach it.

## Follow-ups (not built)

- **A location check.** Refusing a report from a visitor who is not near the venue. Not built, for the reasons above; reconsider if the queue shows abuse.

## Consequences

- One migration, `api/migrations/0009_sun_reports.sql` (tables `sun_reports` and `sun_rejections`), additive.
- The Worker must be deployed before the web change is useful: until then the live API ignores `sun` (and answers `400 invalid empty` when it is the only part) and has no `/v1/sun`. Unless `DEPLOY_API` is set, the owner runs `npm run migrate:remote` then `npm run deploy` in `api/`.
- The API now depends on suncalc, at the app's version. The app's `sunPosition` and `isLeafOff` can't be imported into the Worker as they are (their files pull in the app's zod schemas, and `suncalc` would resolve from `web/node_modules`, which the API's CI job doesn't install), so `api/src/sun.ts` mirrors them in a few lines and a test checks the leaf-off dates still match the app's.
- Sun reports share the caps with prices and the other reports.

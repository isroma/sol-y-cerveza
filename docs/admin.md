# The admin

A dev-only page for the owner to curate the data: mark each venue as terrace / no terrace / not a venue, drag venues to their real position, pin terraces, add venues no source lists, enter beer prices, and work through the visitor and machine queues. It is a flat map served by the Vite dev server. It is never part of the built site: its server code (`web/plugins/admin/reviewServer.ts`, `web/plugins/admin/publish.ts`) is a dev-server plugin only (`apply: 'serve'`).

What it writes lands in `pipeline/data/` ([pipeline guide](pipeline.md#files-in-pipelinedata)); the next build applies it on top of everything else, and **Publish** ships it. Sun reports ([below](#sun-reports)) are answered in the API at once; the accepted ones are then also recorded in `pipeline/data/sun_corrections.csv`, which Publish ships.

## Starting it

```bash
cp web/.env.example web/.env.local   # once; every key is optional
cd web && npm ci && npm run admin    # opens admin.html
```

Keys in `web/.env.local` the admin uses (none is `VITE_`-prefixed except the API URL, so the secrets never reach the browser):

| Key                      | For                                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------------------- |
| `VITE_PRICES_API`        | the API (`api/`); with `PRICES_ADMIN_TOKEN`, the Suggestions, Reports and Sun queues              |
| `PRICES_ADMIN_TOKEN`     | the API's `ADMIN_TOKEN`; the dev server sends it, the browser never sees it                       |
| `PROBE_DSM`, `PROBE_DTM` | LiDAR rasters for the sun preview, if not `pipeline/.cache/badajoz_dsm.tif` and `badajoz_dtm.tif` |

Under 900 px wide (a phone) the list sits above the map and scrolls, and the venue panel covers the top of the map.

The sun preview needs the LiDAR rasters in `pipeline/.cache/` (from `solycerveza.obstacles`, see the [pipeline guide](pipeline.md#rebuilding-the-data)); everything else works without them, and without them the panel says how to get them.

## Orthophoto

**Orthophoto**, at the top right of the map (bottom left on a phone), swaps the flat map for the PNOA máxima actualidad orthophoto of the IGN, so tables and parasols show from the desk and a terrace can be pinned without walking there. It is the imagery the pipeline reads (`pipeline/src/solycerveza/ortho.py`), served here by IGN's WMTS (`https://www.ign.es/wmts/pnoa-ma`, layer `OI.OrthoimageCoverage`, tile matrix set `GoogleMapsCompatible`) rather than the WMS: that set is the Web Mercator tile grid MapLibre asks for, so tiles come pre-cut and cached instead of rendered per request (`web/src/admin/ortho.ts`).

- Tiles are fetched up to zoom 19, about 0.23 m a pixel in Badajoz, the PNOA's own resolution; from 19 to the map's maximum, 21, they are enlarged.
- The photo sits under the basemap's labels, so street names stay on top. Venue dots get a white ring while it is on; the pins already have one.
- The credit "PNOA cedido por © Instituto Geográfico Nacional de España" (CC BY 4.0) shows next to the button for as long as the photo does.
- The choice is remembered in this browser (`localStorage`, key `admin-ortho`).
- The photo can be a few years old and is taken from above: a terrace that may have moved, or sits under trees or awnings, still wants a look on the ground.

Pins placed on it are ordinary review rows (`review` in the record's `sources`). The build adds the PNOA credit to `terraces.json` only when a terrace is `curated` today; crediting review pins as well is #264, a pipeline change of its own.

## Deciding venues

The sidebar has the title with **Publish**, the count, and two tabs: **To review** (the venues) and **Inbox** (what came from outside), each with its count. To review has a search box with **+** (add a venue) and the filters **To review**, **Needs a look**, **Not a venue** and **All**. Click a venue to open its panel, then decide with a key:

| Key       | Does                                                                                                           |
| --------- | -------------------------------------------------------------------------------------------------------------- |
| **T**     | terrace: click on the map (or drag the pin) where the tables stand                                             |
| **Enter** | in To review, while placing a terrace: keep the venue position as the terrace                                  |
| **N**     | no terrace                                                                                                     |
| **X**     | not a venue (closed, or not a bar or restaurant: the build drops it)                                           |
| **Y**     | _Looks right_: the terrace and its sun are checked and right as they are (`looks_right` in `venue_review.csv`) |
| **S**     | in To review, skip to the end (**J** skips too, and in the other lists goes to the next venue to review)       |
| **A**     | accept the venue's machine proposal                                                                            |
| **I**     | ignore the venue's machine proposal                                                                            |
| **Esc**   | stop placing a pin, or close the panel                                                                         |

Venues can also be dragged to their real position. Every decision is a row in `pipeline/data/venue_review.csv`.

- **To review** (with an empty search) is the review queue: the venues without a decision. Overture venues from a weak source come first ([Trust tiers](#trust-tiers)); within that group and after it, those visitors are most likely to look at first: near the centre, next to confirmed terraces, from OSM before the Junta before Overture, bars, cafés and restaurants before pubs, and those with a machine proposal (`web/src/admin/queueScore.ts` has the score and the order). Each decision (or skip) moves on to the nearest venue left in the queue, so the map stays where you are; skipped venues come back only when nothing else is left (`nextInQueue`). The list says why each one is where it is. Typing in the search shows plain matches instead.
- **Inbox** is one list of everything from outside that waits for a yes or no (`web/src/admin/inbox.ts`, `useInbox.ts`), filtered by **All**, **Reports**, **Sun**, **Suggestions**, **Website prices** or **Not venues**. Each row is the venue and one line on what it is; click a row (or answer one) and its panel opens on the map with **Accept** (**Y**), **Reject** (**N**) and **Skip** (**S**, or **J**), the same letters as To review. Each answer moves on to the next Inbox item, not to To review.
- **Not venues** (an Inbox filter) lists Overture-only venues that are probably not a bar or restaurant (name, takeaway or delivery only, a duplicate of a venue from another source, far out or alone; `web/src/admin/junk.ts`), one at a time: **Not a venue** (**X**) marks it; **Keep it** (**Y**) takes it off the Inbox until the admin reloads, and it stays in To review.
- **+** (next to the search) adds a venue no source lists: a name, a kind and a point. It gets a `review:<slug>` id.

## Trust tiers

Overture venues are the least reliable (issue #493), so the queue puts the doubtful ones first. Write the tiers once, and again after refreshing Overture, OSM or the Junta register:

```bash
cd pipeline && uv run python -m solycerveza.trust --evaluate   # writes pipeline/.cache/venue_trust.json
```

It writes one row per Overture-only venue (`pipeline/src/solycerveza/trust.py`), on the venue list the build sees before `venue_review.csv` is applied; the admin reads it through `GET /__admin/trust` (`web/src/admin/trust.ts`). Without the file the queue keeps its plain order and says how to write it. The build never reads the file, and nothing of it reaches `terraces.json` or visitors.

- **Strong source**: Overture confidence 0.9 or more, and either both Meta and BrightQuery list the place or a Junta register row confirms it (the build's own matcher, `junta.add_register_venues`).
- **Weak source**: every other Overture-only venue. The queue shows these first, with "Weak source" before the reason.
- **Position doubtful**: BrightQuery is the only position source. On release 2026-11-18.0 such points sat a median 296 m from the OSM position of the same venue, against 14 m for Meta, so check the position before deciding.
- OSM, curated, `review:` and Junta-only venues have no tier.

The venue panel shows the tier and what it rests on (confidence, datasets, Junta match). `--evaluate` prints how often you marked each tier `not_venue`. Measured on 2026-11-26 (Overture 2026-11-18.0, your 128 decisions on Overture venues still in the venue list):

| Group                        | Reviewed | `not_venue` | Unreviewed |
| ---------------------------- | -------- | ----------- | ---------- |
| strong                       | 20       | 4 (20 %)    | 95         |
| weak                         | 108      | 41 (38 %)   | 252        |
| position doubtful (any tier) | 26       | 12 (46 %)   | 49         |
| Junta only (no tier)         | 10       | 4 (40 %)    | 83         |

Weak venues were `not_venue` 1.9 times as often as strong ones. The strong sample is small (20), so re-run `--evaluate` after each batch of reviews; Junta-only venues have too few decisions to tier yet.

## Fixing a terrace

**Needs a look** lists terraces whose horizon in the published `terraces.json` gets no sun today, on 21 Jun or on 21 Dec, or is above 60° over most of the southern half (`web/src/admin/needsLook.ts`). Usually the pin is against a wall, under a tree crown or on a roof.

1. Pick **Needs a look**.
2. Click one, press **T** and click (or drag the pin to) where the tables stand. The panel's **Sun at the terrace pin** updates as you go: today's hours of sun, a 24 h strip (amber sun, grey shade, light night) and the **height above ground** at the pin. It runs `python -m solycerveza.probe` through `GET /__admin/probe`, and warns on 0 min of sun or a pin above `MAX_HEIGHT_ABOVE_GROUND_M`.
3. Read it:
   - **No sun** while the tables do get sun: the pin is in the shade of something the tables are not, typically tight against a façade or under a crown. Move it a few metres onto open ground, towards the middle of the tables.
   - **Height above ground** is the surface model minus the terrain under the pin. On the street it reads about 0 m. Above 2 m (the build's warning threshold, `MAX_HEIGHT_ABOVE_GROUND_M`) the pin sits on a roof, an awning or a tree crown, and its horizon is meaningless: move it to the pavement or square below.
   - **The pin is right and so is the result**, e.g. a narrow street between tall buildings that really gets little or no sun: press **Y** (_Looks right_). It keeps the terrace where it is and takes it off the list for good; moving its pin later puts it back. Note the 2 m LiDAR can't see the floor of very narrow streets, so their sun may read lower than it is.
4. **Publish** when done. The list is computed from the published `terraces.json`, so a fixed terrace leaves it after the next build ("pin moved since the build" until then).

## Prices

The venue panel takes beer prices, a caña and tercios by brand, into `pipeline/data/venue_prices.csv`; the build attaches them to each record as `prices` (integer cents).

- **By hand**: type them in the panel's price fields.
- **From the phone**: logged in at `/admin` on the site, prices you save show at once from the API (owner prices), without the admin. Reading prices from a photo was removed (2026-11-25).
- **Website prices** (an Inbox filter) lists the candidates `python -m solycerveza.price_candidates` found on venues' own websites (`pipeline/data/price_candidates.csv`, [ADR-0006](adr/0006-price-candidates-from-venue-websites.md)), each with the text it was read from and a link to the page (`web/src/admin/PriceCandidates.tsx`). Check it, then **Accept** (it is saved to `venue_prices.csv` with `seen` = the fetch date, and ships with the next Publish) or **Dismiss** (hidden). Both are recorded in the candidate's `status`.
- **Suggestions** (an Inbox filter) is the queue of visitor price suggestions the API has not served (fewer than 5 networks agree; [api/README.md](../api/README.md)). **Accept** saves the price to `venue_prices.csv` and resolves it in the API; **Reject** resolves it as rejected, so no vote for that price counts again.

## Reports

**Reports** (an Inbox filter) lists the visitors' venue reports from the API ([ADR-0009](adr/0009-terrace-reports.md), `web/src/admin/InboxPanel.tsx`). Reports are never applied automatically. Selecting one shows the venue and, for a move, a terrace pin or a new venue, a dashed pin at the proposed point. **Accept** applies it as a review row (`reportChange` in `web/src/admin/reports.ts`) and only then resolves it in the API; **Reject** only resolves it.

| Report kind        | Accepting writes                                                                                      |
| ------------------ | ----------------------------------------------------------------------------------------------------- |
| `closed`           | `not_venue`, or deletes an added `review:` venue                                                      |
| `move`             | the venue position, or the terrace position when the venue has a terrace (the app's badge sits there) |
| `terrace` yes / no | `terrace` / `no_terrace`; the queue groups them per venue and answer, with the count                  |
| `pin`              | the terrace position                                                                                  |
| `add`              | a new `review:` venue                                                                                 |

The app sends all five: `add` from the picker, the rest from the card's back in one `POST /v1/changes` ("¿Tiene terraza?" and "Mesas", #210).

## Sun reports

**Sun** (an Inbox filter) lists the visitors' reports that the sun is on a terrace where the model says shade (issue #364, [ADR-0012](adr/0012-sun-reports.md)), from the API's `GET /v1/admin/sun`: every pending report, one row per venue and season (leaf-on, or leaf-off from 1 Dec to 15 Mar), whether or not enough people agree yet (`web/src/admin/sunReports.ts`, `SunReportDetails.tsx`). Once 3 networks agree, visitors already see that sun as approximate ("~"); the row says "shown as ~".

Selecting one shows the venue on the map and each sighting: its Madrid date and time, the sun's azimuth and altitude then (computed by the API), and the published model in that direction from `terraces.json`, in the report's season: the obstacle the app compares the sun with (the envelope's low half, or the horizon at the pin, with the pin's value next to it when they differ), and how far below it the sun was. "Model 34.0°, sun 5.4° below it" means the model puts an obstacle where a visitor saw sun.

Both answers go straight to the API (`POST /v1/admin/sun/resolve`) and count at once. Accepted reports are also recorded in `pipeline/data/sun_corrections.csv` (issue #463; `web/src/admin/useSunCorrections.ts`, `sunCorrectionsCsv.ts`): as the admin opens (once the Inbox has loaded), and again after each **Accept**, it reads the API's `GET /v1/admin/sun/accepted` and adds a row for every accepted report the file lacks, by id. That includes the owner's own reports from the phone, which the API stores accepted. The file ships with the next **Publish**, and the build turns it into the terraces' `sun_corrections`. A failed copy shows as a "Sun corrections" line at the top of the Inbox and blocks nothing else; it is retried on the next open or accept.

The copy only adds rows: a row already in the file is never rewritten or removed. Undoing an accept means deleting its row from the CSV by hand, but the next copy puts it back while the report is still accepted in the API (for a year), so undoing one is not supported from the admin yet.

- **Accept** (**Y**): the report is confirmed. The app shows sun in that slice of sky (5° either side of each sighting, down to the altitude seen less a 2° margin, that season) without "~", and the report is recorded in `sun_corrections.csv` for Publish.
- **Reject** (**N**): the reports stop counting, and that slice of sky is blocked for the venue in that season for a year, so new reports there don't count either.
- **Skip** (**S**): leave it for later.

The routine:

1. Read the sightings against the model. A tree crown or awning the LiDAR saw that is gone, or a thin obstacle the surface model makes too wide: **Accept**.
2. The model is far above the sun in that direction and the terrace gets little sun all day (it may also be in **Needs a look**): the terrace pin is probably wrong (against a wall, under a crown) rather than one obstacle. **Move the pin** in the panel opens the venue in To review; fix the pin as in [Fixing a terrace](#fixing-a-terrace) and Publish. The new horizon comes with the build; then reject the report, or leave it pending if it still holds.
3. A report that makes no sense (a narrow street at an altitude its walls can't let through): **Reject**.

## Machine proposals

Proposals from the optional `pipeline/data/venue_proposals.csv` (written by `python -m solycerveza.proposals`, see the [pipeline guide](pipeline.md#machine-proposals-for-unreviewed-venues) and [ADR-0008](adr/0008-machine-venue-proposals.md); `web/src/admin/proposals.ts`) show in the venue panel with their evidence and confidence, and a dashed pin on the map for a proposed position. **Accept** (**A**) writes the usual review row; **Ignore** (**I**) hides it for good, recording its key in `pipeline/.cache/venue_proposals_ignored.csv`. Trust a kind only above the threshold its trial found.

## Publish

**Publish** ships the reviews, prices and accepted sun reports (`web/plugins/admin/publish.ts`):

1. It waits for pending saves, then rebuilds the data in a temporary git worktree of `origin/main` (`python -m solycerveza.build`, reusing this checkout's `pipeline/.cache/`). When `venue_review.csv`, `venue_prices.csv` and `sun_corrections.csv` already match `origin/main` (or the open publish branch), it skips the build and says there is nothing new to publish.
2. It commits `pipeline/data/venue_review.csv`, `pipeline/data/venue_prices.csv`, `pipeline/data/sun_corrections.csv` and `web/public/data/terraces.json` (`PUBLISHED` in `publish.ts`), nothing else, and pushes a `data/venue-review-*` branch, or adds to the one whose PR is still open.
3. It uses git only, because the owner's network can't reach api.github.com. Two workflows take over. **Publish review** (`.github/workflows/publish-review.yml`, on the push, no secrets) checks that the branch changes only those four files (`publish.test.ts` checks both workflows list exactly `PUBLISHED`). When it succeeds, **Publish review PR** (`.github/workflows/publish-review-pr.yml`, `workflow_run`, so always `main`'s copy) checks the branch again itself, never running its code, and opens the PR and enables auto-merge.
4. **Publish review PR** uses the `PUBLISH_TOKEN` secret, a fine-grained token of the owner (this repository only; Contents and Pull requests read and write), kept as a repository secret by the owner's choice (2026-11-26; the `publish` environment, which only `main` may use, would be the stricter place for it). The token is needed because PRs opened with `GITHUB_TOKEN` trigger no CI or deploy. Never use `PUBLISH_TOKEN` in a workflow a branch push can run.
5. The admin follows the branch with git (every 10 s, for up to 30 min) and shows when it merged. CI then deploys the site.

Only one Publish builds at a time.

## Owner mode on the phone

The owner can also record prices at the bar from the public site on a phone ([ADR-0005](adr/0005-price-suggestions.md), "Owner mode"): a private link `#owner=<OWNER_TOKEN>` turns it on and keeps the token in the phone's local storage. The venue card then shows price fields that save straight to the API (`PUT`/`DELETE /v1/owner/prices`), and "Foto de la carta" reads a price-board photo with the Claude API (`POST /v1/owner/photo`, at most 50 a day). The token can only add or remove prices and read photos (`web/src/prices/owner.ts`). Owner prices live in the API's database; every **Publish** first copies them into `venue_prices.csv` (`GET /v1/admin/owner-prices`, through the same `PRICES_ADMIN_TOKEN` as the queues), keeping the newer `seen` for each venue, item and brand, so they ship with the rest (#263). The Publish line counts them; without the API, Publish ships the CSV as it is and the next one copies them.

## Dev-server endpoints

All under `/__admin/`, served by `web/plugins/admin/reviewServer.ts` in the dev server only. A guard in front of them (`web/plugins/admin/adminGuard.ts`) refuses state-changing requests that aren't same-origin JSON. The paths are named once, in `web/src/admin/endpoints.ts`, which the admin page and the dev server both import; `web/plugins/admin/reviewServer.test.ts` checks that the server mounts exactly those.

| Endpoint                    | Methods          | What                                                                                             |
| --------------------------- | ---------------- | ------------------------------------------------------------------------------------------------ |
| `/__admin/review`           | GET, PUT, DELETE | `venue_review.csv`: read, upsert a row, remove one (`?venue_id=`)                                |
| `/__admin/prices`           | GET, PUT, DELETE | `venue_prices.csv`: read, upsert a price, remove one (`?key=`)                                   |
| `/__admin/price-candidates` | GET, POST        | `price_candidates.csv` and the menu leads; record an accept or a dismiss                         |
| `/__admin/proposals`        | GET, POST        | `venue_proposals.csv`; ignore one (accepting goes through `/__admin/review`)                     |
| `/__admin/trust`            | GET              | `pipeline/.cache/venue_trust.json` ([trust tiers](#trust-tiers)), or `missing` when absent       |
| `/__admin/probe`            | GET              | the sun preview at a point (`python -m solycerveza.probe`); a newer probe cancels the one before |
| `/__admin/suggestions`      | GET, POST        | proxy to the API's `GET /v1/admin/suggestions` and `POST /v1/admin/resolve`                      |
| `/__admin/reports`          | GET, POST        | proxy to the API's `GET /v1/admin/reports` and `POST /v1/admin/reports/resolve`                  |
| `/__admin/sun`              | GET, POST        | proxy to the API's `GET /v1/admin/sun` and `POST /v1/admin/sun/resolve`                          |
| `/__admin/sun-accepted`     | GET              | proxy to the API's `GET /v1/admin/sun/accepted`                                                  |
| `/__admin/sun-corrections`  | GET, POST        | `sun_corrections.csv`: read, add the posted rows whose id it lacks (created with its header)     |
| `/__admin/publish`          | GET, POST        | Publish status; start a Publish (`409` while one is building)                                    |

The four proxies need `VITE_PRICES_API` and `PRICES_ADMIN_TOKEN` in `web/.env.local` (`503` otherwise).

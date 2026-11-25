# The admin

A dev-only page for the owner to curate the data: mark each venue as terrace / no terrace / not a venue, drag venues to their real position, pin terraces, add venues no source lists, enter beer prices, and work through the visitor and machine queues. It is a flat map served by the Vite dev server. It is never part of the built site: its server code (`web/plugins/admin/reviewServer.ts`, `web/plugins/admin/publish.ts`, `web/plugins/admin/pricePhotoServer.ts`) is a dev-server plugin only (`apply: 'serve'`).

What it writes lands in `pipeline/data/` ([pipeline guide](pipeline.md#files-in-pipelinedata)); the next build applies it on top of everything else, and **Publish** ships it.

## Starting it

```bash
cp web/.env.example web/.env.local   # once; every key is optional
cd web && npm ci && npm run admin    # opens admin.html
```

Keys in `web/.env.local` the admin uses (none is `VITE_`-prefixed except the API URL, so the secrets never reach the browser):

| Key                      | For                                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------------------- |
| `VITE_PRICES_API`        | the API (`api/`); with `PRICES_ADMIN_TOKEN`, the Suggestions and Reports queues                   |
| `PRICES_ADMIN_TOKEN`     | the API's `ADMIN_TOKEN`; the dev server sends it, the browser never sees it                       |
| `ANTHROPIC_API_KEY`      | "Read prices from a photo" (a Claude API key); unset, you type prices by hand                     |
| `PROBE_DSM`, `PROBE_DTM` | LiDAR rasters for the sun preview, if not `pipeline/.cache/badajoz_dsm.tif` and `badajoz_dtm.tif` |

The sun preview needs the LiDAR rasters in `pipeline/.cache/` (from `solycerveza.obstacles`, see the [pipeline guide](pipeline.md#rebuilding-the-data)); everything else works without them, and without them the panel says how to get them.

## Deciding venues

The filters are **To review**, **Not a venue**, **All** and **Needs a look**. Click a venue to open its panel, then decide with a key:

| Key       | Does                                                                                                           |
| --------- | -------------------------------------------------------------------------------------------------------------- |
| **T**     | terrace: click on the map (or drag the pin) where the tables stand                                             |
| **Enter** | in the Review queue, while placing a terrace: keep the venue position as the terrace                           |
| **N**     | no terrace                                                                                                     |
| **X**     | not a venue (closed, or not a bar or restaurant: the build drops it)                                           |
| **Y**     | _Looks right_: the terrace and its sun are checked and right as they are (`looks_right` in `venue_review.csv`) |
| **S**     | in the Review queue, skip to the end (**J** skips too, and outside the queue goes to the next venue to review) |
| **A**     | accept the venue's machine proposal                                                                            |
| **I**     | ignore the venue's machine proposal                                                                            |
| **Esc**   | stop placing a pin, or close the panel                                                                         |

Venues can also be dragged to their real position. Every decision is a row in `pipeline/data/venue_review.csv`.

- **Review queue** shows the venues without a decision one at a time, those visitors are most likely to look at first: near the centre, next to confirmed terraces, from OSM before the Junta before Overture, bars, cafés and restaurants before pubs, and those with a machine proposal (`web/src/admin/queueScore.ts` has the score). It moves on after each decision. The list says why each one is where it is. The header shows how far you are, by count and by share of the total value.
- **Not venues** lists Overture-only venues that are probably not a bar or restaurant (name, fast food, a duplicate of a venue from another source, far out or alone; `web/src/admin/junk.ts`), to mark in one go. Strong signals start ticked; **Mark N as not a venue** waits 10 s for **Undo** before it saves.
- **+ Add venue** adds a venue no source lists: a name, a kind and a point. It gets a `review:<slug>` id.

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
- **Read prices from a photo**: pre-fills the fields as proposals from a photo of the price board, read by the Claude API from the dev server (`web/plugins/admin/pricePhotoServer.ts`, `ANTHROPIC_API_KEY`). Check each one before saving it.
- **Website prices** lists the candidates `python -m solycerveza.price_candidates` found on venues' own websites (`pipeline/data/price_candidates.csv`, [ADR-0006](adr/0006-price-candidates-from-venue-websites.md)), each with the text it was read from and a link to the page (`web/src/admin/PriceCandidates.tsx`). Check it, then **Accept** (it is saved to `venue_prices.csv` with `seen` = the fetch date, and ships with the next Publish) or **Dismiss** (hidden). Both are recorded in the candidate's `status`.
- **Suggestions** is the queue of visitor price suggestions the API has not served (fewer than 5 networks agree; [api/README.md](../api/README.md)). **Accept** saves the price to `venue_prices.csv` and resolves it in the API; **Reject** resolves it as rejected, so no vote for that price counts again.

## Reports

**Reports** lists the visitors' venue reports from the API ([ADR-0009](adr/0009-terrace-reports.md), `web/src/admin/ReportsQueue.tsx`). Reports are never applied automatically. Selecting one shows the venue and, for a move, a terrace pin or a new venue, a dashed pin at the proposed point. **Accept** applies it as a review row (`reportChange` in `web/src/admin/reports.ts`) and only then resolves it in the API; **Reject** only resolves it.

| Report kind        | Accepting writes                                                                                      |
| ------------------ | ----------------------------------------------------------------------------------------------------- |
| `closed`           | `not_venue`, or deletes an added `review:` venue                                                      |
| `move`             | the venue position, or the terrace position when the venue has a terrace (the app's badge sits there) |
| `terrace` yes / no | `terrace` / `no_terrace`; the queue groups them per venue and answer, with the count                  |
| `pin`              | the terrace position                                                                                  |
| `add`              | a new `review:` venue                                                                                 |

The app sends `move`, `closed` and `add` today; `terrace` and `pin` exist in the API and this queue, but no app UI sends them yet (#210).

## Machine proposals

Proposals from the optional `pipeline/data/venue_proposals.csv` (written by `python -m solycerveza.proposals`, see the [pipeline guide](pipeline.md#machine-proposals-for-unreviewed-venues) and [ADR-0008](adr/0008-machine-venue-proposals.md); `web/src/admin/proposals.ts`) show in the venue panel with their evidence and confidence, and a dashed pin on the map for a proposed position. **Accept** (**A**) writes the usual review row; **Ignore** (**I**) hides it for good, recording its key in `pipeline/.cache/venue_proposals_ignored.csv`. Trust a kind only above the threshold its trial found.

## Publish

**Publish** ships the reviews and prices (`web/plugins/admin/publish.ts`):

1. It waits for pending saves, then rebuilds the data in a temporary git worktree of `origin/main` (`python -m solycerveza.build`, reusing this checkout's `pipeline/.cache/`).
2. It commits `pipeline/data/venue_review.csv`, `pipeline/data/venue_prices.csv` and `web/public/data/terraces.json`, nothing else, and pushes a `data/venue-review-*` branch, or adds to the one whose PR is still open.
3. It uses git only, because the owner's network can't reach api.github.com. Two workflows take over. **Publish review** (`.github/workflows/publish-review.yml`, on the push, no secrets) checks that the branch changes only those three files. When it succeeds, **Publish review PR** (`.github/workflows/publish-review-pr.yml`, `workflow_run`, so always `main`'s copy) checks the branch again itself, never running its code, and opens the PR and enables auto-merge.
4. **Publish review PR** uses the `PUBLISH_TOKEN` secret, a fine-grained token of the owner (this repository only; Contents and Pull requests read and write), kept in the `publish` environment, which only `main` may use (until the owner moves it there, the repository secret of the same name is used). The token is needed because PRs opened with `GITHUB_TOKEN` trigger no CI or deploy. Never use `PUBLISH_TOKEN` in a workflow a branch push can run.
5. The admin follows the branch with git (every 10 s, for up to 30 min) and shows when it merged. CI then deploys the site.

Only one Publish builds at a time.

## Owner mode on the phone

The owner can also record prices at the bar from the public site on a phone ([ADR-0005](adr/0005-price-suggestions.md), "Owner mode"): a private link `#owner=<OWNER_TOKEN>` turns it on and keeps the token in the phone's local storage. The venue card then shows price fields that save straight to the API (`PUT`/`DELETE /v1/owner/prices`), and "Foto de la carta" reads a price-board photo with the Claude API (`POST /v1/owner/photo`, at most 50 a day). The token can only add or remove prices and read photos (`web/src/prices/owner.ts`). Owner prices live in the API's database; copying them into `venue_prices.csv` (`GET /v1/admin/owner-prices` exists for it) is not built yet.

## Dev-server endpoints

All under `/__admin/`, served by `web/plugins/admin/reviewServer.ts` in the dev server only. A guard in front of them (`web/plugins/admin/adminGuard.ts`) refuses state-changing requests that aren't same-origin JSON. The paths are named once, in `web/src/admin/endpoints.ts`, which the admin page and the dev server both import; `web/plugins/admin/reviewServer.test.ts` checks that the server mounts exactly those.

| Endpoint                    | Methods          | What                                                                                                      |
| --------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------- |
| `/__admin/review`           | GET, PUT, DELETE | `venue_review.csv`: read, upsert a row, remove one (`?venue_id=`)                                         |
| `/__admin/prices`           | GET, PUT, DELETE | `venue_prices.csv`: read, upsert a price, remove one (`?key=`)                                            |
| `/__admin/prices/photo`     | GET, POST        | whether `ANTHROPIC_API_KEY` is set; read a photo of the price board (`web/plugins/admin/pricePhotoServer.ts`, max 5 MB) |
| `/__admin/price-candidates` | GET, POST        | `price_candidates.csv` and the menu leads; record an accept or a dismiss                                  |
| `/__admin/proposals`        | GET, POST        | `venue_proposals.csv`; ignore one (accepting goes through `/__admin/review`)                              |
| `/__admin/probe`            | GET              | the sun preview at a point (`python -m solycerveza.probe`); a newer probe cancels the one before          |
| `/__admin/suggestions`      | GET, POST        | proxy to the API's `GET /v1/admin/suggestions` and `POST /v1/admin/resolve`                               |
| `/__admin/reports`          | GET, POST        | proxy to the API's `GET /v1/admin/reports` and `POST /v1/admin/reports/resolve`                           |
| `/__admin/publish`          | GET, POST        | Publish status; start a Publish (`409` while one is building)                                             |

The two proxies need `VITE_PRICES_API` and `PRICES_ADMIN_TOKEN` in `web/.env.local` (`503` otherwise).

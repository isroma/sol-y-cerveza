# ADR-0008: Machine proposals for unreviewed venues, measured before use

- Status: accepted (2026-11-24)
- Date: 2026-11-24
- Amended (2026-11-25): the proposers and the trial shipped in #214, and the admin shows proposals with Accept and Ignore in #216. The trial has not been run yet: its numbers must come from the owner's machine (Consequences), so no kind has a measured threshold. The admin shows every row the CSV holds, highest confidence first; until the trial runs, the only filter is `--min-confidence` when the file is written.
- Amended (2026-11-25, #350): the position proposer also geocodes each venue's own OSM `addr:*` or Overture `addresses` line, as two more sources (`osm-addr+cartociudad`, `overture-addr+cartociudad`) that the trial scores apart from the register (Decision 3 and 5). The position trial was run (Consequences): **no position source reaches 90 % precision, so all three stay off**; none of their 20 proposals on reviewed venues was right. CartoCiudad matches must now be in the city's postcodes (the municipality's villages share street names).
- Issue: #211

## Context

`terraces.json` lists 695 venues. The owner has reviewed 106 of them in the admin (52 terrace, 35 no terrace, 19 not a venue; 14 venues moved, 50 terrace pins). The other 607 are unreviewed (414 Overture-only, 107 OSM, 86 Junta register), and none of them has a terrace.

Reviewing them one by one is slow. Some sources are noisy:

- 10 of the 79 Overture-only venues reviewed were not venues.
- Junta positions are geocoded addresses.

The owner would like the machine to propose answers they confirm with one tap. They want this only if its accuracy is measured and good, because a wrong proposal accepted by habit becomes wrong data.

Earlier research on the PNOA orthophoto found automatic table detection unusable (OWLv2 reached 15 % precision on 2019 and 0 % on 2025; [data-sources.md](../research/data-sources.md), Imagery). So nothing here is trusted before a trial.

## Decision

`python -m solycerveza.proposals` writes **proposals** to `pipeline/data/venue_proposals.csv`, on the model of the price candidates ([ADR-0006](0006-price-candidates-from-venue-websites.md)).

1. **A fixed contract.** The columns are `venue_id,kind,lat,lon,confidence,evidence,source,generated`, one row per venue and kind, sorted by `venue_id` then `kind`.
   - `kind` is `terrace` (lat/lon: the tables), `no_terrace`, `position` (lat/lon: the corrected venue position) or `not_venue`.
   - `confidence` has two decimals; `evidence` is one English sentence.
   - The admin reads the file. The build never does.
2. **The owner decides.** Accepting a proposal in the admin writes an ordinary row to `venue_review.csv`. Reviewed venues get no new proposals. Rows below `--min-confidence` (default 0.5) are left out.
3. **Three separate proposers.** Each one is optional (`--only`) and cached in `pipeline/.cache/`, and each makes network calls only in its fetch stage ([sources](../research/orthophoto-proposals.md)):
   - **Terrace from the orthophoto** (`pnoa-ortho+claude`):
     - A 120 m crop of PNOA máxima actualidad (IGN WMS, CC BY 4.0) around the venue goes to `claude-opus-5-5`.
     - The model answers yes, no or unsure, with a confidence, the pixel of the tables and one sentence of evidence, as JSON validated with pydantic.
     - The prompt spells out the photo's limits: unknown flight date, stacked furniture, awnings, arcades, trees, shadows, and cars that look like tables. It asks for "unsure" over a guess. "Unsure" makes no proposal.
   - **Position from the register address** (`junta+cartociudad`):
     - Every venue a geocoded Junta register row matches (its own row, or `same_venue`) gets a `position` proposal when the CartoCiudad portal is more than 25 m from the venue's current position.
     - Junta venues already sit at their own portal, so this mostly helps OSM and Overture venues the register confirms.
   - **Position from the venue's own address** (`osm-addr+cartociudad`, `overture-addr+cartociudad`; #350):
     - The OSM `addr:street` + `addr:housenumber`, or the first Overture `addresses` line with a street and a number, is cut with the register's parser and geocoded by the same CartoCiudad `Geocoder` and cache, exact street number only. The same 25 m rule applies.
     - The address is the venue's own, so there is no name matching. The hand-set confidence is 0.80 (OSM) or 0.70 (Overture), less 0.15 for a move over 150 m and less 0.15 when three or more venues share the portal.
     - 338 of the 452 Overture venues have such an address (298 of them unreviewed; counted on release `2026-11-18.0`). The register helps only venues a register row matches, so this is where most new proposals would come from, if the trial trusts them.
     - When sources disagree, the CSV keeps the most confident proposal per venue; the trial reports each source and that combination.
   - **Not a venue** (`overture-attributes`):
     - A transparent additive score from what Overture gives: confidence, the number of source datasets, no website, a generic name, and a category outside the bar and restaurant ones.
     - The weights are set by hand and are only tested by the trial.
4. **Cost is explicit.** The vision proposer prints the number of uncached Claude API calls and an estimate in dollars. It asks nothing new unless given `--yes` (all) or `--limit N`.
5. **The trial comes first.** `--evaluate` runs the proposers on the reviewed venues as they were **before** the review and scores them against the owner's decisions.
   - The pre-review venues come from the build without `venue_review.csv` applied, or from a `--baseline` `terraces.json` taken from git history before the first review.
   - The report gives:
     - precision and recall for terrace yes/no and for not a venue;
     - the median and 90th-percentile distance of proposed terrace pins and positions from the owner's, next to the "do nothing" distance;
     - the lowest confidence threshold at which precision reaches 90 %, if any;
     - for positions, all of these per address source (register, OSM, Overture), over the venues that source has an address for, and for the most confident proposal per venue.
   - It is deterministic and goes to stdout and `pipeline/.cache/proposals_eval.md`.
   - The vision trial covers only the 87 venues with a terrace decision.
6. **A proposer reaches the admin only after its trial.** A kind is shown as a one-tap proposal only above the threshold its trial found, and only if one exists. A proposer whose trial finds no such threshold stays off.

## Consequences

- The vision and not-a-venue trial numbers must come from the owner's machine: it has the caches, the network and the API key. The session that built this could reach none of IGN, CartoCiudad, the Junta site or the DuckDB extension host, and had no API key, so no real numbers exist yet.
- **Position trial (2026-11-25, #350).** Run with `--evaluate --only position` on the pre-review baseline (`164f946^`), Overture release `2026-11-18.0`, and the Overpass, Junta and CartoCiudad answers of that day. A proposal is right within 15 m of the owner's position.

  | Source                      | Venues with an address (moved by the owner) | Proposals | Right | Recall of moved | 90 % threshold | Distance from the owner's position (median, p90) |
  | --------------------------- | ------------------------------------------- | --------- | ----- | --------------- | -------------- | ------------------------------------------------ |
  | `junta+cartociudad`         | 106 looked at (14)                          | 7         | 0     | 0/14            | none           | 46 m, 190 m                                      |
  | `osm-addr+cartociudad`      | 6 (1)                                       | 2         | 0     | 0/1             | none           | 26 m, 115 m                                      |
  | `overture-addr+cartociudad` | 48 (6)                                      | 11        | 0     | 0/6             | none           | 382 m, 821 m                                     |
  | most confident per venue    | 106 looked at (14)                          | 20        | 0     | 0/14            | none           | 137 m, 821 m                                     |
  - The pre-review position was 0 m from the owner's for every venue proposed for except one (the only moved venue with a proposal: the owner moved it 14 m, and the register portal was 26 m from their position, farther than doing nothing). Doing nothing was within 15 m every time.
  - Why: the owner's 14 moves are small, 3 to 33 m (median 12 m), and 13 of them are under the 25 m rule, so no address proposer could catch them. The portals, in turn, land 25 to 821 m from venues the owner left in place. Overture's addresses are the worst: five venues listed on "Avenida de Elvas" got portals 311 to 821 m from where the owner keeps them.
  - The first run also found Overture addresses matched to Valdebótoa, a village 12 km away with the same street name. `pick_portal` now keeps only city postcodes (06000 to 06012), and the portal cache moved to `cartociudad_portals_v2.json`, so the register is geocoded again on the next build.
  - Confidences and penalties are left as they were: with no right proposal there is nothing to fit them to. The sample is thin (20 proposals, 14 moves), but 0 right out of 20 gives no reason to show any of these.
  - Unreviewed venues on the same day: 298 Overture and 35 OSM venues have a usable address; 195 of these geocode to a city portal. That would give 101 `position` proposals at the default 0.5 cut (59 Overture, 38 register, 4 OSM), all from sources the trial says to ignore.
  - The owner's own check of a position is what fixes venues today; a future position proposer would need metre-level evidence (the orthophoto, an entrance in OSM), not a street address.

- The answer key is small: 87 terrace decisions, 79 Overture venues and 14 moves. A threshold met on a handful of proposals is a hint. Re-run the trial after each review batch.
- `venue_proposals.csv` holds only its header in the repository. Rows are a local work list, and Publish does not ship them.
- Terrace positions confirmed from these proposals are read off the PNOA orthophoto, so they need the PNOA credit in the app. Today `build.py` adds that credit only when a curated row is present. That is a follow-up.
- A vision answer is cached per model, prompt version and image. Changing the prompt means bumping `PROMPT_VERSION`, which re-asks and costs again. A paid request without a usable answer (a refusal, `max_tokens`, an invalid answer) is cached too, with its reason, so it is not paid for again; transient failures (5xx, 429, a lost connection) are not, and errors every request would hit (authentication, permission, billing, a bad request) stop the run. `--limit` takes 0 or more.

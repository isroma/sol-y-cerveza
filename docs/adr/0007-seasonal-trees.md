# ADR-0007: Bare deciduous trees in winter

- Status: accepted (owner, 2026-11-23)
- Date: 2026-11-23
- Issue: #177

## Context

Each terrace's horizon comes from the PNOA-LiDAR surface model (MDS02, 2 m), which treats tree crowns as solid all year ([ADR-0001](0001-architecture.md), "Deciduous trees in winter will be reported as shade"). Many squares and streets in Badajoz are lined with deciduous trees (plane trees, mulberries, jacarandas, poplars along the Guadiana and the Rivillas). In winter, terraces under them get sun through bare branches, but the app shows them in shade. Badajoz also has plenty of evergreens (orange trees, palms, pines, holm oaks, magnolias), which do shade in winter. So the fix can't just drop all vegetation.

The owner wants this fixed. It changes what the app claims, so it needs a decision.

The product decisions still hold: the app shows **today only**, and "sun" means **no weather**.

## What the data can tell us

We need two things for each surface-model cell: is it vegetation or a building, and if it is vegetation, does it lose its leaves.

### Vegetation or building

| Option | What it gives | Licence | Practical here |
| --- | --- | --- | --- |
| **nDSM** (DSM − DTM) outside **building footprints** | Something above the ground that isn't a building | Already in the pipeline (CC-BY 4.0 scne.es) plus footprints | Yes. Footprints come from OSM (ODbL, already the base of the dataset) |
| Catastro INSPIRE buildings (footprints) | The full cadastral footprint set, with floors | Free reuse with attribution (Dirección General del Catastro) | Possible, not done: the ATOM download is per municipality, and the code Catastro uses for Badajoz needs checking. OSM buildings in Spain are largely a Catastro import anyway |
| PNOA-LiDAR point cloud, classes 3–5 (vegetation) and 6 (building) | Point-level classification | CC-BY 4.0 | Not practical: 2 × 2 km LAZ tiles sit behind the same CNIG download captcha as MDS02 (see [lidar research](../research/lidar.md)), and gridding them is new work |
| MDSnV / MDSnE (normalized vegetation / building surface, 2.5 m) | Vegetation height directly | CC-BY 4.0 | The only one listed on datos.gob.es is from the **1st coverage** (2009–2010). I found no 2nd-coverage MDSnV. Older than our DSM, so it would mix two epochs |

### Deciduous or evergreen

LiDAR alone can't tell. Options:

| Option | Verdict |
| --- | --- |
| **Sentinel-2 NDVI, summer vs winter** (10 m) | **Chosen.** Bare deciduous crowns lose most of their NDVI in winter, while evergreens keep it. Open data, attribution required ("Contains modified Copernicus Sentinel data"). L2A scenes are public, as Cloud-Optimized GeoTIFFs on AWS (`sentinel-cogs`, no account), so the pipeline can fetch them and cache them |
| PNOA orthophoto, near-infrared band | Only one date per flight (usually summer), so it can't see a seasonal change |
| Municipal tree inventory | Badajoz doesn't seem to publish one (searched datos.gob.es and the Diputación's portal on 2026-11-23: nothing for the city). Not relied on |
| OSM `natural=tree` + `leaf_cycle` | Too sparse in Badajoz to drive anything. Could later override the satellite per tree |
| Conservative rule: every non-building, non-ground cell counts as "maybe bare" | Rejected as the default: it would claim sun under orange trees, palms and pines all winter. Kept as a fallback idea only if Sentinel-2 ever becomes unavailable, and then with stronger wording |

## Decision

1. **A second, leaf-off horizon per terrace.** The pipeline builds a *leaf-off surface model*: the DSM where cells classified as deciduous vegetation are lowered to the terrain (DTM). It ray-marches that surface with the same code as today. A cell is lowered only if **all** of these hold:
   - it is at least 1 m above the terrain (DSM − DTM ≥ 1 m), with both rasters valid;
   - it is **not** within 2 m (one cell) of an OSM building footprint (`building=*`, `building:part=*`, `man_made` structures, city walls and walls). **Buildings are never removed**, and the tests check that;
   - its 10 m Sentinel-2 pixel is green in summer (median NDVI ≥ 0.40, July–August)
   - and loses at least 0.20 NDVI in winter (median, January–February of the same year).

   Clouds and shadows are masked with the L2A scene classification, and only scenes whose bbox is at least 95 % clear are used.
2. **Data contract:** a new optional field, `horizon_winter`, holds the leaf-off profile. It is `null` (or absent, in older files) when it would equal `horizon`, or when there is no leaf-off surface model. The app then uses `horizon`. Old files stay valid, so this is not a version bump.
3. **The leaf-off period runs from 1 December to 15 March, by Madrid date.** In that period the app uses `horizon_winter` when it exists, for everything: the badge, the list, the card, the sun bar and minutes of sun. Outside it, or without the field, nothing changes.
4. **What the app says.** Nothing new on the venue card: the owner wants the UI as simple as possible, so the leaf-off horizon just changes the answer (badge, list, filters, card, sun bar). The "Sobre los datos" panel explains the rule, but only when the file has leaf-off horizons:

   > Del 1 de diciembre al 15 de marzo damos por hecho que los árboles que pierden la hoja no dan sombra; los de hoja perenne, sí. Los distinguimos con imágenes del satélite Sentinel-2, así que puede haber algún fallo.

   The attribution gains `Contiene datos modificados de Copernicus Sentinel (<year>)` (Copernicus' required wording, in Spanish like the other lines).
5. **Failure mode: when in doubt, shade.** Every uncertain case keeps today's behaviour:
   - Without the Sentinel-2 composite or the building footprints, the build writes no `horizon_winter`.
   - A mixed 10 m pixel, a deciduous tree over winter-green grass (common in Badajoz, where grass greens up with the autumn rain), or a crown too small for Sentinel-2 keeps its leaves in the model.
   - Outside the period, the full horizon applies.

### Why 1 December to 15 March

- It is a rule of thumb, not a phenology model. Plane trees in south-west Iberia usually drop most of their leaves from November into December and leaf out again during March, but dates vary by year, species and how well-watered a tree is.
- I first proposed only the core of the season (15 December to the end of February), because in early December and in March many crowns still (or already) hold enough leaves to shade. **The owner chose the wider window on 2026-11-23**, accepting more risk at the edges: in early December and early March some terraces will show sun where crowns still cast real shade.
- The classifier's evidence window (January–February) sits inside the period, so "deciduous" still means "lost its green in mid-winter".
- It is one constant in `web/src/sun/leafOff.ts`, easy to narrow again if the edges prove wrong.

### Why lower crowns to the ground and not make them partly transparent

The horizon is one angle per direction, and the app's answer is sun or shade. Bare branches still cast dappled shade, roughly a third to a half of the direct sun from memory of the urban-forestry literature (not verified here). A partial-transparency model would need a "dappled" state the app doesn't have. The "Sobre los datos" paragraph says that this is an estimate.

## Consequences

- The pipeline needs two more inputs, both cached in `pipeline/.cache/` and both fetched by the new step `python -m solycerveza.leafoff`:
  - OSM building footprints, from Overpass.
  - The Sentinel-2 NDVI composite, read from public COGs on AWS. Every scene of those four months is checked, by reading the scene classification, red and NIR windows over the bbox, and up to 6 per season are kept. A run in this sandbox took about 2 minutes, and the cached composite is 6 MB.
- The step writes `badajoz_dsm_leafoff.tif` next to the DSM. `build` and `probe` use it when it exists.
- `terraces.json` grows by one 360-integer line per terrace whose answer can change, and by `"horizon_winter": null` elsewhere.
- **Epochs differ:** the LiDAR is from 2018–2019 and the Sentinel-2 composite from 2025. Where a tree has been felled since, Sentinel-2 sees no vegetation, so the DSM crown stays (shade, as today). A tree planted since isn't in the DSM at all (sun all year, as today).
- **The LiDAR flight season is unknown.** The 2nd coverage of Extremadura was flown between July 2018 and April 2019 ([lidar research](../research/lidar.md)). If sheet 0775 was flown in winter, its deciduous crowns are already thinner in the DSM. Then the summer answer under them is too sunny, and this ADR doesn't fix that. The CNIG file listing ("Fecha" column) settles it.
- The admin's probe returns `horizon_winter` too, so a curator can compare the two horizons for a pin. The admin page doesn't show it yet (follow-up).
- The ADR-0001 bias becomes "deciduous trees are bare from 1 December to 15 March, where Sentinel-2 sees them".
- The card doesn't say when sun depends on bare trees. Only the "Sobre los datos" panel explains the rule.

## What was verified and what wasn't (2026-11-23)

Verified from this sandbox:

- Sentinel-2 L2A COGs for tile **29SPD** (covers the whole Badajoz bbox) are readable without an account from `sentinel-cogs.s3.us-west-2.amazonaws.com`.
- In January 2025, 4 scenes were 100 % clear over the old town, and in July 2025 more than 8 were.
- The reflectances in that bucket are already harmonized (no −1000 offset; red band 5th percentile ≈ 300).
- On a 3 × 2 km window around the old town (58,140 pixels at 10 m), 13,495 pixels have summer NDVI ≥ 0.40. Of those, 3,686 lose ≥ 0.20 by January–February, mostly along the Guadiana and the Rivillas and in tree-lined avenues, while 4,968 lose less than 0.05 (evergreen, or deciduous over green grass).
- The pipeline's own step (`load_ndvi(2025)`) ran end to end against the bucket. It kept 6 summer scenes (19 Jul – 28 Aug) and 5 winter ones (13 Jan – 4 Feb). Over the whole bbox, 24 % of the pixels are green in summer and 8.4 % pass the deciduous rule. Most of those are irrigated summer crops in the Vegas del Guadiana: ground-level fields, which the 1 m height rule leaves alone. The rest is riparian woodland and scattered urban trees.

Not verified, and needing the owner:

- Individual species: no ground truth was available here. The thresholds (0.40 / 0.20) are starting values. Check them on 3–5 known terraces before trusting them ([pipeline guide, "Seasonal trees"](../pipeline.md#seasonal-trees)).
- OSM building coverage in Badajoz: Overpass was unreachable from this sandbox.
- The MDS02 flight date for sheet 0775, and the leaf-off dates above (they come from general knowledge, not from local phenology data).
- That no 2nd-coverage MDSnV exists: I only searched, I didn't confirm it with CNIG.

## Alternatives considered

- **Do nothing**, and say in "Sobre los datos" that winter shade under trees may be sun. Honest but useless for the squares people actually go to in winter.
- **A per-season factor** (ADR-0001's suggestion). A single factor can't tell an orange-tree street from a plane-tree square.
- **The conservative all-vegetation rule** (above). It overclaims sun under evergreens.
- **The PNOA point-cloud classes.** Cleaner vegetation and building separation, but blocked by the captcha, and they still don't tell deciduous from evergreen.
- **A "dappled" fourth sun state.** It would mean new colours and a legend change, for a distinction most users won't need.
- **A card line when the sun only gets through bare trees** ("Sol entre árboles sin hoja (estimado)"). It was proposed, and the owner rejected it to keep the UI as simple as possible.
- **A date picker** to show winter in summer: rejected by the product decisions (today only).

## Follow-ups

- Validate the thresholds on known terraces after the first rebuild.
- Let OSM `natural=tree` with `leaf_cycle=evergreen` (or a curator flag) override the satellite.
- Show the leaf-off horizon in the admin's sun preview.
- Repeat the Sentinel-2 composite when the 3rd-coverage LiDAR (2023) replaces MDS02, and pick the composite year closest to the LiDAR.

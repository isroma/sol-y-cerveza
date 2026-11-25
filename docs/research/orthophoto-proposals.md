# Sources for machine venue proposals (2026-11-24)

The sources behind `python -m solycerveza.proposals` ([ADR-0008](../adr/0008-machine-venue-proposals.md)): their endpoints, their licences and what was checked.

## PNOA orthophoto (terrace proposer)

- **Service:** IGN's WMS for "PNOA máxima actualidad", `https://www.ign.es/wms-inspire/pnoa-ma`, layer `OI.OrthoimageCoverage`. It is the INSPIRE orthoimagery view service and serves the most recent PNOA flight over each area.
  - In Badajoz that is the June 2025 true ortho at 0.25 m, flown in the morning ([data-sources.md](data-sources.md), Imagery).
  - Historical flights are on `https://www.ign.es/wms/pnoa-historico`. The 2019 layer is the best for terraces (midday, trees in leaf), but it is not used yet.
- **Request:** WMS 1.3.0 `GetMap` in EPSG:25829 (ETRS89 / UTM 29N, the pipeline's raster CRS; its axis order is easting, northing), `image/jpeg`.
  - Each crop is 120 m × 120 m at 800 × 800 px (0.15 m per pixel). The service resamples from the 0.25 m source.
  - One request at a time, at least 1 s apart, with the pipeline's User-Agent.
  - Every image is cached in `pipeline/.cache/ortho/`.
- **Licence:** CC BY 4.0, like every IGN/CNIG product since Orden FOM/2807/2015 (the product licence is published on scne.es; for PNOA, "PNOA cedido por © Instituto Geográfico Nacional de España").
  - The repository already credits it ("Terrace positions placed on the PNOA orthophoto © IGN (CC-BY 4.0)", and `PNOA_ATTRIBUTION` in `build.py`).
  - CC BY allows passing the image to a processor (the Claude API) and using positions read from it, with attribution.
  - The images themselves are cached locally and never committed or published.
- **Not checked live:** the session that built this could not reach `www.ign.es` (blocked by its network policy). The endpoint and layer name come from IGN's published service list. The first real run will show whether they answer as expected: `OrthoFetcher` logs any answer that is not a JPEG.

## Claude API (terrace proposer)

- **Model:** `claude-opus-5-5` (vision, structured JSON output, adaptive thinking at effort `medium`). Requests opt in to server-side refusal fallbacks (`fallbacks: "default"`).
- **Key:** `ANTHROPIC_API_KEY`, or any credential the Anthropic SDK finds.
- **Cost:** about $0.026–0.056 per venue at list price. The 87 reviewed venues with a terrace decision cost about $2.30–4.90, and the 607 unreviewed ones about $16–34. The command prints the estimate and asks nothing new without `--yes` or `--limit N`.
- **What it can see:** previous research on the same imagery is not encouraging. An open-vocabulary detector (OWLv2) reached 15 % precision on the 2019 flight and 0 % on 2025, because a table is about 3 px across and old-town terraces sit in shade, under trees or under arcades ([data-sources.md](data-sources.md), Imagery). A vision-language model can use context (parasols, rows of chairs on a plaza, pavement width), but that is a hypothesis. The trial (`--evaluate`) exists to test it before anything is shown to the owner as a one-tap proposal.

## CartoCiudad geocoder (position proposer)

- **Service:** `https://www.cartociudad.es/geocoder/api/geocoder/candidates` (CNIG). It is already used by `solycerveza.junta` and its answers are cached in `pipeline/.cache/cartociudad_portals_v2.json` (`v2` since #350: city postcodes only). The register addresses need no new requests; the venues' own OSM and Overture addresses (#350) do, one per address not yet cached, through the same `Geocoder` (0.25 s apart, backoff on 5xx).
- **Licence:** CC BY 4.0 (ign.es), already credited in the app (`JUNTA_ATTRIBUTION`) and the README.
- **Limit:** the Junta venues the build lists were placed by this same geocoder at their exact street number. Re-geocoding their address can only agree with their current position. The proposer is useful where a register row confirms an **OSM or Overture** venue whose position came from elsewhere.

## Venues' own addresses (position proposer, #350)

- **Overture `addresses`:** each place has a list of `{freeform, locality, postcode, region, country}`; the pipeline now keeps the column in its parquet. Counted on 2026-11-25 from release `2026-11-18.0` (read from the public S3 bucket, bbox filter): all 452 Overture venues in `terraces.json` have an address, and 338 of them have a line `split_address` cuts to a street and a number (298 unreviewed; 40 reviewed, 6 of them moved by the owner). The other 114 are "s/n", a shopping centre or a bare "Badajoz". Typical lines: "Av. de Elvas, 5", "Avenida De Elvas 7", "Calle Nevero 13, Calle Nevero Trece, 26". Licence as for the places (CDLA-Permissive-2.0); the address only picks the portal, and the position comes from CartoCiudad.
- **OSM `addr:*`:** `addr:street` and `addr:housenumber` from the cached Overpass answer (the query already returns all tags). On 2026-11-25, 41 OSM venues had both; 35 of them were unreviewed. ODbL, like the venues.
- **Hand-set confidence:** 0.80 for an OSM address, 0.70 for an Overture one, minus 0.15 for a move over 150 m and minus 0.15 when three or more venues' addresses share the portal (a shopping centre or a block). The trial decides whether either source is trusted.
- **Trial result (2026-11-25):** no address source is trusted. On the reviewed venues the register made 7 proposals, the OSM addresses 2 and the Overture addresses 11, and none was within 15 m of the owner's position. The owner's moves are 3 to 33 m, mostly under the 25 m rule. The numbers are in [ADR-0008](../adr/0008-machine-venue-proposals.md) (Consequences).
- **Villages:** the municipality includes villages (Valdebótoa, where the trial found one) with street names the city also has. CartoCiudad's `municipio_filter=Badajoz` returns both, so `pick_portal` now keeps only candidates whose `postalCode` is one of the city's (06000 to 06012).

## Overture attributes (not-a-venue proposer)

No network. It reads the attributes `solycerveza.overture.fetch_places` already keeps in the cached parquet: `confidence`, `category`, `datasets` (Meta, Microsoft and so on) and `websites`. CDLA-Permissive-2.0, as for the venues themselves.

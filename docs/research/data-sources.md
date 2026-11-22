# Data sources (research notes, 2026-11-22)

Starting point for #2 (terrace data), #4 (obstacles) and #8 (beer prices). Update this file when something is verified. The terrace decision is in [ADR-0002](../adr/0002-terrace-data-sources.md).

All counts below use the bbox `38.84,-7.04,38.92,-6.92` (`BADAJOZ_BBOX`).

## Finding: OpenStreetMap alone is not enough for terraces

Overpass query on 2026-11-22, `amenity ∈ {bar, pub, cafe, restaurant, biergarten}`:

| Metric | Count |
| --- | --- |
| Venues | 157 (90 restaurant, 31 cafe, 24 bar, 10 pub, 2 biergarten) |
| `outdoor_seating=yes` | 2 |
| `outdoor_seating=no` | 4 |
| No `outdoor_seating` tag | 151 |
| With `opening_hours` | 18 |
| `leisure=outdoor_seating` features (the terrace area itself, any venue) | 2 (bare nodes, no name or venue link) |

Badajoz has many more venues than 157, so OSM coverage is incomplete, and the terrace flag is almost entirely missing.

## Finding: Overture adds about 750 venues, but no terrace signal

Overture places, release `2026-11-18.0` (latest on 2026-11-22), read with DuckDB from `s3://overturemaps-us-west-2/release/2026-11-18.0/theme=places/type=place/*`, filtered on the `bbox` struct columns:

| Metric | Count |
| --- | --- |
| All places in bbox | 8,270 (990 under `food_and_drink`) |
| Comparable to the OSM set (see mapping below) | **859**: 406 restaurant, 325 bar/pub, 128 café |
| Not `operating_status = permanently_closed` | 822 |
| … and `confidence ≥ 0.5` | 756 |
| … and `confidence ≥ 0.77` | 477 |
| Likely duplicates (same name within 75 m) | 10 pairs |
| With an address / with a website or social link | 859 / 662 |
| Matched to an OSM venue (similar name within 100 m, or within 20 m) | 68 Overture ↔ 61 of 157 OSM |

- Mapping: `taxonomy.hierarchy[2]` in `restaurant` or `alcoholic_beverage_venue` (except `winery`), plus `taxonomy.primary` in `tapas_bar`, `gastropub`, `cafe`, `coffee_shop`, `tea_room`, `bistro`. Bakeries, ice cream and fast food are excluded, as in the OSM query.
- Overlap is small: about 96 OSM venues have no Overture match, and about 754 Overture venues are not in OSM. Neither source contains the other. The match is a heuristic, so read these numbers as approximate.
- **No outdoor-seating attribute.** The [place schema](https://docs.overturemaps.org/schema/reference/places/place/) has names, `basic_category`/`taxonomy`, contact fields, brand, addresses, `confidence` and `operating_status`, and nothing about amenities or hours. `categories` was removed in the September 2026 release ([guide](https://docs.overturemaps.org/guides/places/)). Only 6 names contain "terraz".
- Sources in the bbox: Meta (648 venues), BrightQuery (460), Microsoft (15), Foursquare (10), AllThePlaces (5). Overture places contain no OSM data.
- **Licence** ([attribution page](https://docs.overturemaps.org/attribution/)): it depends on the source. CDLA-Permissive-2.0 covers Meta, Microsoft, BrightQuery and most others; Foursquare is Apache-2.0 (with a NOTICE file) and AllThePlaces is CC0. [CDLA-Permissive-2.0](https://cdla.dev/permissive-2-0/) §2.1 only requires the licence text to travel with shared data. It has no share-alike and no attribution clause, and §3.1 puts no obligations on Results. Overture asks publications to credit "Overture Maps Foundation".

## Finding: the Ayuntamiento has the terrace register, but does not publish it

- **No open data.** datos.gob.es has terrace datasets for Madrid, Barcelona, Gijón and Zaragoza ("veladores en calzada"), and none for Badajoz. The Ayuntamiento's [transparency page](https://www.aytobadajoz.es/es/ayto/participacion-ciudadana/58345/transparencia) has no terrace register.
- **Ordinance**: [Ordenanza reguladora de la instalación de veladores](https://www.aytobadajoz.es/files/archivos/ayto/2011_04/ordenanza_definitiva_veladores.pdf) (2011 text, linked from [Ordenanzas](https://www.aytobadajoz.es/es/ayto/ordenanzas)). What an authorization contains:
  - Art. 28.3 (resolution): holder and business name, NIF/CIF, address of the venue; the exact space authorized (street and **nearest building number**); **area in m²**; whether it has a fixed enclosure; **number of tables, chairs and umbrellas**; other elements; hours.
  - Art. 26.2: every application includes a 1:2000 location map and a **1:100 dimensioned plan** of the terrace. Art. 28.4: the plan is attached to the resolution.
  - Art. 24.2: while the terrace is set up, a document with the authorization and that plan must be **visible from the street**. On-site curators can photograph it.
  - Art. 8: authorizations run from 1 January to 31 December and renew automatically unless the holder renounces.
  - So the register gives which venues have a terrace, where (street segment, not coordinates) and how big it is.
- **Precedent**: in RA CTBG 2023-0153 (expediente 914-2023), the Consejo de Transparencia upheld (*estimó*) a request for a Badajoz velador authorization file. The [PDF link](https://www.consejodetransparencia.es/ct_Home/dam/jcr:124cf368-4059-41c7-93c6-f8d232a12bc3/RA%20CTBG%202023-0153%20%5BExpediente%20914-2023%5D_Censurado.pdf) now redirects to a 404 after a site move. Search the CTBG site for the expediente number. Complaints against Extremadura councils go to the CTBG.
- Draft request: [`transparency-request.md`](transparency-request.md). It does not ask for the tax roll (*padrón de la tasa*), because tax data is confidential (Ley General Tributaria art. 95).

## Finding: Google Places `outdoorSeating` cannot go in a public dataset

[Google Maps Platform Terms](https://cloud.google.com/maps-platform/terms) (last modified 2026-08-26) and [Service Specific Terms](https://cloud.google.com/maps-platform/terms/maps-service-terms) (last modified 2026-10-28):

- ToS §3.2.3(a) *No Scraping*: no exporting or extracting Google Maps Content for use outside the Services, which includes pre-fetching, storing, resharing or rehosting it.
- §3.2.3(b) *No Caching*: no caching, except where the Service Specific Terms allow it.
- §3.2.3(c) *No Creating Content From Google Maps Content*.
- §3.2.3(e) *No Use With Non-Google Maps*: names "display or use Places content on a non-Google Map" as an example. Our map is MapLibre.
- Service Specific Terms §14.2–14.3 (Places API, legacy and new): no use with a non-Google map. Only latitude and longitude may be cached, for at most 30 days.

Storing `outdoorSeating` in `terraces.json` breaks (a), (b) and (e). Using it to decide which venues get a terrace record is content created from Google data (c). Street View and Google satellite imagery fall under (c) too, so they cannot be used to place terrace points. **Excluded entirely.**

## Finding: OSM can hold terrace positions, and StreetComplete asks about seating

- OSM has a tag for the terrace itself: [`leisure=outdoor_seating`](https://wiki.openstreetmap.org/wiki/Tag:leisure%3Doutdoor_seating) (de facto), a node or area where the tables are. It pairs with `outdoor_seating=yes` on the venue. Mapping our surveyed positions this way makes them ODbL data that others can reuse, and the pipeline could read them later.
- StreetComplete's [`AddSeating`](https://github.com/streetcomplete/StreetComplete/blob/master/app/src/commonMain/kotlin/de/westnordost/streetcomplete/quests/seating/AddSeating.kt) quest (v64.1, 2026-11-01) asks "indoor and outdoor / indoor only / outdoor only / takeaway only" on restaurants, cafés, fast food, ice cream, pubs, bars and bakeries that lack `outdoor_seating` or `indoor_seating`. It is **off by default** (marked seasonal) and has to be enabled in the quest settings. It only covers venues already in OSM. The Places overlay can add missing venues. It does not record where the tables are; that needs iD or JOSM.
- PNOA orthophotos (IGN, CC BY 4.0) can be used for OSM tracing under the IGN authorization ([OSM wiki](https://wiki.openstreetmap.org/wiki/ES:Importaci%C3%B3n_IGN)). Tables and umbrellas are usually visible on summer flights.

## Finding: an official venue list exists (Junta de Extremadura)

[Establecimientos de restauración en Extremadura](https://datos.gob.es/catalogo/a11002926-establecimientos-de-restauracion-en-extremadura) (CSV/XLSX, Latin-1, updated yearly, last update 2025-03-09; licence CC BY 4.0 per the Junta's catalogue entry, to verify):

- 1,100 rows in the municipality of Badajoz: 737 café-bar, 211 restaurant, 63 pub, 48 cafetería, plus banquet halls and catering.
- Fields: modality, category, opening date, name, address, postcode, website, seats. **No coordinates and no terrace flag.**
- It includes the outlying villages and probably venues that have closed. Useful for cross-checking venue names and addresses; not needed in the pipeline now.

## Sources

| Need | Source | Licence | Status / notes |
| --- | --- | --- | --- |
| Venues | OSM via Overpass | ODbL | Base layer. Public instances are often at capacity (502/504). |
| Venues | [Overture Maps](https://overturemaps.org) places | CDLA-Permissive-2.0 (most), Apache-2.0 (Foursquare), CC0 (AllThePlaces) | 859 comparable venues, about 754 not in OSM. No terrace attribute. Candidate list for curation (ADR-0002). |
| Venues | Junta de Extremadura register | CC BY 4.0 (verify) | 1,100 rows for Badajoz, addresses only. Cross-check. |
| Terrace flag | Ayuntamiento de Badajoz velador authorizations | Reuse under Ley 37/2007 once obtained | Not published. Ley 19/2013 request drafted. Gives street, nearest number, m² and tables. |
| Terrace flag | Google Places `outdoorSeating` | Proprietary | **Excluded** by ToS §3.2.3(a)(b)(c)(e) and Service Specific Terms §14. |
| Terrace flag + position | Curated CSV (#3), plus survey edits back to OSM (`outdoor_seating`, `leisure=outdoor_seating`) | Our own data; ODbL once in OSM | The only source of **position**. Workflow in ADR-0002. |
| Terrace position (desk) | PNOA orthophoto (IGN) | CC BY 4.0 | Place points before the on-site check. |
| Obstacles | PNOA LiDAR DSM: MDS02 (2 m, by MTN25 sheet) and MDS05 (5 m), [CNIG Centro de Descargas](https://centrodedescargas.cnig.es) | CC-BY 4.0 (IGN) | Includes trees. Point density 0.5–4 pts/m² in the 2nd coverage. Check which coverage and capture year covers Badajoz. |
| Obstacles | Normalized building DSM (2.5 m), [datos.gob.es](https://datos.gob.es/es/catalogo/e00125901-spaignmds-normalizado) | CC-BY 4.0 (IGN) | Building height above ground. Could simplify things if trees are handled separately. |
| Obstacles | Catastro INSPIRE Buildings, [ATOM feed](https://www.catastro.hacienda.gob.es/INSPIRE/buildings/ES.SDGC.bu.atom.xml) per municipality | Free reuse with attribution (verify) | Building parts carry `numberOfFloorsAboveGround`. Validation or fallback. |
| Terrain | MDT02 / MDT05 (IGN) | CC-BY 4.0 | Ground elevation. The old town (Alcazaba) sits on a hill. |
| Basemap | [OpenFreeMap](https://openfreemap.org) | Free, OSM attribution | No API key. Used by the bootstrap web app. |
| Sun position | `suncalc` (JS), `pvlib` (Python) | BSD | Client-side and pipeline-side respectively. |
| Beer price | None found | n/a | Needs crowdsourcing or curation (#8). |

## Prior art: where other sunny-terrace apps get their terraces

The pattern: cities that publish their terrace licences get used directly; elsewhere, apps fall back to OSM plus crowdsourcing.

| App | City | Terrace locations | Buildings |
| --- | --- | --- | --- |
| [Sunny Coffee Map](https://googlemapsmania.blogspot.com/2026/05/the-sunny-coffee-map.html?m=0) | Paris | City of Paris open data ([`terrasses-autorisations`](https://opendata.paris.fr/explore/dataset/terrasses-autorisations/)) | IGN BD TOPO (switched from OSM for heights) |
| [Terrazas al sol](https://terrazas.urbanbits.net/how-it-works) | Barcelona, Madrid, Málaga, Paris | "Each licensed terrace", i.e. municipal licence registers | "Public building data" |
| [Sunseekr](https://www.timeout.com/london/news/this-very-useful-app-shows-which-london-pub-gardens-are-currently-in-the-sunshine-031826) | London, Copenhagen | OpenStreetMap plus user-submitted spots | Building heights (source not stated) |
| [Shadowmap Sunny Seats](https://shadowmap.org/learn/sunny-seats) | Several | Venues that sign up (paid feature) | Shadowmap's 3D model |
| [Coffee in the Sun](https://apps.apple.com/app/id6746173958), [SunnyPints](https://apps.apple.com/tz/app/sunnypints/id6760045754) | Several | Not stated (built on Apple Maps) | 3D building shadows |

Shadow tooling: [OSM wiki: Shadows](https://wiki.openstreetmap.org/wiki/Shadows), [shadow-mapper](https://awesome.ecosyste.ms/projects/github.com%2Fperliedman%2Fshadow-mapper), [ShadeMap](https://bellingcat.gitbook.io/toolkit/more/all-tools/shademap).

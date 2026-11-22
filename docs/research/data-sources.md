# Data sources (research notes, 2026-11-22)

Starting point for #2 (terrace data), #4 (obstacles) and #8 (beer prices). Update this file when something is verified.

## Finding: OpenStreetMap alone is not enough for terraces

Overpass query on 2026-11-22, bbox `38.84,-7.04,38.92,-6.92`, `amenity ∈ {bar, pub, cafe, restaurant, biergarten}`:

| Metric | Count |
| --- | --- |
| Venues | 157 (90 restaurant, 31 cafe, 24 bar, 10 pub, 2 biergarten) |
| `outdoor_seating=yes` | 2 |
| `outdoor_seating=no` | 4 |
| No `outdoor_seating` tag | 151 |
| With `opening_hours` | 18 |

Badajoz has many more venues than 157, so OSM coverage is incomplete, and the terrace flag is almost entirely missing.

## Sources

| Need | Source | Licence | Status / notes |
| --- | --- | --- | --- |
| Venues | OSM via Overpass | ODbL | See above. Public instances are often at capacity (502/504). |
| Venues | [Overture Maps](https://overturemaps.org) places | CDLA-Permissive-2.0 (verify) | Not checked yet. Likely better coverage. No known outdoor-seating attribute. |
| Terrace flag | Ayuntamiento de Badajoz velador authorizations | n/a | Not published as open data. Requests for velador files have reached the [Consejo de Transparencia](https://www.consejodetransparencia.es/ct_Home/dam/jcr:124cf368-4059-41c7-93c6-f8d232a12bc3/RA%20CTBG%202023-0153%20%5BExpediente%20914-2023%5D_Censurado.pdf). A public-information request (Ley 19/2013) for the list of authorized terraces could seed the dataset. |
| Terrace flag | Google Places `outdoorSeating` | Proprietary | Terms restrict storing and redistributing data, so it is likely excluded from a public dataset. To confirm. |
| Terrace flag + position | Curated file in this repo, plus edits back to OSM (e.g. with StreetComplete) | ODbL once in OSM | Feasible at Badajoz's scale. Also solves terrace **position**, which no source provides. |
| Obstacles | PNOA LiDAR DSM: MDS02 (2 m, by MTN25 sheet) and MDS05 (5 m), [CNIG Centro de Descargas](https://centrodedescargas.cnig.es) | CC-BY 4.0 (IGN) | Includes trees. Point density 0.5–4 pts/m² in the 2nd coverage. Check which coverage and capture year covers Badajoz. |
| Obstacles | Normalized building DSM (2.5 m), [datos.gob.es](https://datos.gob.es/es/catalogo/e00125901-spaignmds-normalizado) | CC-BY 4.0 (IGN) | Building height above ground. Could simplify things if trees are handled separately. |
| Obstacles | Catastro INSPIRE Buildings, [ATOM feed](https://www.catastro.hacienda.gob.es/INSPIRE/buildings/ES.SDGC.bu.atom.xml) per municipality | Free reuse with attribution (verify) | Building parts carry `numberOfFloorsAboveGround`. Validation or fallback. |
| Terrain | MDT02 / MDT05 (IGN) | CC-BY 4.0 | Ground elevation. The old town (Alcazaba) sits on a hill. |
| Basemap | [OpenFreeMap](https://openfreemap.org) | Free, OSM attribution | No API key. Used by the bootstrap web app. |
| Sun position | `suncalc` (JS), `pvlib` (Python) | BSD | Client-side and pipeline-side respectively. |
| Beer price | None found | n/a | Needs crowdsourcing or curation (#8). |

## Prior art

None of these combines OSM buildings, a terrace layer and a time slider in an open-source project:

- [Sunny Coffee Map](https://googlemapsmania.blogspot.com/2026/05/the-sunny-coffee-map.html?m=0) (Paris): Paris open data plus 3D buildings and real-time shadows.
- [SunnyPints](https://apps.apple.com/tz/app/sunnypints/id6760045754) and [Coffee in the Sun](https://apps.apple.com/app/id6746173958) (iOS); [London pub gardens in the sun](https://www.timeout.com/london/news/this-very-useful-app-shows-which-london-pub-gardens-are-currently-in-the-sunshine-031826).
- Shadow tooling: [OSM wiki: Shadows](https://wiki.openstreetmap.org/wiki/Shadows), [shadow-mapper](https://awesome.ecosyste.ms/projects/github.com%2Fperliedman%2Fshadow-mapper), [ShadeMap](https://bellingcat.gitbook.io/toolkit/more/all-tools/shademap).

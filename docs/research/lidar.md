# PNOA-LiDAR surface and terrain models for Badajoz (research notes, 2026-11-22)

Research for #4. The pipeline step is `python -m solycerveza.obstacles` (run from `pipeline/`). It writes `pipeline/.cache/badajoz_dsm.tif` (surface: ground, buildings, trees) and `pipeline/.cache/badajoz_dtm.tif` (bare ground). The horizon step (#5) reads both.

## Summary

- **Preferred products:** MDS02 and MDT02 from the 2nd PNOA-LiDAR coverage, at 2 m. Badajoz was flown in 2018–2019. **In use since 2026-11-24:** the four sheets were downloaded by hand and the published data is built from them.
- **Sheets:** MTN50 sheet **0775 (Badajoz)** covers the whole bbox. MDS02/MDT02 come in MTN25 sheets, and the bbox needs two of them: **0775-2 (Valdebótoa)** and **0775-4 (Badajoz)**.
- **CRS:** ETRS89 / UTM 29N (EPSG:25829), the CNIG "H29"/"HU29" files. No reprojection is needed for these sheets.
- **Licence:** CC-BY 4.0 compatible (Orden FOM/2807/2015). Attribution for our derived rasters: `Obra derivada de MDS02 2015-2021 CC-BY 4.0 scne.es` and `Obra derivada de MDT02-cob2 2015-2021 CC-BY 4.0 scne.es`.
- **Downloads can't be scripted.** The CNIG Centro de Descargas guards every download with reCAPTCHA v3 plus a browser-automation check, so the 2 m sheets must be downloaded by hand ([steps below](#manual-download-mds02--mdt02)).
- **Newer data (checked 2026-11-25, #442):** the 3rd coverage was flown over Badajoz in Jun – Sep 2023 and is downloadable for sheet 0775, but only at 0.5 m (MDS50cm/MDT50cm) and only as provisional v1 models. There is no 2 m 3rd-coverage model. Recommendation: switch to it, but via v2 ([details](#3rd-coverage-for-badajoz-checked-2026-11-25)).
- **Automated fallback:** the IGN WCS download services serve MDS05 and MDT05 (5 m, 1st coverage, flown 2009–2010) with no captcha: `--source wcs`. The rasters built from them pass the sanity checks below and are usable until someone downloads the 2 m sheets.

## Products

| Product | Coverage, Badajoz flight | Grid | Download unit | Access | Attribution (derived work) |
| --- | --- | --- | --- | --- | --- |
| [MDS02, 2ª cobertura](https://centrodedescargas.cnig.es/CentroDescargas/modelo-digital-superficies-mds02-segunda-cobertura) | 2nd, Jul 2018 – Apr 2019 | 2 m, COG | MTN25 sheet | CNIG, manual | `Obra derivada de MDS02 2015-2021 CC-BY 4.0 scne.es` |
| [MDT02, 2ª cobertura](https://centrodedescargas.cnig.es/CentroDescargas/modelo-digital-terreno-mdt02-segunda-cobertura) | 2nd, Jul 2018 – Apr 2019 | 2 m, COG | MTN25 sheet | CNIG, manual | `Obra derivada de MDT02-cob2 2015-2021 CC-BY 4.0 scne.es` |
| [MDS50cm, 3ª cobertura](https://centrodedescargas.cnig.es/CentroDescargas/modelo-digital-superficies-mds50cm-tercera-cobertura) | 3rd, Jun – Sep 2023 (v1 only, published 2026-09-11) | 0.5 m, COG | 1:5,000 cut (MTN50 split 8 × 8) | CNIG, manual | `Obra derivada de MDS50cm-cob3 2022-2025 CC-BY 4.0 scne.es` |
| [MDT50cm, 3ª cobertura](https://centrodedescargas.cnig.es/CentroDescargas/modelo-digital-terreno-mdt50cm) | 3rd, Jun – Sep 2023 (v1 only, published 2026-07-09) | 0.5 m, COG | 1:5,000 cut | CNIG, manual | `Obra derivada de MDT50cm-cob3 2022-2025 CC-BY 4.0 scne.es` |
| [LiDAR point clouds, 3ª cobertura](https://centrodedescargas.cnig.es/CentroDescargas/lidar-tercera-cobertura) | 3rd, Jun – Sep 2023 | 5 points/m², LAZ, RGBI | 1 × 1 km | CNIG, manual | not checked |
| MDS05 ([WCS](https://wcs-mds.idee.es/mds?service=WCS&request=GetCapabilities), coverage `mds05`) | 1st, Oct 2009 – Sep 2010 | 5 m, served in EPSG:25830 | any subset | automated | `Obra derivada de MDS05 2008-2015 CC-BY 4.0 scne.es` |
| MDT05 ([WCS](https://servicios.idee.es/wcs-inspire/mdt?service=WCS&request=GetCapabilities), coverage `Elevacion25830_5`) | 1st (presumably, see below) | 5 m, EPSG:25830 | any subset | automated | `Obra derivada de MDT05-cob1 2008-2015 CC-BY 4.0 scne.es` |

Notes:

- **MDS** is interpolated from LiDAR points classified as ground, vegetation (low, medium, high) and buildings. **MDT** uses ground points only. Heights are orthometric. Over water, LiDAR returns are sparse, so CNIG interpolates water to a flat, less reliable height.
- **Flight dates per lot** come from the PNOA-LiDAR status pages ([1st](https://pnoa.ign.es/web/portal/pnoa-lidar/primera-cobertura), [2nd](https://pnoa.ign.es/web/portal/pnoa-lidar/segunda-cobertura) and [3rd](https://pnoa.ign.es/web/portal/pnoa-lidar/tercera-cobertura) coverage):
  - 1st coverage, lot "Extremadura Sur": Oct 2009 – Sep 2010, 0.5 points/m², Leica ALS50.
  - 2nd coverage, "Extremadura Sur": Jul 2018 – Apr 2019, 1 point/m², Leica ALS80. The "Extremadura Norte" lot (Oct 2018 – Mar 2019, 2 points/m²) covers the north.
  - 3rd coverage, Extremadura: Jun – Sep 2023, 5 points/m². Provisional MDT/MDS ("v1") are published. Final v2 models are expected in the 2nd half of 2026, derived products in the 1st half of 2027 (status table dated September 2026). See [3rd coverage for Badajoz](#3rd-coverage-for-badajoz-checked-2026-11-25).
- I assume Badajoz falls in the "Sur" lots; the lot boundaries were not checked. Each CNIG file listing shows the capture year per sheet ("Fecha" column), which settles it once someone opens the 0775 listing.
- The MDT WCS doesn't say which coverage it serves. Its 5 m grid matches MDT05 (1st coverage), the only 5 m MDT that CNIG publishes.
- The [OGC API Coverages](https://api-coverages.idee.es/collections) endpoint offers the same MDT grids (up to 5 m in EPSG:25830), but no surface model.
- The [normalized building and vegetation models](https://datos.gob.es/es/catalogo/e00125901-spaignmds-normalizado) (MDSnE/MDSnV, 2.5 m) give height above ground directly. They are an alternative if we ever need to tell buildings and trees apart (e.g. a winter factor for deciduous trees).

## Sheets covering the bbox

`BADAJOZ_BBOX` is 38.84–38.92° N, 7.04–6.92° W. Frames from the IGN grid WMS (`https://www.ign.es/wms-inspire/cuadriculas`, layers `cuadricula-mtn50-actual` and `cuadricula-mtn25-actual`, version 20260303):

| Sheet | Name | West | South | East | North |
| --- | --- | --- | --- | --- | --- |
| MTN50 0775 | Badajoz | −7.187500 | 38.833333 | −6.854167 | 39.000000 |
| MTN25 0775-2 | Valdebótoa | −7.038889 | 38.916667 | −6.854167 | 39.000000 |
| MTN25 0775-4 | Badajoz | −7.086111 | 38.833333 | −6.854167 | 38.916667 |

- West of Badajoz the land is Portuguese. The current grid has no 0775-1 or 0775-3 (the "official" RD 1071/2007 grid still lists them as "Río Caya"). Instead, 0775-2 and 0775-4 are extended westwards, and CNIG cuts its downloads by this current grid.
- The bbox reaches 38.92° N, about 370 m into 0775-2, so that sheet is needed for the northern edge.
- The bbox's north-west corner (west of 7.0389° W, north of 38.9167° N) is in Portugal and outside every Spanish MTN25 sheet. Built from MDS02/MDT02, that sliver will be `NODATA`. No terraces are near it.
- Expected file names, from the CNIG listings: `MDS02-ETRS89-H29-PM-2-0775-2.TIF`, `MDS02-ETRS89-H29-PM-2-0775-4.TIF`, `MDT02-ETRS89-HU29-0775-2-COB2.TIF` and `MDT02-ETRS89-HU29-0775-4-COB2.TIF`. CNIG sheets range from a few MB to about 140 MB each.
- `solycerveza.obstacles.MTN25_SHEETS` holds these frames plus their neighbours, so `sheets_for_bbox()` still works if the bbox grows a little.

## CRS

- CNIG files use the UTM zone of each sheet. All of `BADAJOZ_BBOX` (6.92–7.04° W) is in zone 29, so the sheets are EPSG:25829.
- The WCS services serve the whole country in ETRS89 / UTM 30N (EPSG:25830, "huso 30 extendido", extended zone 30). The pipeline reprojects that to EPSG:25829. At Badajoz the two UTM grids are rotated about 3.8° from each other, so the request covers the envelope of the whole target grid.

## Licence and attribution

- [Orden FOM/2807/2015](https://www.boe.es/boe/dias/2015/12/26/pdfs/BOE-A-2015-14129.pdf) and the [IGN use licence](http://www.ign.es/resources/licencia/Condiciones_licenciaUso_IGN.pdf) are compatible with CC-BY 4.0: free use, including commercial use, as long as origin and ownership are credited. Both WCS capabilities say `CC BY 4.0 scne.es`.
- Each CNIG product page lists three wording options. Ours are rasters and horizons derived from the data, so the "Tipo 3" (derived work) wording applies, e.g. `Obra derivada de MDS02 2015-2021 CC-BY 4.0 scne.es`.
- The long form names the producers: `MDS02 2015-2021 CC-BY 4.0 Instituto Geográfico Nacional, Dirección General de Catastro, Fondo Español de Garantía Agraria, Comunidades autónomas, O.A. Centro Nacional de Información Geográfica y ENAIRE`.
- The pipeline stores the exact wording in each output GeoTIFF's `SOURCE` tag, so later steps can copy it into `terraces.json` `attribution` (#12) and the README.

## How downloads work

### CNIG Centro de Descargas (MDS02, MDT02, MDS50cm, MDT50cm)

- Each product page lists files with a filter (autonomous community, province, municipality, MTN50 sheet, cadastral reference or coordinates) and a map search. Every file has a download button. Using the data implies accepting the licence; there is no separate click-through.
- **The download button can't be automated, by design.** It calls `preAutorizarDescarga` with a reCAPTCHA v3 token. The form also sends a `nav_signature` that the page sets to `BOT_DETECTED` when it sees WebDriver/Selenium. On top of that, the AJAX file listing (`archivosSerie`) answers 403 to non-browser clients. We don't work around any of this.
- I found no ATOM feed or API for these products.

### Manual download (MDS02 + MDT02)

1. Open the [MDS02](https://centrodedescargas.cnig.es/CentroDescargas/modelo-digital-superficies-mds02-segunda-cobertura) and [MDT02](https://centrodedescargas.cnig.es/CentroDescargas/modelo-digital-terreno-mdt02-segunda-cobertura) product pages.
2. On each, filter by "Hoja MTN50" = 0775 and download the sheets 0775-2 and 0775-4 (COG).
3. Put the MDS02 files in `pipeline/.cache/cnig/mds02/` and the MDT02 files in `pipeline/.cache/cnig/mdt02/`. Other folders work with `--dsm-dir` and `--dtm-dir`.
4. From `pipeline/`, run `uv run python -m solycerveza.obstacles`. When files are missing, the command prints these steps and exits with code 2.

### IGN WCS 2.0 services (MDS05, MDT05): automated

- `uv run python -m solycerveza.obstacles --source wcs` sends one `GetCoverage` request per model. The raw responses are cached in `pipeline/.cache/wcs/`, keyed by the requested area. Each response is about 35 MB, and the whole run takes about 15 s.
- The services' GeoTIFF output is int16, i.e. whole metres. The pipeline asks for `application/asc` instead: an ESRI ASCII grid with float values, returned as multipart together with its `.prj`.
- The MDS service resamples onto its own grid of 5.0046 m in EPSG:25830, so the fallback is resampled twice (by the server, then to 2 m in EPSG:25829).

## Pipeline output

- Two float32 GeoTIFFs, deflate-compressed, `NODATA = -9999`, in EPSG:25829. Both share one grid: the bbox projected to UTM 29N, snapped outwards to the cell size (2 m by default, set with `--resolution`). Today that is 5305 × 4555 cells of 2 m, about 10.6 km × 9.1 km, roughly 35 MB for both files.
- Tiles are mosaicked, reprojected and cropped in one GDAL warp per tile, with **nearest-neighbour** sampling: a bilinear kernel would shave the tops of towers and tree crowns. Where tiles overlap, the first file in name order wins.
- If we switch to the 0.5 m MDS50cm, downsampling the DSM to 2 m should use a max filter instead, or thin obstacles get lost. Not implemented.

## Sanity check (WCS fallback: MDS05/MDT05, 2009–2010, 5 m)

- Run on 2026-11-22 with `--source wcs`, on the 2 m output grid. nDSM = DSM − DTM.
- Place outlines come from OSM via Overpass. Building parts come from the Catastro INSPIRE WFS (`BU:BuildingPart`, around Calle Menacho in the old town and around Valdepasillas). The analysis script is not in the repo.
- **This only checks the fallback data.** Repeat it once the MDS02/MDT02 sheets are downloaded (see open questions).

| Place | Expected | nDSM measured |
| --- | --- | --- |
| Cathedral tower (Plaza de España) | about 41 m (published figure) | max **34.2 m** |
| Torre Siglo XXI, the tallest building in Extremadura | 17–18 floors in Catastro (51–54 m at 3 m per floor). Published height: 88 m, which presumably includes the crown. | max **52.1 m** |
| Plaza de España, a wide plaza | about 0 m, plus some trees | median **0.4 m**, p90 8.6 m |
| Plaza Alta, an open arcaded square | about 0 m | median **1.0 m**, p90 9.1 m (edge cells take in the facades) |
| Parque de Castelar, a park with tall trees | canopy 5–20 m | median **6.3 m**, p90 14.1 m, max 34 m |
| Alcazaba (hilltop) | ground at about 200 m | DTM about 199 m, highest nDSM 21 m on the walls and towers |

**Catastro building parts:** 115 parts with at least 200 m² and at least 1 floor. Each value is the median nDSM inside the footprint.

| Floors | Parts | Median nDSM | Per floor |
| --- | --- | --- | --- |
| 1 | 19 | 6.2 m | 6.2 m |
| 2 | 13 | 9.1 m | 4.5 m |
| 3 | 15 | 11.2 m | 3.7 m |
| 5 | 5 | 17.5 m | 3.5 m |
| 7 | 15 | 22.3 m | 3.2 m |
| 9 | 11 | 27.2 m | 3.0 m |
| 10 | 7 | 30.0 m | 3.0 m |

- From 6 floors up, the nDSM matches 3.0–3.2 m per floor almost exactly.
- Low buildings come out taller than 3 m per floor, for two reasons:
  - Old-town ground floors are high, and roofs are pitched.
  - At 5 m, cells along a footprint's edge mix in taller neighbours.
- Overall: nDSM − 3 m × floors has a median of +1.8 m and a mean absolute error of 2.5 m, and 69% of the parts fall within ±3 m.

**Reading:** the fallback is plausible for horizons. It captures buildings and tree canopy, and the old town's topography lives in the DTM. Narrow, tall features (bell towers, pinnacles) come out several metres low, as expected from 0.5 points/m² gridded at 5 m.

## 3rd coverage for Badajoz (checked 2026-11-25)

Research for #442, after the review in #440 found the 2018–19 surface out of date along the Guadiana (river-island trees since removed, patched by hand in `pipeline/data/surface_corrections.geojson`). Sources: the PNOA-LiDAR [3rd-coverage status page](https://pnoa.ign.es/pnoa-lidar/tercera-cobertura) and [product list](https://pnoa.ign.es/pnoa-lidar/productos-a-descarga), the [IDEE blog post on the 3rd-coverage products](https://blog.idee.es/en/archivo/-/blogs/nuevos-productos-lidar-de-la-3-cobertura-del-pnoa), and the CNIG product pages, listings and [news](https://centrodedescargas.cnig.es/CentroDescargas/novedades), read in a browser.

### What exists

- **Coverage:** CNIG lists 51 MDS50cm and 51 MDT50cm files for MTN50 sheet 0775, all dated 2023. The 3rd coverage is cut by 1:5,000 sheets, not MTN25, so 0775-2/0775-4 don't apply. Names look like `MDS50CM-ETRS89-H29-0775B-6-6-COB3-V1.tif` (the `B` presumably marks the westward-extended sheet).
- **Flight:** Jun – Sep 2023 (lot "Extremadura"), 5 points/m², point clouds coloured RGBI. In summer, so deciduous trees are in leaf.
- **Products:**
  - MDS50cm and MDT50cm, 0.5 m, COG, EPSG:25829 for our cuts.
  - Point clouds (LAZ, 1 × 1 km). The status table marks Extremadura's edited classification (NPC02) "Publicada (*)", with a footnote that work continues. I didn't check the listing for our tiles.
  - **No 2 m model.** No MDS02/MDT02 (or 1 m, 5 m) exists for the 3rd coverage, and none is announced. Normalized building/vegetation models exist only for the 1st and 2nd coverages.
- **v1 vs v2:** v1 is provisional, interpolated from the automatic initial classification (NPC01). v2 is final, from the edited classification (NPC02), with better vegetation and building classes. CNIG says both have the same metric accuracy. Extremadura dates:
  - MDT50cm v1: published 2026-07-09.
  - MDS50cm v1: published 2026-09-11.
  - v2: "Previsión 2º semestre 2026". As of the 2026-11-23 news, v2 MDT50cm has been published for other regions (16-11-2026) but not Extremadura.
- **Licence:** the same Orden FOM/2807/2015 licence, CC-BY 4.0 compatible. Derived-work wording, verbatim from the CNIG pages: `Obra derivada de MDS50cm-cob3 2022-2025 CC-BY 4.0 scne.es` and `Obra derivada de MDT50cm-cob3 2022-2025 CC-BY 4.0 scne.es`.
- **Download:** same CNIG Centro de Descargas, same reCAPTCHA, so by hand. On each product page, set "Ámbito" to "Hoja MTN50", type `775`, pick `0775` from the suggestions and apply the filter (three pages of results).

### Cuts covering the bbox

Assuming the cuts are numbered row-column from the sheet's north-west corner (row 1 north, column 1 west; not verified), each cut is 1/8 of 0775 in each direction (0.041667° × 0.020833°). The bbox then needs rows 4–8 and columns 4–7: **20 cuts per product**.

- MDS50cm: 20 files, about 1.7 GB (77–95 MB each).
- MDT50cm: 20 files, likely 2–2.5 GB (row 4 cuts are 125–132 MB each).
- The #440 corrections (38.884–38.894° N, 6.959–6.974° W) all fall in cut **6-6** (`…-0775B-6-6-COB3-V1.tif`, 84 MB for the MDS).

### Comparison with what we use

|  | MDS02/MDT02 (in use) | MDS50cm/MDT50cm, 3rd coverage |
| --- | --- | --- |
| Flight | Jul 2018 – Apr 2019 | Jun – Sep 2023 |
| Density | 1 point/m² | 5 points/m² |
| Grid | 2 m | 0.5 m |
| Files for the bbox | 2 + 2 MTN25 sheets | 20 + 20 cuts |
| Classification | final | v1 automatic now, v2 edited pending |
| Pipeline support | yes | no: needs cut names in `obstacles.py` and max-filter downsampling to 2 m |

### Recommendation

**Switch to the 3rd coverage, but use v2 if it arrives soon.**

- 2023 is 4–5 years newer, at 5× the point density. That should cover new buildings and tree growth, and probably some of the Guadiana changes #440 patched by hand. It's not certain that it covers all of them: the trees may have been removed after summer 2023.
- Before downloading 40 files, download only cut 6-6 of MDS50cm v1 and compare it with the corrections. If the river-island trees are gone in 2023, the switch removes most of the hand patching.
- v1's automatic classification matters little for the MDS (all classes count as surface) but more for the MDT, so the nDSM is less reliable in v1. If Extremadura's v2 isn't published by about the end of Q1 2027, use v1 and repeat the sanity check.
- The switch is pipeline work (a separate PR): add the cut grid and names to `obstacles.py`, then downsample to 2 m with a max filter for the DSM (see [Pipeline output](#pipeline-output)) and a mean or nearest filter for the DTM. The attribution strings change to the `cob3` wording above.

## Known gaps and caveats

- **Age:**
  - The 2 m data is from 2018–2019 and the fallback from 2009–2010. Buildings built since then are missing, trees have grown, and demolished buildings still appear.
  - The 3rd coverage (2023, 5 points/m², 0.5 m) is the freshest. Its v1 models are published for sheet 0775; the final v2 models are due in late 2026 ([details](#3rd-coverage-for-badajoz-checked-2026-11-25)).
- **Season:**
  - The 1st coverage was flown Oct–Sep and the 2nd Jul–Apr, so deciduous trees may be in leaf or bare depending on the date.
  - Per ADR-0001, the horizon treats every tree as opaque all year.
- **Water:** CNIG flattens the Guadiana and its reservoirs to a single height, which is less reliable.
- **DSM below DTM:** 0.4% of the fallback grid has nDSM below −1 m. These cells cluster on the northern and south-western edges (riverbeds and water). The horizon step should not rely on nDSM ≥ 0.
- **Not modelled:** awnings, umbrellas and other street furniture. LiDAR may catch some, but not reliably.
- **Portugal:** the north-west corner of the bbox has no MDS02/MDT02 sheet, so it is `NODATA` in 2 m builds. The WCS data does cover it.

## Open questions

- [ ] Download the four MDS02/MDT02 files by hand, rerun the step and repeat the sanity check. Also record the per-sheet capture year from the CNIG listing.
- [x] ~~Should we skip the 2nd coverage and go straight to the 3rd?~~ Answered in [3rd coverage for Badajoz](#3rd-coverage-for-badajoz-checked-2026-11-25): yes, preferably with v2.
- [ ] Download cut 0775B-6-6 of MDS50cm v1 and check whether the #440 river-island trees are gone in 2023.
- [ ] Watch the CNIG news for Extremadura's MDS50cm/MDT50cm v2.

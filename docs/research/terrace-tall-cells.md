# Terrace points on tall LiDAR cells

- Date: 2026-11-25
- Data: `web/public/data/terraces.json` (88 terraces with a horizon), the 2 m DSM and DTM in `pipeline/.cache/`, OSM structure outlines (`solycerveza.leafoff.load_structures`), and PNOA orthophoto crops (`solycerveza.ortho`).

## Method

For each terrace, nDSM = DSM − DTM at the terrace point's own cell, and the highest nDSM of any cell within 2 m of the point (the cell's square, not its centre). A terrace is listed when either value is above 2.5 m. For each listed terrace, I checked:

- whether the point lies inside an OSM building outline;
- the lowest surface within 6 m (does the point have ground nearby at all?);
- the surface roughness in the 3 × 3 cells around it (crowns are rough, roofs and canopies are smooth);
- a 60 m orthophoto crop with the OSM outlines, the venue point and the nDSM cells over 1 m and 2.5 m drawn on it.

OSM outlines and the LiDAR building mask line up: the best shift between them is (0, 0), so a mismatch is a real feature (an overhang, a canopy, a tree) and not a registration error. The PNOA orthophoto is not a true orthophoto: tall roofs lean away from the nadir, so I trusted the LiDAR for where a building is and the photo for what a surface is.

## Result

52 terraces are listed: 32 have their own cell above 2.5 m, and 20 more have a tall cell within 2 m.

| Class | Count | What to do |
| --- | --- | --- |
| Point misplaced onto a building or roof | 9 | 4 moved in this PR; 5 need the owner (below) |
| Under a tree crown | 14 | Position is right; see "Terraces under a tree" |
| Under an arcade, canopy, porch or awning | 7 | Position is right; the shade is mostly real |
| Edge only: tall facade or tree within 2 m, own cell ≤ 2.5 m (plus 2 at 2.7 m) | 22 | Nothing; the horizon gets sun |

### Moved in this PR (`pipeline/data/venue_review.csv`)

| Terrace | Was | Now | Lowest horizon over the south (135–225°) |
| --- | --- | --- | --- |
| Bar Rincón Avecilla | on the roof, 23.5 m | NW pavement, 4 m out, under plane trees (15 m) | 87.6° → 80.3° |
| 100 Montaditos (`overture:aab4ff94…`) | on the roof of the same block, 17.0 m | NW pavement, 6 m out, under plane trees (11 m) | 84.3° → 69.4° |
| Café-Bar El Viejo Verano | on the façade edge, 18.8 m | SW pavement, 4 m out, 0.7 m | 79.3° → 30.1° |
| Taquería del Sur | under the façade overhang, 12.8 m | SW pavement, 4 m out, 2.3 m | 65.5° → 19.9° |

The first two stay mostly in shade, rightly: they are on the north-west side of a 20 m block, under street trees.

### Misplaced, but the owner has to say where

- **Pans & Company** and **100 Montaditos** (`overture:c023c47c…`): both points sit on the roof of the same shopping centre (around 38.8843, −7.0207). They are probably food-court venues. Mark them `no_terrace`, or pin their outdoor tables if they have any.
- **Restaurante Drómo Badajoz**: the point is on a flat roof (9.5 m, smooth). The tables could be on the pavement to the north-east (under trees) or to the south-east (open). I didn't guess.
- **Moma Experiencia**: the point is inside the outline of the Edificio Siglo XXI, on the podium roof (10.7 m). If the terrace really is up there, the horizon is wrong in the other direction, because it is computed from the ground. The pipeline has no rooftop terraces, so pin it at street level or mark it `no_terrace`.
- **La Serena, taberna extremeña**: on the same block as Bar Rincón Avecilla. The point is already outside the building, under the street trees (11.4 m, rough). Fine as it is unless the owner knows otherwise.

### Under a tree crown (position right)

Gambrinus Badajoz, Los Alféreces, Domino's Pizza, Bar los amigos, Bar Vicente y Tetin, La Bellota Extremeña, Foster's Hollywood, Gladys, Floco Original Coffee, Restaurante Ka'Maty, Agua Bendita, M&a, La Bacana, La Serena.

### Under an arcade, canopy, porch or awning (position right)

- **Siente La Dehesa, Carmen**: old-town pedestrian streets covered by summer shade sails (the white zigzags in the photo). The LiDAR has no street floor within 10 m of either point. The sails read as a roof 12–16 m above the DTM, and the DTM is right: there is ground within 25 m.
- **La Cascada**: a narrow old-town street, with no ground cell within 10 m (12.1 m, smooth). The 2 m DSM either doesn't resolve the street or it is covered too.
- **The blue parrot**: pavement outside the OSM outline, under a smooth surface at roof height (11.9 m). That is probably an upper-floor overhang. Check on site.
- **Restaurante la Marmita**: a small white-roofed structure at the building's corner (8.1 m).
- **McCafé** (`overture:e2d67ef1…`): under a white canopy beside the restaurant (2.7 m).
- **Touareg Lounge Bar**: a small tiled patio against the building, probably a pergola (3.8 m).

The old-town sails are seasonal, like leaves: they go up for the summer, and the LiDAR caught them. Today the app shows those streets in shade all year.

### Edge only (no action)

Sonata, La Encontrada, Tanuki San, PaneCafé, La Jarana, taj mahal, Café Bar Los Albatros, Kiosco San Francisco, Ferri's Bistrot, Bar Ricomiendo, Gaho Lounge, Bar O Furancho, Raíces, Restaurante Banderas, The Irish Tavern, McCafé (`overture:98bb1896…`), Bar Restaurante la Granadilla, Cervecería Almadraba, La Bistrológica, City Poke, Mogambo, Cerveceria El Pilar, Mesón La Piedra. The horizon skips the observer's own cell, so a tall neighbour only blocks its own direction.

The orthophoto service failed for Ferri's Bistrot and McCafé `98bb1896…` (HTTP 502), and their south is above 59°. Look at both in the admin.

## Terraces under a tree

Today a crown over the table blocks the sun all day, and from 1 December to 15 March `horizon_winter` lowers deciduous crowns to the ground (ADR-0007).

**Recommendation: keep "under a crown = shade" while the tree is in leaf, and don't move pins out from under trees to get a sunnier answer.** At midday in summer that is what a customer feels.

The real error is at low sun. The DSM is a top surface, so it treats a crown as solid down to the ground. Morning and evening sun reaches under a crown whose base is 2.5–3 m up. From an eye at 1.2 m, a crown base at 3 m that is 2 m away lets through sun below about 42°. One angle per azimuth can't say "blocked above X, clear below". Fixing it would take a second, "under-canopy" profile in the data contract and a client rule that uses it. That changes the sun rules, so it needs the owner's decision. It is not done here.

**Found on the way: no published terrace has a `horizon_winter`.** `pipeline/.cache/badajoz_dsm_leafoff.tif` doesn't exist, so the build logs "no leaf-off surface model". The leaf-off season starts on 1 December, and until `python -m solycerveza.leafoff` runs and the data is rebuilt, every tree stays in leaf all winter.

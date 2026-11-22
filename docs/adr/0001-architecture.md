# ADR-0001: Precomputed horizons, static web client, Capacitor for mobile

- Status: accepted
- Date: 2026-11-22

## Context

The app has to show, for bar and restaurant terraces in Badajoz, whether each one gets sun or shade at **any date and time** the user picks. It should start as a web app and later ship to iOS and Android. A later iteration adds the median price of a standard beer per venue.

Shade depends on the sun position (date, time, location) and on the obstacles around the terrace: buildings, trees, awnings. Sun position is cheap to compute on any device. Obstacles are the expensive part.

## Decision

1. **Precompute a horizon profile per terrace, offline.** For each terrace point, a Python pipeline ray-marches a surface model in 360 directions and stores the highest obstacle angle in each one. At runtime, the sun is visible when its altitude is above the horizon angle at its azimuth.
   - The horizon does not depend on the date, so one profile (360 small integers) answers every date and time.
   - The dataset stays small: about 0.5 KB per terrace before compression.
2. **Obstacles come from a LiDAR surface model** (PNOA LiDAR DSM, 2 m, IGN/CNIG) plus a terrain model for ground level. Unlike building footprints, it includes trees and the old town's topography. Catastro INSPIRE buildings (floors above ground) serve as validation and fallback. To be confirmed in #4.
3. **No backend in v1.** The pipeline writes `data/terraces.json`, which is reviewed through PRs. The web client is static and hosted on GitHub Pages.
4. **Client stack: Vite + React + TypeScript + MapLibre GL JS**, with OpenFreeMap vector tiles (OSM-based, no API key).
5. **Mobile through Capacitor** wrapping the same web build, so web and mobile share the map code.
6. **Repo layout: `web/` (npm) and `pipeline/` (uv) side by side**, with no workspace tooling until there is a second JS package.

## Consequences

- Accuracy depends on **where the terrace point is** (the tables, not the building entrance) and on the DSM's resolution and capture date. Terrace positions need curation (#2, #3).
- Deciduous trees in winter will be reported as shade: a known bias, which could later be corrected with a per-season factor or tree classes from LiDAR.
- Awnings and umbrellas are not modelled.
- Adding the v2 beer prices needs a backend for user reports (see #8). This ADR keeps v1 static on purpose.
- Data refreshes are PRs with deterministic output, so changes are reviewable.

## Alternatives considered

- **Real-time shadow rendering in the client** (ShadeMap-style 3D buildings): heavier on phones, needs building heights in the client, and the existing libraries are commercial.
- **Precomputing sun/shade per date and time slot**: much bigger data, and it fixes the time resolution. The horizon gives the same answer more compactly.
- **Expo (React Native)**: feels more native on mobile, but the map needs two implementations (MapLibre Native and GL JS for web).
- **Flutter + flutter_map**: one codebase with a consistent map, but a different language from the pipeline and the web ecosystem.

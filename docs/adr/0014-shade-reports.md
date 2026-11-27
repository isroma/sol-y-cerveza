# ADR-0014: Shade reports, checked against measured sunshine

- Status: accepted (2026-11-27)
- Date: 2026-11-27
- Issue: #527
- Amends: [ADR-0012](0012-sun-reports.md) (decision 1, "Sun only, no shade", and the rejected alternative "Shade reports too")

## Context

ADR-0012 lets visitors say "the sun is on this terrace now", which lowers a terrace's horizon where the model has an obstacle that isn't there. It refused the opposite report: a visitor in shade under a clear sky and one under a cloud look the same to us, and the app ignores weather by design (owner, 2026-11-23).

The model is wrong in both directions, though. A new awning, a building or a tree that grew since the 2018–19 LiDAR flight shows as sun where people sit in shade, and nothing lets them say so. The owner (2026-11-27) asked for the shade report, with the weather at the moment it is made deciding whether it can count.

## Decision

From the venue card's back, while the app says sun at that terrace now, a visitor can say **"ahora mismo hay sombra"** (`shade: true` in `POST /v1/changes`, ADR-0010; never together with `sun: true`). It raises that terrace's horizon where the sun was, once enough people agree. It mirrors ADR-0012 except where said here.

1. **Only when the sun was out.** At the moment it receives a shade report, the Worker reads the current direct normal irradiance (DNI) over Badajoz from [Open-Meteo](https://open-meteo.com/) (`current=direct_normal_irradiance`, 15-minute values, at the city centre; no key). The report is stored only when DNI is at least `SHADE_MIN_DNI = 250` W/m²; otherwise it is refused with `400 {error: "not sunny"}`, and with `503 {error: "weather unavailable"}` when Open-Meteo can't be read. The WMO counts sunshine from 120 W/m²; 250 leaves room for the model's error over a ~2 km grid and the 15-minute step. One reading serves the whole city (it is small), cached by the Worker for 15 minutes. The owner's own shade reports pass the same check.
2. **What a shade report says.** Shade seen with the sun at azimuth A and altitude H means something at least H high blocks the sky near A. A correction raises (floors) the horizon bins within `SHADE_SPREAD_DEGREES = 2` of A (5 bins) to H, rounded up to tenths of a degree, in the season the report was made in. The spread is narrower than a sun report's ±5°: a wrong floor takes sun away, so it claims only the minutes around the report. There is no margin: an obstacle at least H high also blocks every lower sun, so the floor holds as the sun's path drops, without claiming sky nobody saw.
3. **Consensus.** As sun reports: `SUN_THRESHOLD = 3` distinct networks within the spread of a bin, in that season, each counted once at its highest altitude there; the floor is the 3rd-highest, the level at least 3 networks support. Accepted reports (and the owner's own, stored accepted) are served confirmed; one is enough, at the highest accepted altitude.
4. **Caps win.** Where a bin has both, the app takes `min(max(model, floor), cap)`: a sun report is unambiguous, a shade report could still be a passing cloud the weather data missed.
5. **Served beside the caps.** `GET /v1/sun` answers `{corrections, shade}`: `shade` lists floor runs in the same shape as `corrections` (`altitude` is the floor). Older clients read only `corrections`, so they never mistake a floor for a cap. The app has no approximate shade, so shade from a floor shows as plain shade, confirmed or not; the owner's Inbox is the backstop.
6. **The owner reviews**, in the same Inbox Sun filter, each entry marked sun or shade. Accept and reject work as for sun reports; a rejected shade slice is remembered in its own table (`shade_rejections`), so it blocks shade consensus there and never sun.
7. **In the dataset.** Accepted shade reports go into `pipeline/data/sun_corrections.csv` with `kind = shade`, and the build writes them as each terrace's `shade_corrections`, applied as confirmed floors with or without the API.

The product decision "No weather" stands for what the app shows: no clouds, forecasts or weather data reach visitors. Weather is used only on the server, to decide whether a shade report can count.

## Alternatives considered

- **Shade reports from the owner only.** Simpler and needs no weather, but the owner can't sit at 700 terraces. Kept as a fallback if Open-Meteo goes away.
- **Cloud cover instead of DNI.** Cloud cover says how much of the sky is covered, not whether the sun's disc is; thin high cloud reads as covered while the sun still casts shadows. DNI measures exactly that.
- **AEMET OpenData.** Official, but needs an API key and gives hourly observations at a few stations; Open-Meteo's model output is every 15 minutes and keyless.
- **A margin or ±5° like sun reports.** Rejected: both would take sun away from sky nobody saw in shade.

## Consequences

- The Worker makes one outbound call to `api.open-meteo.com` at most every 15 minutes, only when a shade report arrives. It sends a fixed position and nothing about the visitor. README.md's Privacy section lists it, and the API credits Open-Meteo (CC BY 4.0).
- One additive migration: `kind` on `sun_reports` (default `sun`) and the `shade_rejections` table.
- `terraces.json` gains an optional `shade_corrections` list; `sun_corrections.csv` gains a `kind` column (missing means `sun`).
- If Open-Meteo stops answering, shade reports are refused and nothing else changes.

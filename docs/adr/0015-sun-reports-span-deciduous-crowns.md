# ADR-0015: A sun report corrects the whole deciduous crown it contradicts

- Status: accepted (2026-11-27)
- Date: 2026-11-27
- Issue: #535
- Amends: [ADR-0012](0012-sun-reports.md) (decision 3, "A report corrects the horizon, not a time slot")

## Context

A sun report caps the horizon over the bins within 5° of the sun's azimuth (ADR-0012): about 40 minutes of the sun's path that day. That is right for a building, whose edge the model has well. A deciduous tree crown is different: the LiDAR flew in 2018–19, crowns are pruned or grow, and even in leaf they let light through. When visitors see sun through one part of a crown the model calls solid, the crown is very likely thinner across its whole width.

Floco Original Coffee is the case that raised it: its leaf-on horizon is a flat 77.8° crown across the south, so the app shows no sun in late November, while its leaf-off horizon gives about 4 hours (09:55–13:55 on 27 November). One report would have fixed 40 minutes of that.

## Decision

In the leaf-on season, a sun cap that lowers the horizon in a bin where the leaf-off model has a deciduous crown also applies across the whole crown around it:

1. **A crown bin** is one where the leaf-off twin of the horizon that answers (`horizon_winter` for the single horizon, `horizon_low_winter` for the envelope) is at least `CROWN_MIN_DROP = 1°` lower than it. Absent twins mean no crowns.
2. **The span** is every crown bin connected, without a gap, to a bin where the cap is below the model. In each span bin the horizon becomes at most the leaf-off twin there: the crown counts as bare across its width, and never lower than the model without leaves.
3. The extension inherits the cap's `confirmed`: from visitors it is approximate ("~"); from the owner or an accepted report, confirmed.
4. **Unchanged:** leaf-off caps (the crowns are already bare), buildings and evergreens (not crown bins), and shade floors (ADR-0014; a wrong floor takes sun away, so floors stay narrow).

It is applied in the app, where both the API's caps and the dataset's `sun_corrections` are applied (`correctHorizon` in `web/src/sun/corrections.ts`). The API, the build and `terraces.json` stay as they are: the crown bins come from the two horizons the data already carries.

## Alternatives considered

- **A per-terrace crown mask in `terraces.json`** from the pipeline's tree raster. More exact (it could tell two touching crowns apart), but a new field and a rebuild for what the two horizons already tell.
- **Lowering only to the cap's altitude** across the span. The report says nothing about the rest of the crown's height; the leaf-off horizon is the model's own estimate of the sky without leaves.
- **Doing it in the API and the build.** Two more copies of the rule; the app is where caps meet the horizons anyway.

## Consequences

- A single report under a deciduous crown can add hours of sun, not minutes. The 3-network consensus, the "~" and the owner's review still gate visitor reports.
- Two touching crowns read as one span. Accepted: both are deciduous, and the owner can reject a report that spreads too far.

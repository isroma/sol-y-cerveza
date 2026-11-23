# ADR-0004: Junta register for venues, venue websites as terrace evidence

- Status: accepted
- Date: 2026-11-24
- Context issues: #45 (Junta register), terrace sourcing (#3)

## Context

After ADR-0003 the app lists OSM plus Overture venues. The Junta de Extremadura's register of restaurants and bars ("Establecimientos de restauración", CC BY 4.0) is the only official venue list:
- 1,100 rows in the municipality, with names, kinds, opening dates and addresses;
- no coordinates and no terrace field;
- rows stay until the owner reports a closure, so some are long closed.

Matching it against our 613 venues confirmed 212 of them and left about 550 rows unmatched. Those are closed venues, venues registered under another name, or venues missing from OSM and Overture.

No open source says which venues have a terrace (see `docs/research/data-sources.md`). However, many venues say so on their own website, and a terrace's existence is a fact, not a protected work.

## Decision

1. **Junta register** (`solycerveza.junta`):
   - Every city row with a street number is geocoded with CartoCiudad (IGN/CNIG, CC BY 4.0), restricted to the municipality. Only exact street-number matches are kept, and results are cached in `.cache/`.
   - A row that matches an existing venue (same rules as the Overture merge) only confirms it.
   - An unmatched row becomes a venue (`junta:<hash>`, sources `["junta"]`) only if it opened in **2010 or later**, since old unmatched rows are the likeliest to have closed.
   - Attribution, shown in the app and so in Spanish: "Registro de restauración de la Junta de Extremadura (CC BY 4.0), geocodificado con CartoCiudad (CC BY 4.0 ign.es)".
2. **Venue websites as terrace evidence:**
   - A curated terrace row may cite the venue's own website when it explicitly says the venue has a terrace (for example "nuestra terraza", "our terrace", or a booking form with a "Terraza" option). The URL and the check date go in `notes`.
   - Sites are fetched politely: one request per homepage, respecting robots.txt, with a descriptive User-Agent.
   - Only the fact is recorded, never text.
   - Without a visible terrace, the position is the open ground nearest the venue point, checked on the orthophoto. It stays unverified, and the app says so.
3. Still excluded: Google Maps and other services whose terms forbid scraping or storing their data (ADR-0002), whoever runs the scraper.

## Consequences

- More venues and more terraces, each with a recorded source.
- Junta-only venues can be closed or slightly misnamed: the register's names are official names, written in capitals, and the pipeline converts them to title case. Curators fix these through OSM, which wins every merge.
- Website-based terrace positions are rough. On-site checks, or the Ayuntamiento's register once requested, should replace them.

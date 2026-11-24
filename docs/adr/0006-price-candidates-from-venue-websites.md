# ADR-0006: Price candidates from venues' own websites

- Status: accepted
- Date: 2026-11-23
- Issue: #174

## Context

The app shows a caña price and tercio prices by brand per venue (ADR-0005), and there are none yet: the owner seeds them by hand in the admin. Platforms that do list prices (Google, TheFork, delivery apps, social networks) are ruled out: their terms forbid scraping and storing their data (CLAUDE.md, "Data and licensing").

A venue's own website is different. The venue publishes it to tell the public its prices, and a price is a fact. About 141 venues have their own site in OSM or Overture. A probe on 2026-11-23 loaded 88 of them and found no beer prices in the HTML (ADR-0005), and many Spanish bars publish their carta as a PDF or a photo. So the yield will be small. Reading the sites by hand, though, is slow, and they change.

## Decision

`python -m solycerveza.price_candidates` reads venues' own websites and writes **candidates** to `pipeline/data/price_candidates.csv`. The owner approves every price.

1. **Own websites only.**
   - URLs come from OSM (`website`, `contact:website`, `url`) and Overture (`websites`), for venues the build lists.
   - An explicit host denylist drops social networks, link pages, search, maps, review sites, and booking and delivery platforms (`DENIED_HOSTS` in `solycerveza.websites`).
   - Links and redirects that leave the venue's site are not followed.
2. **Polite fetching.**
   - Requests carry the pipeline's descriptive User-Agent.
   - robots.txt is honoured, including Crawl-delay (up to 30 s). A robots.txt that fails or answers 5xx means "keep out".
   - One request at a time, with at least 2 s between requests to one host.
   - Each request has a timeout and stops at 1 MB.
   - Per site: the home page, then up to four same-site pages whose link looks like a menu ("carta", "menú", "bebidas", "precios").
   - HTML only. PDF and image menus are never downloaded: their links are listed as leads (`.cache/menu_leads.csv`) for the owner to read by hand.
   - Raw answers are cached in `pipeline/.cache/websites/` (gitignored), so re-running the extraction needs no network. Network failures and 5xx answers are not cached, so a site that was briefly down is kept out for that run only, and a cached robots.txt is fetched again after 30 days.
3. **Precision over recall.**
   - A price is kept only when a short text segment names exactly one item (a caña, or a tercio of one known brand) and states exactly one price, between 0,50 € and 15,00 €.
   - Other sizes, drinks and variants (dobles, jarras, quintos, botellines, wine, alcohol-free) are dropped, and so is food that shares a word ("caña de lomo", "tercio de ibérico").
4. **Audit trail.** Each candidate keeps its source URL, the fetch date and the text snippet it came from (at most 160 characters), so the owner can check it against the page.
5. **The owner approves every price.**
   - The build never reads `price_candidates.csv`.
   - In the dev-only admin, the owner accepts a candidate, which copies it into `venue_prices.csv` with `seen` set to the fetch date, or dismisses it.
   - Either way the row's `status` keeps the decision, and a later run keeps the status of the same venue, item, brand, price and page.
6. Still excluded: Google Maps, TripAdvisor, TheFork, delivery apps and social networks, whoever runs the scraper (ADR-0002, ADR-0005).

## Consequences

- Prices from websites reach the app only through the owner's review, and only as the price itself (integer cents), never as copied text.
- `price_candidates.csv` is a local work list. The repository holds only its header. Its snippets quote third-party pages for audit, so rows are not meant to be committed, and Publish does not ship it.
- Expect few candidates: most bar sites have no drinks prices in HTML. The PDF leads are the larger pool, and reading them (or photos) is future work.
- A site that changes its prices produces a new pending candidate. The old price stays in `venue_prices.csv` until the owner accepts the new one.

# Sol y Cerveza: agent guide

Web, iOS and Android app that shows which bar and restaurant terraces in Badajoz get sun or shade today, at a chosen time. Second iteration: median price of a standard beer per venue. All changes arrive as agent-authored PRs, gated by CI and auto-merged when green.

## Architecture (see `docs/adr/0001-architecture.md`)

- `pipeline/` (Python 3.14, uv): runs offline. Builds the terrace dataset and, for each terrace, a 360° horizon profile from a LiDAR surface model. Output goes to `web/public/data/terraces.json`, which follows [`docs/data-contract.md`](docs/data-contract.md). `python -m solycerveza.build` regenerates it. It lists every named venue from OSM, Overture ([ADR-0003](docs/adr/0003-venue-base-osm-plus-overture.md)) and recent Junta register entries ([ADR-0004](docs/adr/0004-junta-register-and-website-evidence.md)); terraces come only from OSM (`outdoor_seating=yes` on a venue, or a `leisure=outdoor_seating` point within 40 m, which then sets the terrace position) and `pipeline/data/curated_terraces.csv`, which wins. Wrong Overture/Junta venues are dropped via `pipeline/data/venue_corrections.csv`.
- Admin (dev only): `cd web && npm run admin` opens `admin.html`, a flat map to mark each venue as terrace / no terrace / not a venue, drag venues to their real position, pin terraces and add venues no source lists (`review:<slug>` ids). It writes `pipeline/data/venue_review.csv` through a Vite dev-server endpoint (`web/reviewServer.ts`); the next build applies it on top of everything else. Its Publish button (`web/publish.ts`) rebuilds the data in a temporary worktree of `origin/main`, commits the CSV and `terraces.json` and pushes a `data/venue-review-*` branch (or adds to the one whose PR is still open). It uses git only, because the owner's network can't reach api.github.com: the `Publish review` workflow opens the PR and enables auto-merge with the `PUBLISH_TOKEN` secret, a fine-grained token of the owner (this repo only; Contents and Pull requests read/write). That token is needed because PRs opened with `GITHUB_TOKEN` trigger no CI or deploy. Its venue panel also takes beer prices (a caña, and tercios by brand) into `pipeline/data/venue_prices.csv`, which the build attaches to each record as `prices` (integer cents). It is never part of the built site.
- OSM write-back (dev only): `cd pipeline && uv run python -m solycerveza.osm_export [--add <venue_id>]` turns the admin's reviews into `pipeline/.cache/osm-review.osm`, holding only what OSM still lacks (`outdoor_seating`, corrected node positions, new `leisure=outdoor_seating` nodes). The owner checks it in JOSM and uploads it under their own OSM account; nothing uploads automatically. Venues from Overture, the Junta or `review:` go in only with `--add`, after a survey, because those licences don't allow copying into OSM.
- `api/` (Cloudflare Worker + D1, see [ADR-0005](docs/adr/0005-price-suggestions.md)): the only server part. Visitors suggest beer prices (Turnstile-verified, one vote per hashed IP); prices 5 people agree on are served to the app, the rest wait in the admin's review queue (its Suggestions button; the dev server proxies it with `PRICES_ADMIN_TOKEN` from `web/.env.local`). The app shows prices on the venue card (`web/src/prices/`), approximate ones with "~", and a suggest form when `VITE_PRICES_API` and `VITE_TURNSTILE_SITE_KEY` are set at build time (repo variables `PRICES_API` and `TURNSTILE_SITE_KEY`). Quality gate: `cd api && npm ci && npm run check`.
- `web/` (Vite, React, TypeScript, MapLibre GL JS): a static client. It computes the sun position for today at the chosen time and compares it with each terrace's horizon. There is no backend.
- Mobile: Capacitor wraps `web/` (`web/ios`, `web/android`). **Paused**: don't work on mobile unless asked; the Mobile workflow only runs manually.
- Hosting: GitHub Pages, deployed on every push to `main`.

## Product decisions (owner, 2026-11-23)

Settled; don't propose or build these again unless the owner asks:

- **Today only.** The app shows today, at any time of day. No date or day picker, and no date in the URL.
- **No weather.** "Sun" means the sun is up and nothing blocks it. No clouds, forecasts or weather data.

## Workflow (every change)

1. Start from a GitHub issue. If none exists, create one. If requirements are unclear, ask on the issue instead of guessing.
2. Branch from an up-to-date `main`, named `<type>/<issue>-<short-name>` (e.g. `feat/6-sun-shade-markers`).
3. Keep PRs small, with one logical change each. The PR title is a Conventional Commit, `type(scope): description` (≤72 chars), because it becomes the squash commit on `main`.
   - Types: feat, fix, test, refactor, chore, docs, ci, style, perf. Research issues land as `docs(...)`.
   - Scopes: web, pipeline, mobile, data, ci.
4. Fill in the PR template and include `Closes #<issue>`. Tick only the checks you actually ran.
5. Run the quality gates below before pushing.
6. `main` is protected:
   - A PR is required, and `ci-ok` and `pr-title` must pass.
   - All conversations must be resolved. The branch does not need to be up to date; CI on `main` catches combined breakage.
   - Squash merge only.
   - Never push to `main`, never force-push a shared branch, never use `--no-verify`.
7. Once the PR is ready, enable auto-merge: `gh pr merge <n> --auto --squash`. GitHub merges it when the required checks pass. Never use `--admin`. If CI fails, fix it on the branch.

## Quality gates

- web: `cd web && npm ci && npm run check` (prettier, oxlint, vitest, tsc, vite build)
- web e2e: `cd web && npm run e2e` (Playwright smoke tests in `web/e2e/` on a real map in Chromium, phone and desktop; stubbed basemap and data, no network). Not part of `npm run check`; CI runs it as the `e2e` job. Run it when a change touches the map, the layout or the venue card. Selectors are Spanish roles and labels; it uses the dev-only `window.__map`.
- pipeline: `cd pipeline && uv sync && uv run ruff format --check . && uv run ruff check . && uv run mypy && uv run pytest`

## Conventions

### Language

- Repo text is in English: code, comments, docs, commit messages, PRs and issues.
- The app UI is in Spanish (i18n later). That covers UI strings, the `attribution` lines in `terraces.json` and tests that assert them.
- The name stays "Sol y Cerveza". Proper nouns, official names, legal citations and licence attribution wording stay in their original language; explain them in English where useful.

### Design (`web/`)

- Follow [`docs/design/README.md`](docs/design/README.md) for colours, type, components, copy and map behaviour. Use its tokens; don't invent new colours. Update the standards in the same PR when the look changes.
- Desktop and phone move together. Every web UI change covers both widths (desktop ≥ 900 px, phone below) in the same PR: shared map behaviour works on both, and layout differences are deliberate and written down in the design standards (§5 Phones). Check both widths before pushing.

### TypeScript (`web/`)

- `strict` and `noUncheckedIndexedAccess` are on. No `any`, and avoid `as`.
- Validate external data (JSON files, APIs) with zod at the boundary.
- Use named exports. Tests sit next to the code as `*.test.ts(x)`.
- Mock at module boundaries. MapLibre needs WebGL, so mock the map component in jsdom tests.
- No `console.log` in committed code.

### Python (`pipeline/`)

- Type hints everywhere (mypy strict) and absolute imports (`from solycerveza.geo import BoundingBox`).
- No bare `except` and no mutable default arguments.
- Prefer Polars or DuckDB over pandas. Use shapely and rasterio for geometry and rasters.
- Make network calls only in fetch stages, and cache raw downloads in `pipeline/.cache/` (gitignored). Tests use fixtures, never live APIs.
- Keep output deterministic (stable ordering, fixed rounding) so data diffs are reviewable.
- Public Overpass instances often return 502/504: retry with backoff and send a descriptive User-Agent.

## Data and licensing

- OSM data is ODbL. Keep "© OpenStreetMap contributors" visible in the app. Derived data that contains OSM data stays ODbL.
- IGN/CNIG (PNOA LiDAR) and Catastro data require attribution: credit them in the app and in the README.
- Do not use sources whose terms forbid storing or redistributing their data (e.g. Google Places) in the public dataset.
- Never commit secrets, rasters or raw downloads.

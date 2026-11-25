# Sol y Cerveza: agent guide

Web app (with iOS and Android shells, paused) that shows which bar and restaurant terraces in Badajoz get sun or shade today, at a chosen time. Second iteration: beer prices per venue, a caña and tercios by brand, either confirmed (owner or curated) or a visitor consensus shown with "~". All changes arrive as agent-authored PRs, gated by CI and auto-merged when green.

## Architecture (see `docs/adr/0001-architecture.md`)

One short bullet per part; the linked docs hold the detail.

- `pipeline/` (Python 3.14, uv): runs offline. `python -m solycerveza.build` writes `web/public/data/terraces.json` ([`docs/data-contract.md`](docs/data-contract.md)): every named venue from OSM, Overture ([ADR-0003](docs/adr/0003-venue-base-osm-plus-overture.md)) and recent Junta register entries ([ADR-0004](docs/adr/0004-junta-register-and-website-evidence.md)), and for each terrace a 360° horizon profile from a LiDAR surface model. Terraces come only from OSM and `pipeline/data/curated_terraces.csv`, which wins; `venue_corrections.csv` drops wrong Overture/Junta venues; the admin's `venue_review.csv` is applied last; `venue_prices.csv` becomes each record's `prices`. [docs/pipeline.md](docs/pipeline.md).
- Admin (dev only): `cd web && npm run admin` opens `admin.html`, a flat map to decide venues (terrace / no terrace / not a venue), move them, pin terraces, add `review:<slug>` venues, enter prices and work through the Suggestions, Reports and machine-proposal queues. It writes `pipeline/data/` through dev-server endpoints (`web/plugins/admin/reviewServer.ts`), and **Publish** (`web/plugins/admin/publish.ts`) ships them. [docs/admin.md](docs/admin.md) ("Fixing a terrace" has the routine).
- OSM write-back (dev only): `cd pipeline && uv run python -m solycerveza.osm_export [--add <venue_id>]` writes `pipeline/.cache/osm-review.osm` for the owner to check in JOSM. [docs/pipeline.md](docs/pipeline.md#osm-write-back).
- Price candidates (dev only): `cd pipeline && uv run python -m solycerveza.price_candidates` reads venues' own websites into `pipeline/data/price_candidates.csv`. [docs/pipeline.md](docs/pipeline.md#prices-from-venue-websites), [ADR-0006](docs/adr/0006-price-candidates-from-venue-websites.md).
- Venue proposals (dev only): `cd pipeline && uv run python -m solycerveza.proposals [--yes | --limit N]` writes `pipeline/data/venue_proposals.csv` for unreviewed venues; `--evaluate` runs the trial first, and a kind is trusted only above the 90 %-precision threshold the trial finds. [docs/pipeline.md](docs/pipeline.md#machine-proposals-for-unreviewed-venues), [ADR-0008](docs/adr/0008-machine-venue-proposals.md).
- `api/` (Cloudflare Worker + D1): the only server part. Visitors suggest prices and report venues (Turnstile, hashed voters, caps); prices 5 networks agree on are served to the app; owner mode (`#owner=<token>`, `/v1/owner/*`) saves the owner's prices from the phone. [api/README.md](api/README.md), [ADR-0005](docs/adr/0005-price-suggestions.md), [ADR-0009](docs/adr/0009-terrace-reports.md), [ADR-0010](docs/adr/0010-one-change-request.md).
- `web/` (Vite, React, TypeScript, MapLibre GL JS): a static client. It computes the sun position for today at the chosen time and compares it with each terrace's horizon (from 1 Dec to 15 Mar the leaf-off `horizon_winter` when the data has one, [ADR-0007](docs/adr/0007-seasonal-trees.md)). It shows prices on the venue card (`web/src/prices/`, "~" for visitor consensus) and, when built with `VITE_PRICES_API` and `VITE_TURNSTILE_SITE_KEY`, the card's back "Sugerir un cambio" (price, move and/or closed in one `POST /v1/changes` behind one Turnstile check, `web/src/reports/SuggestChange.tsx`) and "¿Falta un bar? Añádelo" (an `add` report, `web/src/reports/ReportPicker.tsx`); no app UI sends the terrace yes/no or terrace-pin reports yet (#210). Its only calls to our own server are to `api/`; it also loads OpenFreeMap basemap tiles and Cloudflare Turnstile. The built site registers a service worker: [docs/operations.md](docs/operations.md#offline-and-the-service-worker).
- Mobile: Capacitor wraps `web/` (`web/ios`, `web/android`). **Paused**: don't work on mobile unless asked; the Mobile workflow only runs manually. [docs/mobile.md](docs/mobile.md).
- Hosting: GitHub Pages; CI deploys `main` after `ci-ok` passes, and the Worker the same way once `DEPLOY_API` is set. [docs/operations.md](docs/operations.md).

### Invariants

Don't break these:

- The build never reads `pipeline/data/price_candidates.csv` or `pipeline/data/venue_proposals.csv`. They are candidates and proposals, not data: the owner accepts each one in the admin, which writes `venue_prices.csv` or `venue_review.csv`.
- Visitor price suggestions and venue reports are never applied automatically. Reports, and suggestions without consensus, wait in the admin's queues; accepting one writes a review or price row that ships with Publish.
- Nothing uploads to OSM automatically: the owner checks `osm-review.osm` in JOSM and uploads it under their own account. Venues from Overture, the Junta or `review:` go to OSM only with `--add`, after a survey, because those licences don't allow copying into OSM.
- The admin (`admin.html`, `web/plugins/admin/reviewServer.ts`, `web/plugins/admin/publish.ts`, `web/plugins/admin/pricePhotoServer.ts`) is dev only and never part of the built site.
- Publish may change only `pipeline/data/venue_review.csv`, `pipeline/data/venue_prices.csv` and `web/public/data/terraces.json`; the `Publish review` workflow refuses a `data/venue-review-*` branch that changes anything else. It uses git only (the owner's network can't reach api.github.com); `Publish review PR` (`publish-review-pr.yml`, `workflow_run`, so always main's copy) opens the PR with the `PUBLISH_TOKEN` secret, kept in the `publish` environment, which only `main` may use, because PRs opened with `GITHUB_TOKEN` trigger no CI or deploy. Never use `PUBLISH_TOKEN` in a workflow a branch push can run.
- Mobile is paused (above).

## Product decisions (owner, 2026-11-23)

Settled; don't propose or build these again unless the owner asks:

- **Today only.** The app shows today, at any time of day. No date or day picker, and no date in the URL.
- **No weather.** "Sun" means the sun is up and nothing blocks it. No clouds, forecasts or weather data.

Parked: not now. They may come back later, but don't propose or start them unless the owner asks:

- **Accessibility pass** (keyboard path through the map, focus management, contrast at night).
- **More cities.** Badajoz only.
- **Native mobile apps** (see Mobile above).

## Workflow (every change)

1. Start from a GitHub issue. If none exists, create one. If requirements are unclear, ask on the issue instead of guessing.
2. Branch from an up-to-date `main`, named `<type>/<issue>-<short-name>` (e.g. `feat/6-sun-shade-markers`).
3. Keep PRs small, with one logical change each. The PR title is a Conventional Commit, `type(scope): description` (≤72 chars), because it becomes the squash commit on `main`.
   - Types: feat, fix, test, refactor, chore, docs, ci, style, perf. Research issues land as `docs(...)`.
   - Scopes: web, pipeline, mobile, data, ci.
4. Fill in the PR template and include `Closes #<issue>`. Tick only the checks you actually ran. A PR that changes how the app looks carries before/after screenshots at desktop and phone width (headless, pushed to the `pr-screenshots` branch; see CONTRIBUTING.md).
5. Run the quality gates below before pushing.
6. `main` is protected:
   - A PR is required, and `ci-ok` and `pr-title` must pass.
   - CodeQL code scanning must pass too: a new alert of high severity or above blocks the merge. Fix the code it points at; don't dismiss the alert. It scans the workflows, JavaScript/TypeScript and Python (Swift and Java/Kotlin are off while mobile is paused).
   - All conversations must be resolved. The branch does not need to be up to date; CI on `main` catches combined breakage.
   - Squash merge only.
   - Never push to `main`, never force-push a shared branch, never use `--no-verify`.
7. Once the PR is ready, enable auto-merge: `gh pr merge <n> --auto --squash`. GitHub merges it when the required checks pass. If the checks have already passed, auto-merge can't be enabled: squash-merge the PR directly. Don't hold a PR for the owner to review: the owner (2026-11-24) wants agents to see their PRs through to merge. Never use `--admin`. If CI fails, fix it on the branch.

## Quality gates

- web: `cd web && npm ci && npm run check` (prettier, oxlint, vitest, tsc, vite build)
- web e2e: `cd web && npm run e2e` (Playwright smoke tests in `web/e2e/` on a real map in Chromium, phone and desktop; stubbed basemap and data, no network). Not part of `npm run check`; CI runs it as three `e2e` jobs (phone, desktop, offline), each with `E2E_PROJECTS` set to its projects (`web/playwright.config.ts`), which you can also set locally to run only some. Run it when a change touches the map, the layout or the venue card. Selectors are Spanish roles and labels; it uses the dev-only `window.__map`.
- pipeline: `cd pipeline && uv sync && uv run ruff format --check . && uv run ruff check . && uv run mypy && uv run pytest`
- api: `cd api && npm ci && npm run check`; CI's `api` job also runs `npm run build:dry` and applies every migration to a fresh local D1 (`npx wrangler d1 migrations apply sol-y-cerveza --local`).
- CI skips the jobs a PR can't affect (path filter in `.github/scripts/ci-changes.sh`; a skipped job counts as passed for `ci-ok`), so a docs-only PR runs none of web, e2e, pipeline or api.

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
- Validate external data (JSON files, APIs) with zod at the boundary. Visitor code imports `zod/mini`; classic `zod` is for admin and dev-server code only (`no-restricted-imports` in `web/.oxlintrc.json`).
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

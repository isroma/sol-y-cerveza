# Sol y Cerveza: agent guide

Web, iOS and Android app that shows which bar and restaurant terraces in Badajoz get sun or shade at a chosen date and time. Second iteration: median price of a standard beer per venue. All changes arrive as agent-authored PRs, gated by CI and merged by a human.

## Architecture (see `docs/adr/0001-architecture.md`)

- `pipeline/` (Python 3.14, uv): runs offline. Builds the terrace dataset and, for each terrace, a 360° horizon profile from a LiDAR surface model. Output goes to `data/terraces.json` (contract: `docs/data-contract.md`, created in #5).
- `web/` (Vite, React, TypeScript, MapLibre GL JS): a static client. It computes the sun position for any date and time and compares it with each terrace's horizon. There is no backend.
- Mobile: Capacitor wraps `web/` (issue #7).
- Hosting: GitHub Pages, deployed on every push to `main`.

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
   - The branch must be up to date and all conversations resolved.
   - Squash merge only.
   - Never push to `main`, never force-push a shared branch, never use `--no-verify`.
7. Every merge needs explicit human approval for that PR.

## Quality gates

- web: `cd web && npm ci && npm run check` (prettier, oxlint, vitest, tsc, vite build)
- pipeline: `cd pipeline && uv sync && uv run ruff format --check . && uv run ruff check . && uv run mypy && uv run pytest`

## Conventions

### TypeScript (`web/`)

- `strict` and `noUncheckedIndexedAccess` are on. No `any`, and avoid `as`.
- Validate external data (JSON files, APIs) with zod at the boundary.
- Use named exports. Tests sit next to the code as `*.test.ts(x)`.
- Mock at module boundaries. MapLibre needs WebGL, so mock the map component in jsdom tests.
- No `console.log` in committed code.
- UI text is in Spanish for now (i18n later).

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

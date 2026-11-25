# Development

You need Node 26 and [uv](https://docs.astral.sh/uv/).

```bash
cp web/.env.example web/.env.local     # optional: API, Turnstile and admin keys (see the comments in it)
cd web && npm ci && npm run dev        # web app on http://localhost:5173
cd pipeline && uv sync && uv run pytest
```

To try prices and reports against a local API ([`api/README.md`](../api/README.md#local-development), "Local development"), run the Worker and point the app at it:

```bash
cd api && cp .dev.vars.example .dev.vars && npm ci && npm run migrate:local
npm run dev                            # API on http://localhost:8787
```

Then set `VITE_PRICES_API=http://localhost:8787` in `web/.env.local` (the example's Turnstile site key always passes on localhost) and restart `npm run dev` in `web/`. For the admin's Suggestions and Reports queues set `PRICES_ADMIN_TOKEN` to the `ADMIN_TOKEN` in `api/.dev.vars`; for owner mode, open the app at `#owner=` followed by its `OWNER_TOKEN`.

Browser smoke tests (Playwright, `web/e2e/`) drive the real app and map in Chromium, with a stubbed basemap and a small fixed data set, so they need no network:

```bash
cd web && npx playwright install --with-deps chromium   # once
npm run e2e                                             # every Playwright project
```

The five projects and how to run only some (`E2E_PROJECTS`) are in [operations](operations.md#ci). To rebuild the data, see the [pipeline guide](pipeline.md); to curate venues, terraces and prices, the [admin guide](admin.md).

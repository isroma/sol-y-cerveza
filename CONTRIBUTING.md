# Contributing

Thanks for your interest in Sol y Cerveza. [CLAUDE.md](CLAUDE.md) is the full guide (architecture, workflow, conventions); this page is the short version. How-tos: [the admin](docs/admin.md), [the data pipeline](docs/pipeline.md) and [operations](docs/operations.md).

**A venue or terrace is wrong or missing?** You don't need GitHub: in [the app](https://isroma.github.io/sol-y-cerveza/), open the venue and use **Sugerir un cambio**, or add a missing bar with **¿Falta un bar? Añádelo** in the list. Reports of moved, closed or missing venues change the map only after the owner reviews them.

**Before you write code:**

- Start from an issue. If none exists, open one; if the requirements are unclear, ask on the issue.
- Some product questions are settled (for example no date picker and no weather) and some are parked. See CLAUDE.md, ["Product decisions"](CLAUDE.md#product-decisions-owner-2026-11-23), before proposing a feature.

**Making the change:**

- Branch from an up-to-date `main` as `<type>/<issue>-<short-name>` and keep each PR to one logical change.
- The PR title is a Conventional Commit, `type(scope): description`, at most 72 characters (types and scopes are in CLAUDE.md, "Workflow"). PRs are squash-merged, so the title becomes the commit.
- Run the quality gates before pushing: `scripts/check.sh` (web, api and pipeline) and `scripts/check.sh e2e` for map, layout or venue card changes. They run the same commands as CI.
- Fill in the PR template and tick only the checks you ran. UI changes are checked at desktop and phone width.
- Repo text is in English; the app's UI is in Spanish.

**Data and licensing:** never add data from sources whose terms forbid storing or redistributing it (for example Google Places, Google Maps or Street View). The dataset is ODbL and credits every source; see CLAUDE.md, "Data and licensing", and [docs/adr/](docs/adr/).

Security problems go through [SECURITY.md](SECURITY.md), not public issues.

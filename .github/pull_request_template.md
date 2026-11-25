## Summary

<!-- What changed and why, in a few lines. -->

Closes #

## Screenshots

<!-- UI changes only: before and after, desktop and phone (see CONTRIBUTING.md). Delete this section otherwise. -->

|         | Before | After |
| ------- | ------ | ----- |
| Desktop |        |       |
| Phone   |        |       |

## Verification

<!-- Tick what you actually ran. Leave unticked what you could not check, and say why.
     scripts/check.sh [web|api|pipeline|e2e|all] runs the same commands as the CI jobs. -->

- [ ] `web`: `scripts/check.sh web` (`npm ci`, format, lint, test, build)
- [ ] `web` e2e: `scripts/check.sh e2e` (map, layout or venue card changes; `E2E_PROJECTS` to run only some)
- [ ] `api`: `scripts/check.sh api` (`npm ci`, `npm run check`, `npm run build:dry`, D1 migrations on a fresh local database)
- [ ] `pipeline`: `scripts/check.sh pipeline` (`uv sync --locked`, ruff format and check, mypy, pytest)
- [ ] Checked in the browser (UI changes), at desktop (≥ 900 px) and phone width
- [ ] Docs only: links, commands, paths and names checked against the repo

## Notes for the reviewer

<!-- Risks, follow-ups, screenshots, data/licence implications. -->

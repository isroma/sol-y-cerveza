## Summary

<!-- What changed and why, in a few lines. -->

Closes #

## Verification

<!-- Tick what you actually ran. Leave unticked what you could not check, and say why. -->

- [ ] `web`: `npm run check`
- [ ] `web` e2e: `npm run e2e` (map, layout or venue card changes)
- [ ] `api`: `npm ci && npm run check`
- [ ] `pipeline`: `uv run ruff format --check . && uv run ruff check . && uv run mypy && uv run pytest`
- [ ] Checked in the browser (UI changes), at desktop and phone width

## Notes for the reviewer

<!-- Risks, follow-ups, screenshots, data/licence implications. -->

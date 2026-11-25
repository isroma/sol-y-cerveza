# Security policy

## Reporting a vulnerability

Please report security problems **privately**, through GitHub: on this repository's **Security** tab, choose **Report a vulnerability**. Don't open a public issue, pull request or discussion for them.

There is no bug bounty. The project has a single maintainer, so reports are read and fixed as time allows.

## Scope

- `api/`: the Cloudflare Worker and its D1 database (price suggestions, venue reports, owner mode).
- `.github/workflows/` and `.github/scripts/`: CI, deploys and the publish workflow.
- The site at <https://isroma.github.io/sol-y-cerveza/> and its service worker.

Out of scope: the dev-only admin (`npm run admin`), which is never deployed; the paused mobile projects (`web/ios`, `web/android`); and third-party services (GitHub, Cloudflare, OpenFreeMap) themselves.

Wrong data (a venue, a terrace, a price) is not a security problem: use "Sugerir un cambio" on the venue card instead.

## What to include

- What an attacker can do, and what it needs (a token, a browser, many IP addresses).
- Steps to reproduce: the request or page, and what you saw.
- The commit or date you tested against.
- Anything you think would fix it.

Please don't test against the live API with automated volume, or with other people's data.

#!/usr/bin/env bash
# Which CI jobs (.github/workflows/ci.yml) a change can affect.
#
#   ci-changes.sh < paths     one changed path per line (old and new for renames)
#   ci-changes.sh -z < paths  NUL-separated, as `git diff -z --name-only` writes them
#   ci-changes.sh --all       every job (pushes to main, or no diff available)
#
# Prints web=, e2e=, api= and pipeline= as true or false, for $GITHUB_OUTPUT,
# and each path read to stderr. ci.yml's comment above the changes job repeats
# this mapping; keep the two in step.
# The mapping follows what each job reads, not only its directory:
#
#   .github/**                    all      workflows, actions and this script
#   .nvmrc                        web e2e api   setup-node's node-version-file
#   .editorconfig                 web api       read by prettier
#   .gitignore                    web api pipeline   honoured by prettier, oxlint, ruff
#   web/ios/**, web/android/**    none     Capacitor projects (mobile.yml, manual)
#   web/public/data/terraces.json web e2e pipeline   pipeline/tests/test_build.py
#                                          checks it is the build's own output
#   web/src/data/**               web e2e api   api/src imports geo.ts and
#                                          telemetryEvents.ts from it
#   web/**/*.test.ts(x), web/.prettier*, web/.oxlintrc.json   web only (vitest,
#                                          prettier and oxlint; not the app)
#   web/**                        web e2e
#   api/**                        api
#   pipeline/**                   pipeline (web/ reads pipeline/ only from the
#                                          admin dev server at runtime, never in tests)
#   anything else                 none     README, CLAUDE.md, LICENSE, docs/, .claude/
set -euo pipefail

web=false e2e=false api=false pipeline=false

if [ "${1:-}" = --all ]; then
  web=true e2e=true api=true pipeline=true
else
  delim=$'\n'
  if [ "${1:-}" = -z ]; then delim=''; fi
  while IFS= read -r -d "$delim" path || [ -n "$path" ]; do
    # Prefixed and quoted (a newline too), so no path reads as a workflow command.
    if [ -n "$path" ]; then printf 'changed: %q\n' "$path" >&2; fi
    case "$path" in
      '') ;;
      .github/*) web=true e2e=true api=true pipeline=true ;;
      .nvmrc) web=true e2e=true api=true ;;
      .editorconfig) web=true api=true ;;
      .gitignore) web=true api=true pipeline=true ;;
      web/ios/* | web/android/*) ;;
      web/public/data/terraces.json) web=true e2e=true pipeline=true ;;
      web/src/data/*) web=true e2e=true api=true ;;
      web/*.test.ts | web/*.test.tsx | web/.prettierrc* | web/.prettierignore | web/.oxlintrc.json) web=true ;;
      web/*) web=true e2e=true ;;
      api/*) api=true ;;
      pipeline/*) pipeline=true ;;
      *) ;;
    esac
  done
fi

printf 'web=%s\ne2e=%s\napi=%s\npipeline=%s\n' "$web" "$e2e" "$api" "$pipeline"

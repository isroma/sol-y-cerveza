#!/usr/bin/env bash
# Runs the quality gates the CI jobs in .github/workflows/ci.yml run, with the
# same commands. Keep the two in step.
#
#   scripts/check.sh [web|api|pipeline|e2e|all]...
#
#   web       npm ci, format:check, lint, test, build              (job: web)
#   api       npm ci, format:check, lint, typecheck, test, build:dry,
#             D1 migrations on a fresh local database              (job: api)
#   pipeline  uv sync --locked, ruff format --check, ruff check, mypy, pytest
#                                                                  (job: pipeline)
#   e2e       npm ci, npm run e2e; set E2E_PROJECTS to run only some projects,
#             as each CI e2e job does (web/playwright.config.ts)  (jobs: e2e)
#   all       web, api and pipeline (the default; e2e is slower, run it on its own)
#
# Run from anywhere in the repo. Stops at the first failure.
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

step() {
  printf '\n==> %s\n' "$*"
}

check_web() {
  cd "$root/web"
  step "web: npm ci"
  npm ci
  step "web: format, lint, test, build"
  npm run format:check
  npm run lint
  npm test
  npm run build
}

check_api() {
  cd "$root/api"
  step "api: npm ci"
  npm ci
  step "api: format, lint, typecheck, test, build:dry"
  npm run format:check
  npm run lint
  npm run typecheck
  npm test
  npm run build:dry
  # CI applies every migration to a fresh local D1. A throwaway directory does
  # the same here and leaves the local database of `wrangler dev` alone.
  step "api: D1 migrations on a fresh local database"
  local d1
  d1=$(mktemp -d)
  trap 'rm -rf "$d1"' RETURN
  CI=true WRANGLER_SEND_METRICS=false \
    npx wrangler d1 migrations apply sol-y-cerveza --local --persist-to "$d1"
}

check_pipeline() {
  cd "$root/pipeline"
  step "pipeline: uv sync --locked"
  uv sync --locked
  step "pipeline: ruff format, ruff check, mypy, pytest"
  uv run ruff format --check .
  uv run ruff check .
  uv run mypy
  uv run pytest
}

check_e2e() {
  cd "$root/web"
  step "e2e: npm ci"
  npm ci
  step "e2e: npm run e2e${E2E_PROJECTS:+ (E2E_PROJECTS=$E2E_PROJECTS)}"
  npm run e2e
}

usage() {
  echo "usage: scripts/check.sh [web|api|pipeline|e2e|all]..." >&2
  exit 2
}

if [ "$#" -eq 0 ]; then set -- all; fi
for target in "$@"; do
  case "$target" in
    web | api | pipeline | e2e) ;;
    all) ;;
    -h | --help) usage ;;
    *)
      echo "check.sh: unknown target '$target'" >&2
      usage
      ;;
  esac
done

for target in "$@"; do
  start=$SECONDS
  case "$target" in
    all)
      (check_web)
      (check_api)
      (check_pipeline)
      ;;
    *) ("check_$target") ;;
  esac
  printf '\n==> %s passed in %ss\n' "$target" "$((SECONDS - start))"
done

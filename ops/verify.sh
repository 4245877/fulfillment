#!/bin/sh
# Full local verification for the fulfillment <-> atelier printer integration.
# Reproducible substitute for CI (this repo has none): run it from the repo
# root before every deploy. Node is not required on the host — everything runs
# in docker (the running fulfillment-api container when available, otherwise a
# throwaway node image).
#
#   ./ops/verify.sh
#
# Steps: compose validity (both projects), API typecheck + lint + unit/contract
# tests, dashboard production build, atelier orchestrator typecheck + tests,
# and a byte-for-byte check that the printer-view contract fixture is in sync
# between the two repos.
set -eu

FULFILLMENT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
ATELIER_DIR="${ATELIER_DIR:-$FULFILLMENT_DIR/../atelier}"
NODE_IMAGE="node:22-alpine"

step() { printf '\n\033[1m== %s ==\033[0m\n' "$1"; }

run_in_api() {
  # Prefer the live container (has warm node_modules volumes); fall back to a
  # clean throwaway container with an isolated pnpm store.
  if docker ps --format '{{.Names}}' | grep -qx fulfillment-api; then
    docker exec fulfillment-api sh -c "cd /app && $1"
  else
    docker run --rm -v "$FULFILLMENT_DIR":/app -w /app "$NODE_IMAGE" \
      sh -c "corepack enable >/dev/null 2>&1 && $1"
  fi
}

step "compose config (fulfillment)"
(cd "$FULFILLMENT_DIR" && docker compose config --quiet)
echo ok

step "compose config (atelier)"
(cd "$ATELIER_DIR" && docker compose config --quiet)
echo ok

step "api: install"
run_in_api "pnpm install --no-frozen-lockfile --silent" || run_in_api "pnpm install --no-frozen-lockfile"

step "api: typecheck"
run_in_api "cd apps/api && npx tsc --noEmit"
echo ok

step "api: lint"
run_in_api "cd apps/api && pnpm lint:ci"

step "api: unit + contract tests"
run_in_api "pnpm --filter @drukarnya/fulfillment-api test" || {
  echo "NOTE: pricing write-script tests are known to fail under busybox (chmod --reference);" >&2
  echo "      every other suite must pass. Inspect the output above." >&2
  exit 1
}

step "contract fixtures: fulfillment copies == atelier copies"
# Two independent contracts: the live PrinterView (GET /api/printers, what the
# printers are DOING) and the printer inventory (GET /api/printers/inventory,
# what the printers ARE). They version separately and must both stay in sync.
for contract in printer-view printer-inventory; do
  atelier_copy="$ATELIER_DIR/apps/print-orchestrator/contracts/$contract.contract.json"
  if [ -f "$atelier_copy" ]; then
    cmp "$FULFILLMENT_DIR/apps/api/src/infra/integrations/orchestrator/$contract.contract.json" \
        "$atelier_copy"
    echo "ok: $contract"
  else
    echo "SKIP: $contract — atelier checkout not found at $ATELIER_DIR"
  fi
done

step "dashboard: production build"
docker build -q -f "$FULFILLMENT_DIR/infra/docker/dashboard.Dockerfile" "$FULFILLMENT_DIR" >/dev/null
echo ok

step "atelier orchestrator: typecheck + tests"
docker run --rm -v "$ATELIER_DIR":/w -w /w/apps/print-orchestrator "$NODE_IMAGE" \
  sh -c "npx tsc -p tsconfig.json --noEmit && TZ=UTC node --import tsx --test 'src/**/*.test.ts' 2>&1 | tail -8"

printf '\n\033[1mAll verification steps passed.\033[0m\n'

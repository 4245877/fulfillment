#!/bin/sh
# Post-deploy smoke test of the fulfillment <-> atelier printer integration.
# Read-only against the running containers (plus one camera frame, which may
# briefly switch a chamber light on via ensureLight). Run after every deploy:
#
#   ./ops/smoke-print-farm.sh
#
# Optional outage drill (stops atelier-print-orchestrator for ~20s to prove
# fulfillment degrades cleanly, then starts it back). Do NOT run it while a
# print is being tracked — an orchestrator restart drops in-memory print-run
# identity (filament auto-deduction for those runs is skipped):
#
#   ./ops/smoke-print-farm.sh --outage-drill
set -eu

FAILED=0
check() { # check <name> <command...>
  name="$1"; shift
  if "$@" >/dev/null 2>&1; then
    printf 'ok   %s\n' "$name"
  else
    printf 'FAIL %s\n' "$name"
    FAILED=1
  fi
}

in_api() { docker exec fulfillment-api sh -c "$1"; }

echo "== docker topology =="
check "network print-farm exists" docker network inspect print-farm
check "fulfillment-api is attached to print-farm" \
  sh -c 'docker inspect fulfillment-api --format "{{json .NetworkSettings.Networks}}" | grep -q print-farm'
check "orchestrator is attached to print-farm" \
  sh -c 'docker inspect atelier-print-orchestrator --format "{{json .NetworkSettings.Networks}}" | grep -q print-farm'
check "no orphan fulfillment-go2rtc container" \
  sh -c '! docker ps -a --format "{{.Names}}" | grep -qx fulfillment-go2rtc'
check "exactly one go2rtc on the host (atelier's)" \
  sh -c '[ "$(docker ps --format "{{.Names}}" | grep -c go2rtc)" = "1" ]'
check "legacy PRINTERS_CONFIG_JSON is gone from the api container" \
  sh -c '! docker exec fulfillment-api sh -c "env | grep -q ^PRINTERS_CONFIG_JSON="'

echo "== DNS + orchestrator health (from inside fulfillment-api) =="
check "DNS: print-orchestrator resolves" \
  in_api 'wget -q --spider --timeout=5 http://print-orchestrator:3100/health'
check "orchestrator /health" \
  in_api 'wget -qO- --timeout=5 http://print-orchestrator:3100/health | grep -q "\"ok\""'
check "orchestrator /ready" \
  in_api 'wget -qO- --timeout=5 http://print-orchestrator:3100/ready | grep -q "\"ready\":true"'

echo "== printer status contract (live) =="
PRINTERS_JSON="$(in_api 'wget -qO- --timeout=8 http://print-orchestrator:3100/api/printers' || echo '')"
if [ -z "$PRINTERS_JSON" ]; then
  printf 'FAIL live GET /api/printers\n'; FAILED=1
else
  # The JSON travels via the environment: the heredoc already occupies stdin.
  if ! PRINTERS_JSON="$PRINTERS_JSON" python3 <<'EOF'
import json, os
printers = json.loads(os.environ["PRINTERS_JSON"])
assert isinstance(printers, list) and printers, "expected a non-empty printer list"
required = {"id", "name", "status", "online", "stateText", "stateMessage", "updatedAt", "job", "progress"}
forbidden = {"host", "port", "protocol", "apiKey", "serial", "accessCode", "snapshotUrl", "streamUrl", "deviceUi"}
for p in printers:
    missing = required - p.keys()
    assert not missing, f"{p.get('id')}: missing {sorted(missing)}"
    leaked = forbidden & p.keys()
    assert not leaked, f"{p.get('id')}: leaked {sorted(leaked)}"
    assert isinstance(p["online"], bool), f"{p.get('id')}: online must be boolean"
print("ok   live DTO carries the new fields and no connection secrets")
EOF
  then
    printf 'FAIL live DTO contract check\n'; FAILED=1
  fi
fi

echo "== camera snapshot via orchestrator (ensureLight=1) =="
SNAP_OK=0
for ID in $(printf '%s' "$PRINTERS_JSON" | python3 -c 'import json,sys; print(" ".join(p["id"] for p in json.load(sys.stdin)))' 2>/dev/null); do
  in_api 'rm -f /tmp/snap.jpg' || true
  CT="$(in_api "wget -qS -O /tmp/snap.jpg --timeout=15 'http://print-orchestrator:3100/api/printers/$ID/camera.jpg?ensureLight=1' 2>&1 | grep -i 'Content-Type' | head -1" || true)"
  SIZE="$(in_api '[ -f /tmp/snap.jpg ] && wc -c < /tmp/snap.jpg || echo 0' || echo 0)"
  if printf '%s' "$CT" | grep -qi 'image/' && [ "${SIZE:-0}" -gt 1000 ] && [ "${SIZE:-0}" -lt 3000000 ]; then
    printf 'ok   snapshot from %s (%s bytes, image/*)\n' "$ID" "$SIZE"
    SNAP_OK=1
    break
  fi
done
if [ "$SNAP_OK" != "1" ]; then
  printf 'FAIL no printer produced a valid snapshot (offline cameras?)\n'
  FAILED=1
fi

echo "== fulfillment API health + degraded reporting =="
check "fulfillment /health" in_api 'wget -qO- --timeout=5 http://127.0.0.1:8080/health | grep -q true'
check "fulfillment /ready (db)" in_api 'wget -qO- --timeout=5 http://127.0.0.1:8080/ready | grep -q "\"up\""'
check "ops overview reports orchestrator up" \
  in_api 'wget -qO- --timeout=10 http://127.0.0.1:8080/api/ops/overview | grep -q "\"orchestrator\":\"up\""'
check "ops overview exposes printerMonitor diagnostics" \
  in_api 'wget -qO- --timeout=10 http://127.0.0.1:8080/api/ops/overview | grep -q "printerMonitor"'
check "prints overview is available with live stats" \
  in_api 'wget -qO- --timeout=10 http://127.0.0.1:8080/api/prints/overview | grep -q "\"available\":true"'
check "printers status proxy is admin-gated (401 without token)" \
  in_api 'wget -qO- --timeout=5 http://127.0.0.1:8080/api/printers/status 2>&1 | grep -q "401"'
check "printers status proxy answers with the admin token" \
  in_api 'wget -qO- --timeout=10 --header "x-admin-token: $ADMIN_TOKEN" http://127.0.0.1:8080/api/printers/status | grep -q "\"printers\""'

if [ "${1:-}" = "--outage-drill" ]; then
  echo "== outage drill (orchestrator stops for ~20s) =="
  docker stop atelier-print-orchestrator >/dev/null
  sleep 8
  check "shop core still healthy during outage" \
    in_api 'wget -qO- --timeout=5 http://127.0.0.1:8080/health | grep -q true'
  check "prints overview reports unavailable during outage" \
    in_api 'wget -qO- --timeout=15 http://127.0.0.1:8080/api/prints/overview | grep -q "\"available\":false"'
  check "ops overview reports orchestrator down" \
    in_api 'wget -qO- --timeout=15 http://127.0.0.1:8080/api/ops/overview | grep -q "\"orchestrator\":\"down\""'
  docker start atelier-print-orchestrator >/dev/null
  echo "waiting for the orchestrator to become healthy again..."
  for _ in $(seq 1 30); do
    if in_api 'wget -qO- --timeout=3 http://print-orchestrator:3100/ready 2>/dev/null | grep -q "\"ready\":true"'; then break; fi
    sleep 2
  done
  check "orchestrator ready after the drill" \
    in_api 'wget -qO- --timeout=5 http://print-orchestrator:3100/ready | grep -q "\"ready\":true"'
fi

echo
if [ "$FAILED" = "0" ]; then
  echo "SMOKE: all checks passed"
else
  echo "SMOKE: FAILURES above" >&2
  exit 1
fi

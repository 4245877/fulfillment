# Fulfillment API

Fastify service backing the fulfillment dashboard: inventory (filament stock),
orders, shipments, appeals, printer monitoring and Telegram notifications.
State lives in Postgres (`DATABASE_URL`); pending migrations run automatically
on startup (`MIGRATE_ON_START`, on by default).

## Printers (via the atelier print-orchestrator)

This service opens **no direct connections to printers or cameras** — no
Moonraker HTTP, Bambu MQTT, Creality WebSocket or go2rtc. Everything printer-
related goes through the atelier print-orchestrator's HTTP API
(`PRINTER_ORCHESTRATOR_URL`, normally `http://print-orchestrator:3100` over the
shared `print-farm` docker network — create it once with
`./ops/ensure-print-farm-network.sh`; optional
`PRINTER_ORCHESTRATOR_API_TOKEN`, timeout `PRINTER_ORCHESTRATOR_TIMEOUT_MS`).
Идемпотентные GET-чтения ретраятся один раз с коротким jittered-backoff;
health-пробы ходят без ретрая.

- `GET /api/printers/status` (admin-gated, used by the read-only dashboard
  page) proxies the orchestrator's `GET /api/printers` and adds a per-printer
  `stale` flag (orchestrator `updatedAt` older than `PRINTER_STATUS_STALE_MS`,
  default 2 min); 502/503 with a readable `error` when the orchestrator is
  unreachable/not configured. `online: false` = the *device* did not answer a
  healthy orchestrator; 502 = the orchestrator itself is unreachable.
- `GET /api/prints/overview` (Board tiles) assembles live data from the
  orchestrator (`/api/printers` + `/api/queue` + `/api/today`). It reports
  `available: false` with `reason` (`not_configured` /
  `orchestrator_unavailable`) instead of fake zeroes — the Board renders "—".
- The background printer monitor polls statuses, classifies transitions
  (completed / cancelled / paused / error / filament runout) and enqueues
  Telegram notifications into the outbox. Snapshots come from
  `GET /api/printers/:id/camera.jpg?ensureLight=1` (the orchestrator turns the
  chamber light on for night captures).
- `Состояние сервисов` on the Board probes the orchestrator once and derives both
  the `orchestrator` and `printers` rows from that single request;
  `/api/ops/overview` additionally exposes `stats.printerMonitor` (poll
  cadence, cycle duration, consecutive failures, outage flag, per-printer data
  age, enqueue/dedupe counters).

### False/duplicate notification protection

- **Baseline on first observation** — after a (re)start the first poll only
  records state; pre-existing conditions are never (re-)announced.
- **Durable dedupe** — every printer event enters the Telegram outbox with a
  deterministic `dedupe_key` (`printer + kind + job-hash + orchestrator
  updatedAt`); the outbox's unique index collapses the same transition seen
  twice (overlapping cycles, crash between enqueue and baseline update) into
  one row, so one transition can never send two messages.
- **Stale guard** — a status whose orchestrator-side `updatedAt` is older than
  `PRINTER_STATUS_STALE_MS` is never classified and never replaces the fresh
  baseline; when fresh data returns, the real transition (if any) is computed
  against that baseline. A frozen upstream poll can therefore not fabricate
  events.
- **Offline conservatism** — `online: false`, `unknown` and missing responses
  are never read as cancellations/completions; after a reconnect only a real
  fresh transition reports.
- **Outage anti-flapping** — 3 consecutive failed polls raise exactly one
  critical alert (stable message text, deduped in the outbox within
  `NOTIFICATIONS_CRITICAL_DEDUPE_WINDOW_MS` even across a restart); recovery
  is announced once after 2 consecutive successful polls, so an unstable link
  cannot alternate outage/recovery spam.
- **No cycle overlap** — a poll cycle that is still running makes the next
  tick skip (counted in `overlapsSkipped`); cycles longer than the poll
  interval log a warning.
- An orchestrator outage degrades ONLY printer features: orders, inventory,
  shipments, appeals and the rest of the shop keep working; `/health` and
  `/ready` (DB-only) stay green.

### API contract with atelier

The orchestrator's `GET /api/printers` wire shape is pinned as a fixture
(`src/infra/integrations/orchestrator/printer-view.contract.json`, generated
by atelier's `printerView.contract.test.ts`). `contract.test.ts` replays it
through the runtime validator, forbids connection/credential fields (`host`,
`serial`, `accessCode`, …) and — when the sibling `~/apps/atelier` checkout is
present — verifies both copies match byte-for-byte. Regenerate on a deliberate
DTO change: `UPDATE_CONTRACT=1 pnpm test` in atelier, copy the fixture here,
re-run tests. Statuses without the new fields (older orchestrator builds)
still normalize — `online` derives from `status`, `updatedAt: null` is
"unknown age", so mixed-version rolling deploys are safe in both orders.

Printer configuration lives only in atelier
(`apps/print-orchestrator/config/printers.json`, untracked there — it holds
hosts and the Bambu access code); the old local `data/printers.json`,
`PRINTERS_CONFIG_JSON` seed and the dashboard's printer config editor were
removed with the migration.

### Deploy, verification & rollback

Pre-deploy: `./ops/verify.sh` (compose validity for both projects, typecheck,
lint, unit + contract tests, dashboard build, atelier typecheck/tests,
contract-fixture sync). Order for a full printer-stack rollout:

1. `./ops/ensure-print-farm-network.sh` (idempotent; required once per host);
2. atelier: `docker compose build print-orchestrator && docker compose up -d`
   — note an orchestrator restart drops in-memory print-run identity, so
   filament auto-deduction is skipped for prints already running;
3. fulfillment: `docker compose build dashboard && docker compose up -d
   --remove-orphans` (removes the legacy fulfillment-go2rtc orphan; the api
   container joins `print-farm` and drops legacy env);
4. post-deploy: `./ops/smoke-print-farm.sh` (topology, DNS, health, live DTO
   contract, snapshot, degraded reporting, admin gate). Add `--outage-drill`
   to also stop the orchestrator for ~20 s and verify clean degradation — do
   not run the drill while a tracked print is mid-run.

Rollback: both compose stacks run from the working tree, so `git checkout
<previous-commit>` in the affected repo, then re-run step 2 (atelier: rebuild
image) or step 3 (fulfillment: recreate api / rebuild dashboard). The
printers config file is untracked — rollbacks never touch it, and it must
never be committed to restore it. Old fulfillment + new atelier (and the
reverse) interoperate: the client tolerates missing new fields, atelier keeps
old ones.

## Filament inventory

Stock is tracked in grams per `(material, color)` pair, where `color` is a
name (`black`, `white`, …) chosen when the reel is added. Every change is an
append-only movement (`add` / `consume` / `adjust`) with before/after amounts.

### Reel bindings (`printer_filament_state`)

`POST /api/inventory/printer-filament/load` binds a stock to a printer so
printer-originated consumption can be attributed without the caller knowing
stock ids:

```json
{ "printerId": "creality-k2", "material": "PETG", "color": "black" }
```

Multi-slot printers (Bambu AMS) may additionally bind per slot with
`"amsTray": 0..N`; the row without `amsTray` is the printer-level reel and the
fallback for slots that have no binding of their own. `printerId` must match
the id the atelier print-orchestrator uses (`config/printers.json`).

### Consuming — `POST /api/inventory/filament/consume`

Accepts a quantity as `quantityG` (or its alias `grams`, which the
print-orchestrator sends) **or** as `lengthMm` (extruded length, converted to
grams via the resolved material's density; optional `diameterMm`, default
1.75). The stock is resolved in priority order:

1. explicit `material` + `color` that match an existing stock (the dashboard's
   manual flow);
2. the reel loaded on `printerId` — the `(printerId, amsTray)` binding when a
   tray is named, else the printer-level binding. Device material/colour hints
   (Bambu colours are hex, not stock colour names) do **not** pick the stock —
   but a `material` hint that contradicts the loaded reel rejects the call
   instead of deducting the wrong spool.

Consumption never drives stock negative — insufficient stock is a 400 with a
human-readable `error`, as is every other rejection.

**Idempotency:** pass `idempotencyKey` (the orchestrator sends
`<printerId>:<printRunId>[:t<tray>]`). A key already recorded on a movement
returns `{ "duplicate": true }` with the original movement and writes nothing,
so redeliveries and retries are safe. The check runs inside the same
advisory-locked transaction as the write, so concurrent duplicates cannot race.

The atelier print-orchestrator posts here automatically when a print completes
(`FULFILLMENT_API_URL` on its side); see
`apps/print-orchestrator/README.md` → “Filament auto-consume” for what each
printer protocol reports and the retry semantics.

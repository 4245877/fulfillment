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

## Printer configuration (the directory)

Printers are configured in atelier — created, edited, enabled/disabled,
reordered and deleted in its dashboard, stored in its database. This service
holds **no** printer configuration: it reads the fleet from
`GET /api/printers/inventory` and caches it briefly
(`src/modules/printers/directory.ts`).

Two feeds, deliberately separate — they answer different questions:

| | `GET /api/printers/inventory` (config) | `GET /api/printers/status` (state) |
|---|---|---|
| answers | what the printers **are** | what the printers are **doing** |
| disabled printers | present, `enabled: false` | absent |
| never-polled printers | present | absent |
| changes | when an operator edits them | every few seconds |
| fields | model, type, class, protocol, material, nozzle Ø/type, build volume, position, `enabled` | online, status, job, progress, temperatures, staleness |

Neither feed carries a host, port, credential or camera URL.

**Freshness.** `PRINTER_DIRECTORY_TTL_MS` (default 30 s) is how long a cached
fleet answers without an upstream request — and therefore how long an
atelier-side change takes to appear here. No restart, no redeploy, no
"synchronise" button. Concurrent callers share one upstream request, so a burst
on a cold cache cannot stampede atelier.

**Staleness is bounded.** Past `PRINTER_DIRECTORY_MAX_STALE_MS` (default 120 s)
a cached fleet may no longer decide anything: binding a reel fails with
`printer_directory_unavailable` (502) rather than trusting an unconfirmed
snapshot. Display routes still show the last known fleet, flagged `stale: true`
— never silently presented as current.

**The assignment gate.** Binding a reel to a printer decides which stock a
later print deducts from, so both `POST /api/inventory/printer-filament/load`
(operator) and `/sync` (atelier, device-driven) confirm the printer first:

| situation | answer |
|---|---|
| printer not in atelier's fleet (never configured, or deleted) | `400 unknown_printer` |
| printer configured but disabled | `409 printer_disabled` |
| fleet unknown or too stale to trust | `502 printer_directory_unavailable` |
| no orchestrator configured | `503 printer_directory_not_configured` |

Nothing is written in any of those cases. atelier retries a refused `/sync` on
its next poll, so an unconfirmable fleet delays a binding instead of losing it.

`POST /api/inventory/filament/consume` is deliberately **not** gated: a
deduction records filament that was already burnt, and refusing it because the
printer has since been deleted would lose warehouse accuracy, not protect it.

**History survives deletion.** Movements and reel bindings reference
`printer_id` by value and are never rewritten when a printer disappears from
atelier. Each binding also carries a `printer_name` snapshot taken when it was
written (migration `005_printer_filament_printer_name`), so the row stays
readable after the machine is gone; `GET /api/inventory/printer-filament`
annotates each row with `printerKnown` / `printerEnabled` from the live
directory.

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

The configuration feed has its own fixture on the same terms:
`printer-inventory.contract.json`, generated by atelier's
`inventory.contract.test.ts`, replayed here by `inventoryContract.test.ts`
(which also asserts that no wiring or credential field can appear in it).
`ops/verify.sh` compares both fixtures against the atelier checkout.

Printer configuration lives only in atelier (its orchestrator database, edited
in its dashboard; `config/printers.json` survives there solely as a one-time
import seed). The old local `data/printers.json`, the `PRINTERS_CONFIG_JSON`
seed and the dashboard's printer config editor were removed with the earlier
migration, and nothing here has replaced them.

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
fallback for slots that have no binding of their own. `printerId` must be the id
of a printer that exists **and is enabled** in atelier: the request is checked
against the printer directory before anything is written (see the gate table
above), so a typo, a deleted printer or a disabled one is refused rather than
bound.

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

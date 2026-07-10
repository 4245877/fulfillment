# Fulfillment API

Fastify service backing the fulfillment dashboard: inventory (filament stock),
orders, shipments, appeals, printer monitoring and Telegram notifications.
State lives in Postgres (`DATABASE_URL`); pending migrations run automatically
on startup (`MIGRATE_ON_START`, on by default).

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

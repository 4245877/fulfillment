# Shop watchdog

An independent external observer of the **Lite Forest shop** (another server,
`192.168.0.135`). It runs here, on the fulfillment host, so that a dead shop
server cannot silence it.

The shop has its own monitoring (Prometheus → Alertmanager → Telegram), but it
lives on the shop server: if that server, its Prometheus or its Alertmanager
dies, nothing there can say so. This service closes that gap from the outside.

## What it does

| | |
|---|---|
| **Probes the shop** every 30 s through its public entry — the same one a buyer uses | `GET /nginx-healthz`, `GET /api/health`, `GET /api/products?limit=1`, `GET /` |
| **Names what is broken**, not just "down" | see the table below |
| **Is the dead-man switch** for the shop's monitoring | the shop's Alertmanager must `POST /heartbeat` every few minutes; silence is reported |
| **Notifies the owner** through Telegram directly from this host | same bot, chat and "critical errors" topic as the fulfillment API |
| **Can be watched itself** | `GET /metrics` — scraped by the shop's Prometheus; `503` when it is not working |

### Statuses

| Status | What was observed | What it means |
|---|---|---|
| `unreachable` | no HTTP answer from any of the four requests | the server, the network to it or nginx is down |
| `backend_down` | nginx answers, `/api/health` does not | the `api` container is stopped, restarting or hung |
| `not_ready` | `/api/health` is fine, the catalog request fails | database, schema or the published-catalog projection |
| `storefront_down` | API works, `/` is not served | nginx or the static storefront |
| `catalog_empty` | everything answers, the catalog has no products | sale of the whole catalog is closed (rights recompute not finished) or the projection is lost |
| `ok` | all four pass | |

A `200` from the static page alone is never "the shop is fine": the four checks
are classified together.

**What it cannot see, by design:** workers, queues, rights recompute, backups,
disk. Those are the job of the shop's own Prometheus. Whether *that* is alive is
what the heartbeat track is for.

### When a message is sent

- **Outage** — after `DOWN_AFTER` (3) consecutive failed cycles ≈ 90 s. One
  message per incident, with the service name, the kind of failure, the time of
  the first failure, what each check returned and where to look.
- **Change** — if *what* is broken changes and the new picture is itself
  confirmed (e.g. the host came back but the backend did not). Once.
- **Recovery** — after `UP_AFTER` (2) consecutive good cycles. Once, with the
  duration.
- **Reminder** — while an incident stays open, at most once per `REMINDER_MS`
  (1 h; `0` turns reminders off).
- **Monitoring is silent** — no valid heartbeat for `HEARTBEAT_MAX_AGE_MS`
  (15 min). Not sent while the shop host itself is confirmed `unreachable`: that
  outage already explains the silence. A returning heartbeat sends one recovery.

A flapping link (ok, fail, ok, fail…) opens nothing and closes nothing. Every
message has a deterministic key; a key that was queued or delivered is never
queued again.

### Restarts and reboots

State — open incidents, what was already reported, the delivery queue — is one
JSON file in `apps/shop-watchdog/state/`, written atomically. Therefore:

- a restart in the middle of an outage does **not** repeat the alert, and the
  recovery is still announced, with the original start time;
- a message Telegram did not accept stays queued (across restarts) and is
  delivered later, in order — "recovered" never overtakes its own "down";
- after a restart the heartbeat gets a fresh grace period: the watchdog could
  not receive heartbeats while it was down;
- consecutive-failure counters older than a few cycles are dropped on start:
  three failures spread over a night are not "three in a row".

The compose service is `restart: always`: the Docker daemon brings it back after
a host reboot even if it was once stopped by hand. Do not signal it through
`docker kill`.

## Why it is a separate service and not a module of the API

- **No install step.** Plain Node, no `node_modules`, no `apk`/`pnpm` at start.
  The API container installs packages from the network every time it starts; a
  watchdog must come up after a power cut even when this host has no internet.
- **No shared fate.** Its own process, no database, no `depends_on`. A broken or
  restarting API does not stop it; rolling it out never restarts the API.
- **Small enough to read.** ~700 lines, every side effect injected, 47 tests.

It still *uses* fulfillment: this repository, this host, this compose project
and the API's Telegram settings.

## Configuration

Telegram settings come from `apps/api/.env` (the service gets that file as
`env_file` and reads only `TELEGRAM_*` and `SHOP_WATCHDOG_*`):
`TELEGRAM_ENABLED`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`,
`TELEGRAM_TOPIC_CRITICAL_ERRORS_ID`.

Everything else is in the root `.env` — see `.env.example`:

| Variable | Default | |
|---|---|---|
| `SHOP_WATCHDOG_BASE_URL` | — (required) | the shop's public entry, e.g. `http://192.168.0.135` |
| `SHOP_WATCHDOG_HEARTBEAT_TOKEN` | empty = dead-man track off | shared secret of `POST /heartbeat`, ≥ 24 characters |
| `SHOP_WATCHDOG_TELEGRAM_CHAT_ID` / `_THREAD_ID` | empty = the API's chat and its "critical errors" topic | pin the watchdog to a chat and topic of its own; set both — a pinned chat never inherits the API's topic id |
| `SHOP_WATCHDOG_RUNBOOK` | empty | free text appended to messages as "what to do" |
| `SHOP_WATCHDOG_SERVICE_NAME` | `Lite Forest (магазин)` | how the service is named in messages |
| `SHOP_WATCHDOG_INTERVAL_MS` / `_TIMEOUT_MS` | `30000` / `5000` | probe cadence and per-request deadline |
| `SHOP_WATCHDOG_DOWN_AFTER` / `_UP_AFTER` | `3` / `2` | debounce |
| `SHOP_WATCHDOG_EMPTY_CATALOG_AFTER` | `30` (≈ 15 min) | `0` = an empty catalog is a healthy answer |
| `SHOP_WATCHDOG_REMINDER_MS` | `3600000` | `0` = no reminders |
| `SHOP_WATCHDOG_HEARTBEAT_MAX_AGE_MS` | `900000` | reported silence of the shop's monitoring |

An invalid or missing value is a configuration **error**, not a default: the
service stays up, probes nothing, explains why on `/status`, and answers
`/metrics` with `503` — the shop sees its watcher as down instead of trusting a
half-configured one. `TELEGRAM_ENABLED` other than `true` is such an error: a
watchdog that cannot notify is not a watchdog.

## HTTP surface (port 3002 on the host)

| | |
|---|---|
| `GET /health` | liveness (Docker healthcheck) |
| `GET /status` | JSON: status, last checks, incidents, queue — no secrets |
| `GET /metrics` | Prometheus exposition; **`503` with the reason** when the watchdog must not be trusted: configuration error, probe loop stalled, state not persistable, notifications undelivered for 10+ minutes |
| `POST /heartbeat` | `Authorization: Bearer <token>`, body — Alertmanager webhook; counts only a *firing* `Watchdog` alert (`401` / `422` otherwise) |

Nothing here needs or grants access to the shop: the probes are public GETs,
and the shop only *sends* a heartbeat. No database, no SSH key, no admin token.

## Verify, roll out, roll back

```bash
# tests (clean container, read-only mount; also a step of ./ops/verify.sh)
docker run --rm -v "$PWD/apps/shop-watchdog":/app:ro -w /app node:22-alpine \
  node --test 'test/*.test.mjs'

# roll out: creates ONLY this service — api, postgres and dashboard are not touched
docker compose up -d shop-watchdog
curl -s http://127.0.0.1:3002/status          # "ok": true, "shop": {"status": "ok"}
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3002/metrics   # 200

# after changing .env or the code: recreate only this service
docker compose up -d --force-recreate shop-watchdog

# roll back: remove the service; the state directory stays
docker compose rm -sf shop-watchdog
```

The source is bind-mounted read-only, so the running container follows the
working tree: `git checkout <previous>` + `--force-recreate` is a full rollback.

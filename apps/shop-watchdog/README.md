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
| **Notifies the owner** through Telegram directly from this host | its own bot token, chat and topic — `apps/shop-watchdog/.env` |
| **Checks that it can still notify** — without sending anything | asks Telegram every 5 min whether its bot may use the chat; a revoked token or a removed bot makes it report itself as not working |
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
  outage already explains the silence. When the host answers again, the silence
  is counted from that moment: the shop's monitoring was down with its server
  and needs a minute to boot, so "recovered" is not followed by a false
  "monitoring is silent" on every power-on — and monitoring that really did not
  come back is reported once that grace runs out. A returning heartbeat sends
  one recovery.

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
  not receive heartbeats while it was down (the same grace starts when a
  confirmed "server does not answer" ends);
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
- **No shared secrets or settings.** Its own env file. It holds no credential of
  the API (printer orchestrator, atelier), and the API's Telegram settings —
  changed, switched off or broken — do not change where, or whether, an outage
  of the shop is reported.
- **Small enough to read.** ~1300 lines with comments, every side effect injected, 56 tests.

It still *uses* fulfillment: this repository, this host and this compose
project.

## Configuration

Everything — settings and both secrets — is in **one file of its own**,
`apps/shop-watchdog/.env` (ignored by git; `chmod 600`). The compose service
reads nothing from `apps/api/.env` and interpolates nothing from the root
`.env`. Start from `.env.example` in this directory:

| Variable | Default | |
|---|---|---|
| `TELEGRAM_ENABLED` | — (required, `true`) | anything else is a configuration error |
| `TELEGRAM_BOT_TOKEN` | — (required) | the bot that writes; it must be a member of the chat below |
| `SHOP_WATCHDOG_TELEGRAM_CHAT_ID` / `_THREAD_ID` | — (required) | the chat and the topic inside it; set both — a topic id means something only inside its own chat |
| `SHOP_WATCHDOG_BASE_URL` | — (required) | the shop's public entry, e.g. `http://192.168.0.135` |
| `SHOP_WATCHDOG_HEARTBEAT_TOKEN` | empty = dead-man track off | shared secret of `POST /heartbeat`, ≥ 24 characters |
| `SHOP_WATCHDOG_RUNBOOK` | empty | free text appended to messages as "what to do" |
| `SHOP_WATCHDOG_SERVICE_NAME` | `Lite Forest (магазин)` | how the service is named in messages |
| `SHOP_WATCHDOG_INTERVAL_MS` / `_TIMEOUT_MS` | `30000` / `5000` | probe cadence and per-request deadline |
| `SHOP_WATCHDOG_DOWN_AFTER` / `_UP_AFTER` | `3` / `2` | debounce |
| `SHOP_WATCHDOG_EMPTY_CATALOG_AFTER` | `30` (≈ 15 min) | `0` = an empty catalog is a healthy answer |
| `SHOP_WATCHDOG_REMINDER_MS` | `3600000` | `0` = no reminders |
| `SHOP_WATCHDOG_HEARTBEAT_MAX_AGE_MS` | `900000` | reported silence of the shop's monitoring |
| `SHOP_WATCHDOG_CHANNEL_CHECK_MS` | `300000` | how often Telegram is asked whether the bot may still use the chat; `0` = never |

An invalid or missing value is a configuration **error**, not a default: the
service stays up, probes nothing, explains why on `/status`, and answers
`/metrics` with `503` — the shop sees its watcher as down instead of trusting a
half-configured one. `TELEGRAM_ENABLED` other than `true` is such an error: a
watchdog that cannot notify is not a watchdog. A missing `.env` is the same
case: the service starts unconfigured and says so.

(`TELEGRAM_CHAT_ID` and `TELEGRAM_TOPIC_CRITICAL_ERRORS_ID` — the API's names —
are still understood when the `SHOP_WATCHDOG_TELEGRAM_*` pair is absent;
`/status` then shows `chatSource: "api"`.)

### Can it still notify?

A watchdog with a revoked token probes happily and can tell nobody — and
nothing shows it until the first alert has to go out. So the watchdog asks
Telegram itself, without sending a message: `getChat` for the configured chat,
at the first cycle and then every `SHOP_WATCHDOG_CHANNEL_CHECK_MS`.

- Telegram **refuses** (`401` — the token was regenerated in BotFather; `403` /
  `400` — the bot was removed from the chat, or the chat id is wrong): after
  three refusals in a row (about a minute) `/metrics` answers `503
  notifications cannot be delivered: …`, `/status` shows `channel.refused`. The
  shop is still probed; the shop's own Prometheus sees its watcher as down.
- Telegram is **unreachable, busy or rate-limiting**: no verdict — that says
  nothing about the credentials. A message that cannot be delivered is covered
  by the age of the queue (10 minutes → `503`).
- A repaired channel is noticed at the next cycle.

What this cannot check is the **topic**: only a real message proves that it
exists. After changing the destination, send one.

**Rotating the bot token.** A token regenerated in BotFather invalidates the old
one immediately, for every holder. Replace it in `apps/shop-watchdog/.env`,
recreate the service (below) and look at `/status` → `channel`.

## HTTP surface (port 3002 on the host)

| | |
|---|---|
| `GET /health` | liveness (Docker healthcheck) |
| `GET /status` | JSON: status, last checks, incidents, queue, what Telegram last said about the channel — no secrets |
| `GET /metrics` | Prometheus exposition; **`503` with the reason** when the watchdog must not be trusted: configuration error, probe loop stalled, state not persistable, Telegram refuses the bot or the chat, notifications undelivered for 10+ minutes |
| `POST /heartbeat` | `Authorization: Bearer <token>`, body — Alertmanager webhook; counts only a *firing* `Watchdog` alert (`401` / `422` otherwise) |

Nothing here needs or grants access to the shop: the probes are public GETs,
and the shop only *sends* a heartbeat. No database, no SSH key, no admin token.

## Verify, roll out, roll back

```bash
# tests (clean container, read-only mount; also a step of ./ops/verify.sh)
docker run --rm -v "$PWD/apps/shop-watchdog":/app:ro -w /app node:22-alpine \
  node --test 'test/*.test.mjs'

# roll out: creates ONLY this service — api, postgres and dashboard are not touched
# (--no-deps and the service name are the point: a bare `docker compose up -d`
# also recreates every other service whose definition changed since it started)
install -m 600 apps/shop-watchdog/.env.example apps/shop-watchdog/.env   # then fill it in
docker compose up -d --no-deps shop-watchdog
curl -s http://127.0.0.1:3002/status          # "ok": true, "shop": {"status": "ok"}
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3002/metrics   # 200

# after changing apps/shop-watchdog/.env or the code: recreate only this service
docker compose up -d --no-deps --force-recreate shop-watchdog

# roll back: remove the service; the state directory stays
docker compose rm -sf shop-watchdog
```

The source is bind-mounted read-only, so the running container follows the
working tree: `git checkout <previous>` + `--force-recreate` is a full rollback.

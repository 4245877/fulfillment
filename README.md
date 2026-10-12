# Fulfillment service

Заказы, склад филамента, отправления, обращения, отчёты, Telegram-уведомления
и read-only мониторинг 3D-принтеров (через оркестратор `~/apps/atelier`).

## Запуск

```bash
# Один раз на хост: общая сеть с atelier (идемпотентно)
./ops/ensure-print-farm-network.sh

docker compose up -d --build
```

Порты: dashboard `4173`, API `3001`, Postgres `5433`. Переменные — см.
`.env.example` (корень) и `apps/api/.env.example`.

## Проверки

```bash
./ops/verify.sh            # typecheck + lint + тесты + сборки + контракт (перед деплоем)
./ops/smoke-print-farm.sh  # живой smoke интеграции с atelier (после деплоя)
```

Деплой, откат и модель интеграции с принтерами: `apps/api/README.md`
(раздел «Printers…» и «Deploy, verification & rollback»).

## Сторож магазина (shop-watchdog)

Независимый наблюдатель за магазином Lite Forest (другой сервер): сервис `shop-watchdog`, порт `3002`.
Не часть API — свой процесс без зависимостей, свои настройки и секреты в `apps/shop-watchdog/.env`
(образец — `.env.example` рядом). Что делает, как проверить и откатить — `apps/shop-watchdog/README.md`.

```bash
# запуск и обновление — ТОЛЬКО этого сервиса: общий `docker compose up -d` пересоздаёт
# каждый сервис, чьё определение изменилось с его запуска
docker compose up -d --no-deps --force-recreate shop-watchdog
curl -s http://127.0.0.1:3002/status
```

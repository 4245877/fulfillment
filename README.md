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

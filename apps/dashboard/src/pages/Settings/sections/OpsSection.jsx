// apps/dashboard/src/pages/settings/sections/OpsSection.jsx
import React from "react";
import { Card, FieldRow, DangerZone, NumberInput } from "../ui.jsx";

export default function OpsSection({ cfg, patch, doAction }) {
  return (
    <Card
      title="4) Состояние сервисов и действия оператора"
      sub="Пороги деградации + кнопки оператора (с подтверждением)"
    >
      <FieldRow
        label="Пороги деградации"
        hint="% ошибок, p95 latency, тайм-ауты."
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 12,
            maxWidth: 720,
          }}
        >
          <div>
            <div className="text-muted" style={{ fontSize: 12 }}>
              errorRateWarnPct
            </div>
            <NumberInput
              value={cfg.ops.degradation.errorRateWarnPct}
              min={0}
              max={100}
              step={0.1}
              onChange={(v) => patch("ops.degradation.errorRateWarnPct", v)}
            />
          </div>

          <div>
            <div className="text-muted" style={{ fontSize: 12 }}>
              errorRateDangerPct
            </div>
            <NumberInput
              value={cfg.ops.degradation.errorRateDangerPct}
              min={0}
              max={100}
              step={0.1}
              onChange={(v) => patch("ops.degradation.errorRateDangerPct", v)}
            />
          </div>

          <div>
            <div className="text-muted" style={{ fontSize: 12 }}>
              p95LatencyWarnMs
            </div>
            <NumberInput
              value={cfg.ops.degradation.p95LatencyWarnMs}
              min={0}
              max={600000}
              step={50}
              onChange={(v) => patch("ops.degradation.p95LatencyWarnMs", v)}
            />
          </div>

          <div>
            <div className="text-muted" style={{ fontSize: 12 }}>
              p95LatencyDangerMs
            </div>
            <NumberInput
              value={cfg.ops.degradation.p95LatencyDangerMs}
              min={0}
              max={600000}
              step={50}
              onChange={(v) => patch("ops.degradation.p95LatencyDangerMs", v)}
            />
          </div>

          <div>
            <div className="text-muted" style={{ fontSize: 12 }}>
              timeoutWarnPct
            </div>
            <NumberInput
              value={cfg.ops.degradation.timeoutWarnPct}
              min={0}
              max={100}
              step={0.1}
              onChange={(v) => patch("ops.degradation.timeoutWarnPct", v)}
            />
          </div>

          <div>
            <div className="text-muted" style={{ fontSize: 12 }}>
              timeoutDangerPct
            </div>
            <NumberInput
              value={cfg.ops.degradation.timeoutDangerPct}
              min={0}
              max={100}
              step={0.1}
              onChange={(v) => patch("ops.degradation.timeoutDangerPct", v)}
            />
          </div>
        </div>
      </FieldRow>

      <FieldRow
        label="Операционные действия"
        hint="Кнопки безопасны: всегда с подтверждением. Работают, если API реализован."
      >
        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              className="btn btn-primary btn-sm"
              type="button"
              disabled={!cfg.ops.actions.allowed.restartService}
              onClick={() =>
                doAction({
                  title: "Перезапустить сервис",
                  description: "Перезапуск сервиса (по имени).",
                  url: "/api/ops/service/restart",
                  body: { service: "api" },
                })
              }
            >
              Перезапустить API
            </button>

            <button
              className="btn btn-primary btn-sm"
              type="button"
              disabled={!cfg.ops.actions.allowed.reloadConfig}
              onClick={() =>
                doAction({
                  title: "Перечитать конфиг",
                  description: "Перечитать конфиг без перезапуска.",
                  url: "/api/ops/config/reload",
                  body: {},
                })
              }
            >
              Перечитать конфиг
            </button>

            <button
              className="btn btn-primary btn-sm"
              type="button"
              disabled={!cfg.ops.actions.allowed.pauseQueue}
              onClick={() =>
                doAction({
                  title: "Пауза очереди",
                  description: "Пауза обработки очереди.",
                  url: "/api/ops/queue/pause",
                  body: { queue: "prints" },
                })
              }
            >
              Пауза prints
            </button>

            <button
              className="btn btn-primary btn-sm"
              type="button"
              disabled={!cfg.ops.actions.allowed.drainQueue}
              onClick={() =>
                doAction({
                  title: "Очистить очередь",
                  description: "Очистить очередь (осторожно).",
                  url: "/api/ops/queue/drain",
                  body: { queue: "webhooks" },
                })
              }
            >
              Очистить webhooks
            </button>
          </div>

          <DangerZone title="Опасная зона">
            <div className="text-muted" style={{ fontSize: 12, marginBottom: 8 }}>
              Rebuild search index может остановить поиск и создать нагрузку на
              инфраструктуру. Включай только если это действительно нужно.
            </div>

            <button
              className="btn btn-primary btn-sm"
              type="button"
              disabled={!cfg.ops.actions.allowed.rebuildSearchIndex}
              onClick={() =>
                doAction({
                  title: "Перестроить поисковый индекс",
                  description: "Полная перестройка индекса (ОПАСНО).",
                  url: "/api/ops/search/rebuild",
                  body: { mode: "full" },
                })
              }
            >
              Перестроить индекс
            </button>
          </DangerZone>
        </div>
      </FieldRow>
    </Card>
  );
}
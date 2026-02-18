// apps/dashboard/src/pages/settings/sections/OpsSection.jsx
import React from "react";
import { Card, FieldRow, DangerZone, NumberInput } from "../ui";


export default function OpsSection({ cfg, patch, doAction }) {
  return (
    <Card title="4) Стан сервісів і дії оператора" sub="Пороги деградації + кнопки оператора (з підтвердженням)">
      <FieldRow label="Пороги деградації" hint="% помилок, p95 latency, timeouts.">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, maxWidth: 720 }}>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>errorRateWarnPct</div>
            <NumberInput value={cfg.ops.degradation.errorRateWarnPct} min={0} max={100} step={0.1} onChange={(v) => patch("ops.degradation.errorRateWarnPct", v)} />
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>errorRateDangerPct</div>
            <NumberInput value={cfg.ops.degradation.errorRateDangerPct} min={0} max={100} step={0.1} onChange={(v) => patch("ops.degradation.errorRateDangerPct", v)} />
          </div>

          <div>
            <div className="muted" style={{ fontSize: 12 }}>p95LatencyWarnMs</div>
            <NumberInput value={cfg.ops.degradation.p95LatencyWarnMs} min={0} max={600000} step={50} onChange={(v) => patch("ops.degradation.p95LatencyWarnMs", v)} />
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>p95LatencyDangerMs</div>
            <NumberInput value={cfg.ops.degradation.p95LatencyDangerMs} min={0} max={600000} step={50} onChange={(v) => patch("ops.degradation.p95LatencyDangerMs", v)} />
          </div>

          <div>
            <div className="muted" style={{ fontSize: 12 }}>timeoutWarnPct</div>
            <NumberInput value={cfg.ops.degradation.timeoutWarnPct} min={0} max={100} step={0.1} onChange={(v) => patch("ops.degradation.timeoutWarnPct", v)} />
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>timeoutDangerPct</div>
            <NumberInput value={cfg.ops.degradation.timeoutDangerPct} min={0} max={100} step={0.1} onChange={(v) => patch("ops.degradation.timeoutDangerPct", v)} />
          </div>
        </div>
      </FieldRow>

      <FieldRow label="Операційні дії" hint="Кнопки безпечні: завжди з підтвердженням. Працюють, якщо API реалізовано.">
        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              disabled={!cfg.ops.actions.allowed.restartService}
              onClick={() =>
                doAction({
                  title: "Перезапустити сервіс",
                  description: "Перезапуск сервісу (за назвою).",
                  url: "/api/ops/service/restart",
                  body: { service: "api" },
                })
              }
            >
              перезапустити api
            </button>

            <button
              type="button"
              disabled={!cfg.ops.actions.allowed.reloadConfig}
              onClick={() =>
                doAction({
                  title: "Перечитати конфіг",
                  description: "Перечитати конфіг без перезапуску.",
                  url: "/api/ops/config/reload",
                  body: {},
                })
              }
            >
              перечитати конфіг
            </button>

            <button
              type="button"
              disabled={!cfg.ops.actions.allowed.pauseQueue}
              onClick={() =>
                doAction({
                  title: "Пауза черги",
                  description: "Пауза обробки черги.",
                  url: "/api/ops/queue/pause",
                  body: { queue: "prints" },
                })
              }
            >
              пауза prints
            </button>

            <button
              type="button"
              disabled={!cfg.ops.actions.allowed.drainQueue}
              onClick={() =>
                doAction({
                  title: "Очистити чергу",
                  description: "Очистити чергу (обережно).",
                  url: "/api/ops/queue/drain",
                  body: { queue: "webhooks" },
                })
              }
            >
              очистити webhooks
            </button>
          </div>

          <DangerZone title="Небезпечна зона">
            <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
              Rebuild search index може зупинити пошук та навантажити інфраструктуру. Увімкай тільки якщо точно треба.
            </div>
            <button
              type="button"
              disabled={!cfg.ops.actions.allowed.rebuildSearchIndex}
              onClick={() =>
                doAction({
                  title: "Перебудувати пошуковий індекс",
                  description: "Повна перебудова індексу (НЕБЕЗПЕЧНО).",
                  url: "/api/ops/search/rebuild",
                  body: { mode: "full" },
                })
              }
            >
              перебудувати індекс
            </button>
          </DangerZone>
        </div>
      </FieldRow>
    </Card>
  );
}

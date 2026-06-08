// apps/dashboard/src/pages/settings/sections/OpsSection.jsx
import React from "react";
import { Card, FieldRow, DangerZone, NumberInput } from "../ui.jsx";
import styles from "../../Settings.module.css";

export default function OpsSection({ cfg, patch, doAction }) {
  return (
    <Card
      title="4) Стан сервісів і дії оператора"
      sub="Пороги деградації + кнопки оператора (з підтвердженням)"
    >
      <FieldRow
        label="Пороги деградації"
        hint="% помилок, затримка p95, тайм-аути."
      >
        <div className={`${styles.inputGrid2} ${styles.max720}`}>
          <div>
            <div className={styles.inputLabel}>errorRateWarnPct</div>
            <NumberInput
              value={cfg.ops.degradation.errorRateWarnPct}
              min={0}
              max={100}
              step={0.1}
              onChange={(v) => patch("ops.degradation.errorRateWarnPct", v)}
            />
          </div>

          <div>
            <div className={styles.inputLabel}>errorRateDangerPct</div>
            <NumberInput
              value={cfg.ops.degradation.errorRateDangerPct}
              min={0}
              max={100}
              step={0.1}
              onChange={(v) => patch("ops.degradation.errorRateDangerPct", v)}
            />
          </div>

          <div>
            <div className={styles.inputLabel}>p95LatencyWarnMs</div>
            <NumberInput
              value={cfg.ops.degradation.p95LatencyWarnMs}
              min={0}
              max={600000}
              step={50}
              onChange={(v) => patch("ops.degradation.p95LatencyWarnMs", v)}
            />
          </div>

          <div>
            <div className={styles.inputLabel}>p95LatencyDangerMs</div>
            <NumberInput
              value={cfg.ops.degradation.p95LatencyDangerMs}
              min={0}
              max={600000}
              step={50}
              onChange={(v) => patch("ops.degradation.p95LatencyDangerMs", v)}
            />
          </div>

          <div>
            <div className={styles.inputLabel}>timeoutWarnPct</div>
            <NumberInput
              value={cfg.ops.degradation.timeoutWarnPct}
              min={0}
              max={100}
              step={0.1}
              onChange={(v) => patch("ops.degradation.timeoutWarnPct", v)}
            />
          </div>

          <div>
            <div className={styles.inputLabel}>timeoutDangerPct</div>
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
        label="Операційні дії"
        hint="Кнопки безпечні: завжди з підтвердженням. Працюють, якщо API реалізовано."
      >
        <div className={styles.inputGroup}>
          <div className={styles.buttonGroup}>
            <button
              className="btn btn-primary btn-sm"
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
              Перезапустити API
            </button>

            <button
              className="btn btn-primary btn-sm"
              type="button"
              disabled={!cfg.ops.actions.allowed.reloadConfig}
              onClick={() =>
                doAction({
                  title: "Перечитати конфігурацію",
                  description: "Перечитати конфігурацію без перезапуску.",
                  url: "/api/ops/config/reload",
                  body: {},
                })
              }
            >
              Перечитати конфігурацію
            </button>

            <button
              className="btn btn-primary btn-sm"
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
              Пауза prints
            </button>

            <button
              className="btn btn-primary btn-sm"
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
              Очистити webhooks
            </button>
          </div>

          <DangerZone title="Небезпечна зона">
            <div className={styles.fieldHint}>
              Перебудова пошукового індексу може зупинити пошук і створити
              навантаження на інфраструктуру. Вмикай лише якщо це справді
              потрібно.
            </div>

            <button
              className="btn btn-primary btn-sm"
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
              Перебудувати індекс
            </button>
          </DangerZone>
        </div>
      </FieldRow>
    </Card>
  );
}
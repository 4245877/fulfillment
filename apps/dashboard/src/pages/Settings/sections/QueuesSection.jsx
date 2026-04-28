// apps/dashboard/src/pages/settings/sections/QueuesSection.jsx
import React from "react";
import { Card, FieldRow, Toggle, NumberInput } from "../ui.jsx";
import styles from "../../Settings.module.css";

export default function QueuesSection({ cfg, patch }) {
  return (
    <Card
      title="5) Очереди и воркеры"
      sub="Конкурентность, повторные попытки, DLQ, дедупликация, батчи, тайм-ауты"
    >
      <FieldRow
        label="Пороги"
        hint="Пороги ready/running для подсветки и оповещений."
      >
        <div className={`${styles.inputGrid2} ${styles.max720}`}>
          <div>
            <div className={styles.inputLabel}>readyWarn</div>
            <NumberInput
              value={cfg.queues.thresholds.readyWarn}
              min={0}
              max={1000000}
              onChange={(v) => patch("queues.thresholds.readyWarn", v)}
            />
          </div>

          <div>
            <div className={styles.inputLabel}>readyDanger</div>
            <NumberInput
              value={cfg.queues.thresholds.readyDanger}
              min={0}
              max={1000000}
              onChange={(v) => patch("queues.thresholds.readyDanger", v)}
            />
          </div>

          <div>
            <div className={styles.inputLabel}>runningWarn</div>
            <NumberInput
              value={cfg.queues.thresholds.runningWarn}
              min={0}
              max={1000000}
              onChange={(v) => patch("queues.thresholds.runningWarn", v)}
            />
          </div>

          <div>
            <div className={styles.inputLabel}>runningDanger</div>
            <NumberInput
              value={cfg.queues.thresholds.runningDanger}
              min={0}
              max={1000000}
              onChange={(v) => patch("queues.thresholds.runningDanger", v)}
            />
          </div>
        </div>
      </FieldRow>

      <FieldRow
        label="Повторные попытки / Backoff / DLQ"
        hint="Политика повторных попыток и очередь dead-letter."
      >
        <div className={`${styles.inputGrid2} ${styles.max720}`}>
          <div>
            <div className={styles.inputLabel}>maxRetries</div>
            <NumberInput
              value={cfg.queues.retries.maxRetries}
              min={0}
              max={100}
              onChange={(v) => patch("queues.retries.maxRetries", v)}
            />
          </div>

          <div>
            <div className={styles.inputLabel}>backoffMs</div>
            <NumberInput
              value={cfg.queues.retries.backoffMs}
              min={0}
              max={600000}
              step={100}
              onChange={(v) => patch("queues.retries.backoffMs", v)}
            />
          </div>

          <div>
            <div className={styles.inputLabel}>backoffMaxMs</div>
            <NumberInput
              value={cfg.queues.retries.backoffMaxMs}
              min={0}
              max={3600000}
              step={100}
              onChange={(v) => patch("queues.retries.backoffMaxMs", v)}
            />
          </div>

          <div style={{ display: "flex", alignItems: "center" }}>
            <Toggle
              value={cfg.queues.retries.dlqEnabled}
              onChange={(v) => patch("queues.retries.dlqEnabled", v)}
              label="DLQ включена"
            />
          </div>
        </div>
      </FieldRow>

      <FieldRow
        label="Политики обработки"
        hint="Дедупликация вебхуков, батчи, тайм-ауты."
      >
        <div className={`${styles.inputGroup} ${styles.max720}`}>
          <Toggle
            value={cfg.queues.policies.webhookDedupEnabled}
            onChange={(v) => patch("queues.policies.webhookDedupEnabled", v)}
            label="Дедупликация вебхуков"
          />

          <div className={styles.inputGrid2}>
            <div>
              <div className={styles.inputLabel}>webhookDedupWindowMs</div>
              <NumberInput
                value={cfg.queues.policies.webhookDedupWindowMs}
                min={0}
                max={3600000}
                step={1000}
                onChange={(v) =>
                  patch("queues.policies.webhookDedupWindowMs", v)
                }
              />
            </div>

            <div>
              <div className={styles.inputLabel}>maxBatchSize</div>
              <NumberInput
                value={cfg.queues.policies.maxBatchSize}
                min={1}
                max={100000}
                step={10}
                onChange={(v) => patch("queues.policies.maxBatchSize", v)}
              />
            </div>

            <div>
              <div className={styles.inputLabel}>jobTimeoutMs</div>
              <NumberInput
                value={cfg.queues.policies.jobTimeoutMs}
                min={0}
                max={36000000}
                step={1000}
                onChange={(v) => patch("queues.policies.jobTimeoutMs", v)}
              />
            </div>

            <div>
              <div className={styles.inputLabel}>visibilityTimeoutMs</div>
              <NumberInput
                value={cfg.queues.policies.visibilityTimeoutMs}
                min={0}
                max={36000000}
                step={1000}
                onChange={(v) =>
                  patch("queues.policies.visibilityTimeoutMs", v)
                }
              />
            </div>
          </div>
        </div>
      </FieldRow>
    </Card>
  );
}
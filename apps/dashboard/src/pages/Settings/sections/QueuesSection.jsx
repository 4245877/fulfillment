// apps/dashboard/src/pages/settings/sections/QueuesSection.jsx
import React from "react";
import { Card, FieldRow, Toggle, NumberInput, TextArea, TextInput } from "../ui";


export default function QueuesSection({ cfg, patch }) {
  return (
    <Card title="5) Черги та воркери (Queues)" sub="Конкурентність, повторні спроби, DLQ, дедуп, батчі, таймаути">
      <FieldRow label="Пороги" hint="ready/running thresholds для підсвічування та алертів.">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, maxWidth: 720 }}>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>readyWarn</div>
            <NumberInput value={cfg.queues.thresholds.readyWarn} min={0} max={1000000} onChange={(v) => patch("queues.thresholds.readyWarn", v)} />
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>readyDanger</div>
            <NumberInput value={cfg.queues.thresholds.readyDanger} min={0} max={1000000} onChange={(v) => patch("queues.thresholds.readyDanger", v)} />
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>runningWarn</div>
            <NumberInput value={cfg.queues.thresholds.runningWarn} min={0} max={1000000} onChange={(v) => patch("queues.thresholds.runningWarn", v)} />
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>runningDanger</div>
            <NumberInput value={cfg.queues.thresholds.runningDanger} min={0} max={1000000} onChange={(v) => patch("queues.thresholds.runningDanger", v)} />
          </div>
        </div>
      </FieldRow>

      <FieldRow label="Повторні спроби / Backoff / DLQ" hint="Політика повторних спроб і dead-letter queue.">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, maxWidth: 720 }}>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>maxRetries</div>
            <NumberInput value={cfg.queues.retries.maxRetries} min={0} max={100} onChange={(v) => patch("queues.retries.maxRetries", v)} />
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>backoffMs</div>
            <NumberInput value={cfg.queues.retries.backoffMs} min={0} max={600000} step={100} onChange={(v) => patch("queues.retries.backoffMs", v)} />
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>backoffMaxMs</div>
            <NumberInput value={cfg.queues.retries.backoffMaxMs} min={0} max={3600000} step={100} onChange={(v) => patch("queues.retries.backoffMaxMs", v)} />
          </div>
          <div style={{ display: "flex", alignItems: "center" }}>
            <Toggle value={cfg.queues.retries.dlqEnabled} onChange={(v) => patch("queues.retries.dlqEnabled", v)} label="DLQ увімкнено" />
          </div>
        </div>
      </FieldRow>

      <FieldRow label="Політики обробки" hint="Дедуп вебхуків, батчі, таймаути.">
        <div style={{ display: "grid", gap: 12, maxWidth: 720 }}>
          <Toggle value={cfg.queues.policies.webhookDedupEnabled} onChange={(v) => patch("queues.policies.webhookDedupEnabled", v)} label="Дедуплікація вебхуків" />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>webhookDedupWindowMs</div>
              <NumberInput value={cfg.queues.policies.webhookDedupWindowMs} min={0} max={3600000} step={1000} onChange={(v) => patch("queues.policies.webhookDedupWindowMs", v)} />
            </div>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>maxBatchSize</div>
              <NumberInput value={cfg.queues.policies.maxBatchSize} min={1} max={100000} step={10} onChange={(v) => patch("queues.policies.maxBatchSize", v)} />
            </div>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>jobTimeoutMs</div>
              <NumberInput value={cfg.queues.policies.jobTimeoutMs} min={0} max={36000000} step={1000} onChange={(v) => patch("queues.policies.jobTimeoutMs", v)} />
            </div>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>visibilityTimeoutMs</div>
              <NumberInput value={cfg.queues.policies.visibilityTimeoutMs} min={0} max={36000000} step={1000} onChange={(v) => patch("queues.policies.visibilityTimeoutMs", v)} />
            </div>
          </div>
        </div>
      </FieldRow>
    </Card>
  );
}

// apps/dashboard/src/pages/settings/sections/AlertsSection.jsx
import React from "react";
import { Card, FieldRow, Toggle, NumberInput, TextInput } from "../ui.jsx";


export default function AlertsSection({ cfg, patch }) {
  return (
    <Card title="10) Алерти та сповіщення" sub="Канали, правила, тихі години">
      <FieldRow label="Канали" hint="Telegram/Slack/Email/Webhook (профілі зберігаються на сервері).">
        <div style={{ display: "grid", gap: 12 }}>
          {Object.entries(cfg.alerts.channels).map(([name, c]) => (
            <div key={name} className="card" style={{ padding: 12 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <div style={{ fontWeight: 800 }}>{name}</div>
                <Toggle value={c.enabled} onChange={(v) => patch(`alerts.channels.${name}.enabled`, v)} label="увімкнено" />
              </div>
              <div style={{ marginTop: 10, maxWidth: 360 }}>
                <div className="muted" style={{ fontSize: 12 }}>профіль</div>
                <TextInput value={c.profile} onChange={(v) => patch(`alerts.channels.${name}.profile`, v)} placeholder="default" />
              </div>
            </div>
          ))}
        </div>
      </FieldRow>

      <FieldRow label="Правила" hint="Приклади: lag > X мс 5 хв, error rate, backlog, backup failed.">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, maxWidth: 720 }}>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>queueLagMs</div>
            <NumberInput value={cfg.alerts.rules.queueLagMs} min={0} max={3600000} step={500} onChange={(v) => patch("alerts.rules.queueLagMs", v)} />
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>queueLagForMinutes</div>
            <NumberInput value={cfg.alerts.rules.queueLagForMinutes} min={0} max={10080} onChange={(v) => patch("alerts.rules.queueLagForMinutes", v)} />
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>errorRatePct</div>
            <NumberInput value={cfg.alerts.rules.errorRatePct} min={0} max={100} step={0.1} onChange={(v) => patch("alerts.rules.errorRatePct", v)} />
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>indexerBacklog</div>
            <NumberInput value={cfg.alerts.rules.indexerBacklog} min={0} max={100000000} step={1000} onChange={(v) => patch("alerts.rules.indexerBacklog", v)} />
          </div>
          <div style={{ display: "flex", alignItems: "center" }}>
            <Toggle value={cfg.alerts.rules.backupFailed} onChange={(v) => patch("alerts.rules.backupFailed", v)} label="backupFailed" />
          </div>
        </div>
      </FieldRow>

      <FieldRow label="Тихі години" hint="Коли не турбувати (або тільки critical).">
        <div style={{ display: "grid", gap: 10, maxWidth: 520 }}>
          <Toggle value={cfg.alerts.quietHours.enabled} onChange={(v) => patch("alerts.quietHours.enabled", v)} label="увімкнено" />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>початок</div>
              <TextInput value={cfg.alerts.quietHours.start} onChange={(v) => patch("alerts.quietHours.start", v)} placeholder="23:00" />
            </div>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>кінець</div>
              <TextInput value={cfg.alerts.quietHours.end} onChange={(v) => patch("alerts.quietHours.end", v)} placeholder="07:00" />
            </div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>часовий пояс</div>
            <TextInput value={cfg.alerts.quietHours.timezone} onChange={(v) => patch("alerts.quietHours.timezone", v)} placeholder="Europe/Kyiv" />
          </div>
        </div>
      </FieldRow>
    </Card>
  );
}

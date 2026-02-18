// apps/dashboard/src/pages/settings/sections/UiSection.jsx
import React from "react";
import Card from "../atoms/Card";
import FieldRow from "../atoms/FieldRow";
import Toggle from "../atoms/Toggle";
import { ChipsEditor, NumberInput, Select, TextInput } from "../atoms/inputs";

export default function UiSection({ cfg, patch }) {
  return (
    <Card title="1) Загальне (UI/Wallboard)" sub="SSE/polling, перемикачі секцій, пороги підсвічування, локаль/час/валюта">
      <FieldRow label="SSE (Server-Sent Events)" hint="Якщо увімкнено — Board може отримувати оновлення без polling.">
        <div style={{ display: "grid", gap: 10 }}>
          <Toggle value={cfg.ui.sseEnabled} onChange={(v) => patch("ui.sseEnabled", v)} label="Увімкнути SSE" />

          <div>
            <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
              Теми (orders, prints, shipments, ops)
            </div>
            <ChipsEditor value={cfg.ui.sseTopics} onChange={(arr) => patch("ui.sseTopics", arr)} placeholder="Напр.: orders" />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Ліміт подій/сек</div>
              <NumberInput value={cfg.ui.sseEventsPerSecLimit} min={1} max={500} onChange={(v) => patch("ui.sseEventsPerSecLimit", v)} />
            </div>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Дедуплікація (мс)</div>
              <NumberInput value={cfg.ui.sseDedupWindowMs} min={0} max={600000} step={100} onChange={(v) => patch("ui.sseDedupWindowMs", v)} />
            </div>
          </div>
        </div>
      </FieldRow>

      <FieldRow label="Опитування (polling)" hint="Запасний режим, якщо SSE недоступний.">
        <div style={{ display: "grid", gap: 10 }}>
          <Toggle value={cfg.ui.pollingEnabled} onChange={(v) => patch("ui.pollingEnabled", v)} label="Увімкнути polling" />
          <div style={{ maxWidth: 320 }}>
            <div className="muted" style={{ fontSize: 12 }}>Інтервал (мс)</div>
            <NumberInput value={cfg.ui.pollingIntervalMs} min={1000} max={600000} step={500} onChange={(v) => patch("ui.pollingIntervalMs", v)} />
          </div>
        </div>
      </FieldRow>

      <FieldRow label="Board: показувати секції" hint="Feature toggles для головної дошки (Board).">
        <div style={{ display: "grid", gap: 6 }}>
          {Object.entries(cfg.ui.boardSections).map(([k, v]) => (
            <Toggle key={k} value={v} onChange={(next) => patch(`ui.boardSections.${k}`, next)} label={k} />
          ))}
        </div>
      </FieldRow>

      <FieldRow label="Пороги підсвічування (warn/danger)" hint="Використовуються для KPI, lag, backlog, низьких запасів.">
        <div style={{ display: "grid", gap: 12 }}>
          <div className="card" style={{ padding: 12 }}>
            <div style={{ fontWeight: 800, marginBottom: 8 }}>Затримка (lag) черг (мс)</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>warn</div>
                <NumberInput value={cfg.ui.thresholds.queueLagWarnMs} min={0} max={3600000} step={500} onChange={(v) => patch("ui.thresholds.queueLagWarnMs", v)} />
              </div>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>danger</div>
                <NumberInput value={cfg.ui.thresholds.queueLagDangerMs} min={0} max={3600000} step={500} onChange={(v) => patch("ui.thresholds.queueLagDangerMs", v)} />
              </div>
            </div>
          </div>

          <div className="card" style={{ padding: 12 }}>
            <div style={{ fontWeight: 800, marginBottom: 8 }}>Backlog (Indexer/Ingester)</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>Indexer warn</div>
                <NumberInput value={cfg.ui.thresholds.indexerBacklogWarn} min={0} max={100000000} step={1000} onChange={(v) => patch("ui.thresholds.indexerBacklogWarn", v)} />
              </div>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>Indexer danger</div>
                <NumberInput value={cfg.ui.thresholds.indexerBacklogDanger} min={0} max={100000000} step={1000} onChange={(v) => patch("ui.thresholds.indexerBacklogDanger", v)} />
              </div>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>Ingester warn</div>
                <NumberInput value={cfg.ui.thresholds.ingesterBacklogWarn} min={0} max={100000000} step={1000} onChange={(v) => patch("ui.thresholds.ingesterBacklogWarn", v)} />
              </div>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>Ingester danger</div>
                <NumberInput value={cfg.ui.thresholds.ingesterBacklogDanger} min={0} max={100000000} step={1000} onChange={(v) => patch("ui.thresholds.ingesterBacklogDanger", v)} />
              </div>
            </div>
          </div>

          <div className="card" style={{ padding: 12 }}>
            <div style={{ fontWeight: 800, marginBottom: 8 }}>Низький запас матеріалів</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>Філамент: warn (кг)</div>
                <NumberInput value={cfg.ui.thresholds.lowFilamentWarnKg} min={0} max={1000} step={0.1} onChange={(v) => patch("ui.thresholds.lowFilamentWarnKg", v)} />
              </div>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>Смола: warn (л)</div>
                <NumberInput value={cfg.ui.thresholds.lowResinWarnL} min={0} max={1000} step={0.1} onChange={(v) => patch("ui.thresholds.lowResinWarnL", v)} />
              </div>
            </div>
          </div>
        </div>
      </FieldRow>

      <FieldRow label="Локаль: часовий пояс/час/валюта" hint="Форматування часу на Board та грошових значень у таблицях.">
        <div style={{ display: "grid", gap: 12, maxWidth: 520 }}>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Часовий пояс</div>
            <TextInput value={cfg.ui.locale.timezone} onChange={(v) => patch("ui.locale.timezone", v)} placeholder="Europe/Kyiv" />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Формат часу</div>
              <Select
                value={cfg.ui.locale.timeFormat}
                onChange={(v) => patch("ui.locale.timeFormat", v)}
                options={[
                  { value: "24h", label: "24h" },
                  { value: "12h", label: "12h" },
                ]}
              />
            </div>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Валюта</div>
              <Select
                value={cfg.ui.locale.currency}
                onChange={(v) => patch("ui.locale.currency", v)}
                options={[
                  { value: "UAH", label: "UAH (₴)" },
                  { value: "USD", label: "USD ($)" },
                  { value: "EUR", label: "EUR (€)" },
                ]}
              />
            </div>
          </div>
        </div>
      </FieldRow>
    </Card>
  );
}

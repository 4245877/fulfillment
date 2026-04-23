// apps/dashboard/src/pages/settings/sections/UiSection.jsx
import React from "react";
import { Card, FieldRow, Toggle, ChipsEditor, NumberInput, Select, TextInput } from "../ui.jsx";

export default function UiSection({ cfg, patch }) {
  return (
    <Card
      title="1) Общее (UI/Wallboard)"
      sub="SSE/опрос, переключатели разделов, пороги подсветки, локаль/время/валюта"
    >
      <FieldRow
        label="SSE (события, отправляемые сервером)"
        hint="Если включено, Board может получать обновления без опроса."
      >
        <div style={{ display: "grid", gap: 10 }}>
          <Toggle
            value={cfg.ui.sseEnabled}
            onChange={(v) => patch("ui.sseEnabled", v)}
            label="Включить SSE"
          />

          <div>
            <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
              Темы (orders, prints, shipments, ops)
            </div>
            <ChipsEditor
              value={cfg.ui.sseTopics}
              onChange={(arr) => patch("ui.sseTopics", arr)}
              placeholder="Например: orders"
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Лимит событий/сек</div>
              <NumberInput
                value={cfg.ui.sseEventsPerSecLimit}
                min={1}
                max={500}
                onChange={(v) => patch("ui.sseEventsPerSecLimit", v)}
              />
            </div>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Дедупликация (мс)</div>
              <NumberInput
                value={cfg.ui.sseDedupWindowMs}
                min={0}
                max={600000}
                step={100}
                onChange={(v) => patch("ui.sseDedupWindowMs", v)}
              />
            </div>
          </div>
        </div>
      </FieldRow>

      <FieldRow
        label="Опрос (polling)"
        hint="Резервный режим, если SSE недоступен."
      >
        <div style={{ display: "grid", gap: 10 }}>
          <Toggle
            value={cfg.ui.pollingEnabled}
            onChange={(v) => patch("ui.pollingEnabled", v)}
            label="Включить polling"
          />
          <div style={{ maxWidth: 320 }}>
            <div className="muted" style={{ fontSize: 12 }}>Интервал (мс)</div>
            <NumberInput
              value={cfg.ui.pollingIntervalMs}
              min={1000}
              max={600000}
              step={500}
              onChange={(v) => patch("ui.pollingIntervalMs", v)}
            />
          </div>
        </div>
      </FieldRow>

      <FieldRow
        label="Board: показывать разделы"
        hint="Feature toggles для главной доски (Board)."
      >
        <div style={{ display: "grid", gap: 6 }}>
          {Object.entries(cfg.ui.boardSections).map(([k, v]) => (
            <Toggle
              key={k}
              value={v}
              onChange={(next) => patch(`ui.boardSections.${k}`, next)}
              label={k}
            />
          ))}
        </div>
      </FieldRow>

      <FieldRow
        label="Пороги подсветки (предупреждение/опасность)"
        hint="Используются для KPI, lag, backlog и низких запасов."
      >
        <div style={{ display: "grid", gap: 12 }}>
          <div className="card" style={{ padding: 12 }}>
            <div style={{ fontWeight: 800, marginBottom: 8 }}>Задержка очередей (lag), мс</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>Предупреждение</div>
                <NumberInput
                  value={cfg.ui.thresholds.queueLagWarnMs}
                  min={0}
                  max={3600000}
                  step={500}
                  onChange={(v) => patch("ui.thresholds.queueLagWarnMs", v)}
                />
              </div>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>Опасность</div>
                <NumberInput
                  value={cfg.ui.thresholds.queueLagDangerMs}
                  min={0}
                  max={3600000}
                  step={500}
                  onChange={(v) => patch("ui.thresholds.queueLagDangerMs", v)}
                />
              </div>
            </div>
          </div>

          <div className="card" style={{ padding: 12 }}>
            <div style={{ fontWeight: 800, marginBottom: 8 }}>Отставание (Indexer/Ingester)</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>Indexer: предупреждение</div>
                <NumberInput
                  value={cfg.ui.thresholds.indexerBacklogWarn}
                  min={0}
                  max={100000000}
                  step={1000}
                  onChange={(v) => patch("ui.thresholds.indexerBacklogWarn", v)}
                />
              </div>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>Indexer: опасность</div>
                <NumberInput
                  value={cfg.ui.thresholds.indexerBacklogDanger}
                  min={0}
                  max={100000000}
                  step={1000}
                  onChange={(v) => patch("ui.thresholds.indexerBacklogDanger", v)}
                />
              </div>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>Ingester: предупреждение</div>
                <NumberInput
                  value={cfg.ui.thresholds.ingesterBacklogWarn}
                  min={0}
                  max={100000000}
                  step={1000}
                  onChange={(v) => patch("ui.thresholds.ingesterBacklogWarn", v)}
                />
              </div>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>Ingester: опасность</div>
                <NumberInput
                  value={cfg.ui.thresholds.ingesterBacklogDanger}
                  min={0}
                  max={100000000}
                  step={1000}
                  onChange={(v) => patch("ui.thresholds.ingesterBacklogDanger", v)}
                />
              </div>
            </div>
          </div>

          <div className="card" style={{ padding: 12 }}>
            <div style={{ fontWeight: 800, marginBottom: 8 }}>Низкий запас материалов</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>Филамент: предупреждение (кг)</div>
                <NumberInput
                  value={cfg.ui.thresholds.lowFilamentWarnKg}
                  min={0}
                  max={1000}
                  step={0.1}
                  onChange={(v) => patch("ui.thresholds.lowFilamentWarnKg", v)}
                />
              </div>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>Смола: предупреждение (л)</div>
                <NumberInput
                  value={cfg.ui.thresholds.lowResinWarnL}
                  min={0}
                  max={1000}
                  step={0.1}
                  onChange={(v) => patch("ui.thresholds.lowResinWarnL", v)}
                />
              </div>
            </div>
          </div>
        </div>
      </FieldRow>

      <FieldRow
        label="Локаль: часовой пояс/время/валюта"
        hint="Форматирование времени на Board и денежных значений в таблицах."
      >
        <div style={{ display: "grid", gap: 12, maxWidth: 520 }}>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Часовой пояс</div>
            <TextInput
              value={cfg.ui.locale.timezone}
              onChange={(v) => patch("ui.locale.timezone", v)}
              placeholder="Europe/Kyiv"
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Формат времени</div>
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
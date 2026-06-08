// apps/dashboard/src/pages/settings/sections/UiSection.jsx
import React from "react";
import { Card, FieldRow, Toggle, ChipsEditor, NumberInput, Select, TextInput } from "../ui.jsx";
import styles from "../../Settings.module.css";

export default function UiSection({ cfg, patch }) {
  return (
    <Card
      title="1) Загальне (UI/Wallboard)"
      sub="SSE/опитування, перемикачі розділів, пороги підсвічування, локаль/час/валюта"
    >
      <FieldRow
        label="SSE (події, які надсилає сервер)"
        hint="Якщо ввімкнено, Board може отримувати оновлення без опитування."
      >
        <div className={styles.inputGroup}>
          <Toggle
            value={cfg.ui.sseEnabled}
            onChange={(v) => patch("ui.sseEnabled", v)}
            label="Увімкнути SSE"
          />

          <div>
            <div className={styles.inputLabel}>
              Теми (orders, prints, shipments, ops)
            </div>
            <ChipsEditor
              value={cfg.ui.sseTopics}
              onChange={(arr) => patch("ui.sseTopics", arr)}
              placeholder="Наприклад: orders"
            />
          </div>

          <div className={styles.inputGrid2}>
            <div>
              <div className={styles.inputLabel}>Ліміт подій/с</div>
              <NumberInput
                value={cfg.ui.sseEventsPerSecLimit}
                min={1}
                max={500}
                onChange={(v) => patch("ui.sseEventsPerSecLimit", v)}
              />
            </div>
            <div>
              <div className={styles.inputLabel}>Усунення дублікатів (мс)</div>
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
        label="Опитування (polling)"
        hint="Резервний режим, якщо SSE недоступний."
      >
        <div className={styles.inputGroup}>
          <Toggle
            value={cfg.ui.pollingEnabled}
            onChange={(v) => patch("ui.pollingEnabled", v)}
            label="Увімкнути polling"
          />
          <div className={styles.max320}>
            <div className={styles.inputLabel}>Інтервал (мс)</div>
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
        label="Board: показувати розділи"
        hint="Перемикачі функцій для головної дошки (Board)."
      >
        <div className={styles.inputGroup}>
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
        label="Пороги підсвічування (попередження/небезпека)"
        hint="Використовуються для KPI, lag, backlog і низьких запасів."
      >
        <div className={styles.inputGroup}>
          <div className={styles.nestedCard}>
            <div className={styles.nestedCardTitle}>Затримка черг (lag), мс</div>
            <div className={styles.inputGrid2}>
              <div>
                <div className={styles.inputLabel}>Попередження</div>
                <NumberInput
                  value={cfg.ui.thresholds.queueLagWarnMs}
                  min={0}
                  max={3600000}
                  step={500}
                  onChange={(v) => patch("ui.thresholds.queueLagWarnMs", v)}
                />
              </div>
              <div>
                <div className={styles.inputLabel}>Небезпека</div>
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

          <div className={styles.nestedCard}>
            <div className={styles.nestedCardTitle}>Відставання (Indexer/Ingester)</div>
            <div className={styles.inputGrid2}>
              <div>
                <div className={styles.inputLabel}>Indexer: попередження</div>
                <NumberInput
                  value={cfg.ui.thresholds.indexerBacklogWarn}
                  min={0}
                  max={100000000}
                  step={1000}
                  onChange={(v) => patch("ui.thresholds.indexerBacklogWarn", v)}
                />
              </div>
              <div>
                <div className={styles.inputLabel}>Indexer: небезпека</div>
                <NumberInput
                  value={cfg.ui.thresholds.indexerBacklogDanger}
                  min={0}
                  max={100000000}
                  step={1000}
                  onChange={(v) => patch("ui.thresholds.indexerBacklogDanger", v)}
                />
              </div>
              <div>
                <div className={styles.inputLabel}>Ingester: попередження</div>
                <NumberInput
                  value={cfg.ui.thresholds.ingesterBacklogWarn}
                  min={0}
                  max={100000000}
                  step={1000}
                  onChange={(v) => patch("ui.thresholds.ingesterBacklogWarn", v)}
                />
              </div>
              <div>
                <div className={styles.inputLabel}>Ingester: небезпека</div>
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

          <div className={styles.nestedCard}>
            <div className={styles.nestedCardTitle}>Низький запас матеріалів</div>
            <div className={styles.inputGrid2}>
              <div>
                <div className={styles.inputLabel}>Філамент: попередження (кг)</div>
                <NumberInput
                  value={cfg.ui.thresholds.lowFilamentWarnKg}
                  min={0}
                  max={1000}
                  step={0.1}
                  onChange={(v) => patch("ui.thresholds.lowFilamentWarnKg", v)}
                />
              </div>
              <div>
                <div className={styles.inputLabel}>Смола: попередження (л)</div>
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
        label="Локаль: часовий пояс/час/валюта"
        hint="Форматування часу на Board і грошових значень у таблицях."
      >
        <div className={`${styles.inputGroup} ${styles.max520}`}>
          <div>
            <div className={styles.inputLabel}>Часовий пояс</div>
            <TextInput
              value={cfg.ui.locale.timezone}
              onChange={(v) => patch("ui.locale.timezone", v)}
              placeholder="Europe/Kyiv"
            />
          </div>

          <div className={styles.inputGrid2}>
            <div>
              <div className={styles.inputLabel}>Формат часу</div>
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
              <div className={styles.inputLabel}>Валюта</div>
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
// apps/dashboard/src/pages/Settings/sections/LogisticsPaymentsSection.jsx
import React, { useEffect, useState } from "react";
import { Card, FieldRow, Toggle, NumberInput, TextArea, TextInput } from "../ui.jsx";
import { safeParseJSON } from "../utils";
import styles from "../../Settings.module.css";

export default function LogisticsPaymentsSection({ cfg, patch, showToast }) {
  // ----- редактор statusMapping (чернетка) -----
  const [statusMappingDraft, setStatusMappingDraft] = useState(() =>
    JSON.stringify(cfg.logisticsPayments.statusMapping, null, 2)
  );
  const [statusMappingError, setStatusMappingError] = useState(null);

  // синхронізуємо чернетку, якщо source-of-truth змінився (наприклад, після import/reset)
  useEffect(() => {
    setStatusMappingDraft(JSON.stringify(cfg.logisticsPayments.statusMapping, null, 2));
    setStatusMappingError(null);
  }, [cfg.logisticsPayments.statusMapping]);

  const validateStatusMappingDraft = (text) => {
    const parsed = safeParseJSON(text);
    if (!parsed) {
      setStatusMappingError("Помилка JSON: будь ласка, перевір дужки, коми та лапки.");
      return null;
    }
    setStatusMappingError(null);
    return parsed;
  };

  const applyStatusMappingDraft = () => {
    const parsed = validateStatusMappingDraft(statusMappingDraft);
    if (!parsed) return;
    patch("logisticsPayments.statusMapping", parsed);
    showToast?.({ kind: "success", text: "Мапінг застосовано ✅" }, 1200);
  };

  return (
    <Card
      title="8) Логістика та оплати"
      sub="Провайдери, ліміти, профілі webhook, мапінг статусів, антифрод"
    >
      <FieldRow label="Провайдери" hint="Увімкнути/вимкнути, rate-limit, профіль секретів.">
        <div className={styles.inputGroup}>
          {Object.entries(cfg.logisticsPayments.providers).map(([name, p]) => (
            <div key={name} className={styles.nestedCard}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                }}
              >
                <div className={styles.nestedCardTitle}>{name}</div>
                <Toggle
                  value={p.enabled}
                  onChange={(v) => patch(`logisticsPayments.providers.${name}.enabled`, v)}
                  label="увімкнено"
                />
              </div>

              <div className={`${styles.inputGrid2} ${styles.max720}`}>
                <div>
                  <div className={styles.inputLabel}>rateLimitRps</div>
                  <NumberInput
                    value={p.rateLimitRps}
                    min={0}
                    max={1000}
                    onChange={(v) => patch(`logisticsPayments.providers.${name}.rateLimitRps`, v)}
                  />
                </div>
                <div>
                  <div className={styles.inputLabel}>профіль</div>
                  <TextInput
                    value={p.profile}
                    onChange={(v) => patch(`logisticsPayments.providers.${name}.profile`, v)}
                    placeholder="default"
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </FieldRow>

      <FieldRow
        label="Мапінг статусів"
        hint="Відповідність зовнішніх статусів внутрішнім. Тут редагується як чернетка й застосовується кнопкою."
      >
        <div className={styles.max720}>
          <TextArea
            value={statusMappingDraft}
            onChange={(v) => {
              setStatusMappingDraft(v);
              if (v.trim() === "") {
                setStatusMappingError("Порожньо: очікується JSON-об’єкт.");
                return;
              }
              validateStatusMappingDraft(v);
            }}
            rows={10}
            placeholder='{"shipment":{"created":"new"}}'
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === "Enter") applyStatusMappingDraft();
            }}
          />

          <div className={styles.buttonGroup}>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={applyStatusMappingDraft}
            >
              Застосувати
            </button>

            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                setStatusMappingDraft(JSON.stringify(cfg.logisticsPayments.statusMapping, null, 2));
                setStatusMappingError(null);
              }}
            >
              Відкотити
            </button>

            <div className={styles.fieldHint}>Підказка: Ctrl/⌘ + Enter — застосувати.</div>
          </div>

          {statusMappingError ? (
            <div style={{ marginTop: 8 }}>
              <div className="errorBox">{statusMappingError}</div>
            </div>
          ) : null}
        </div>
      </FieldRow>

      <FieldRow label="Антифрод (обережно)" hint="Пороги/правила перевірки замовлень.">
        <div className={`${styles.inputGroup} ${styles.max720}`}>
          <Toggle
            value={cfg.logisticsPayments.antifraud.enabled}
            onChange={(v) => patch("logisticsPayments.antifraud.enabled", v)}
            label="увімкнено"
          />
          <div className={styles.inputGrid2}>
            <div>
              <div className={styles.inputLabel}>maxOrderValueUAH</div>
              <NumberInput
                value={cfg.logisticsPayments.antifraud.maxOrderValueUAH}
                min={0}
                max={100000000}
                step={100}
                onChange={(v) => patch("logisticsPayments.antifraud.maxOrderValueUAH", v)}
              />
            </div>
            <div>
              <div className={styles.inputLabel}>requireManualReviewAboveUAH</div>
              <NumberInput
                value={cfg.logisticsPayments.antifraud.requireManualReviewAboveUAH}
                min={0}
                max={100000000}
                step={100}
                onChange={(v) => patch("logisticsPayments.antifraud.requireManualReviewAboveUAH", v)}
              />
            </div>
          </div>
        </div>
      </FieldRow>
    </Card>
  );
}
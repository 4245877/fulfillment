// apps/dashboard/src/pages/Settings/sections/LogisticsPaymentsSection.jsx
import React, { useEffect, useState } from "react";
import { Card, FieldRow, Toggle, NumberInput, TextArea, TextInput } from "../ui.jsx";
import { safeParseJSON } from "../utils";

export default function LogisticsPaymentsSection({ cfg, patch, showToast }) {
  // ----- редактор statusMapping (черновик) -----
  const [statusMappingDraft, setStatusMappingDraft] = useState(() =>
    JSON.stringify(cfg.logisticsPayments.statusMapping, null, 2)
  );
  const [statusMappingError, setStatusMappingError] = useState(null);

  // синхронизируем черновик, если source-of-truth изменился (например, после import/reset)
  useEffect(() => {
    setStatusMappingDraft(JSON.stringify(cfg.logisticsPayments.statusMapping, null, 2));
    setStatusMappingError(null);
  }, [cfg.logisticsPayments.statusMapping]);

  const validateStatusMappingDraft = (text) => {
    const parsed = safeParseJSON(text);
    if (!parsed) {
      setStatusMappingError("Ошибка JSON: пожалуйста, проверь скобки, запятые и кавычки.");
      return null;
    }
    setStatusMappingError(null);
    return parsed;
  };

  const applyStatusMappingDraft = () => {
    const parsed = validateStatusMappingDraft(statusMappingDraft);
    if (!parsed) return;
    patch("logisticsPayments.statusMapping", parsed);
    showToast?.({ kind: "success", text: "Маппинг применён ✅" }, 1200);
  };

  return (
    <Card
      title="8) Логистика и оплаты"
      sub="Провайдеры, лимиты, профили webhook, маппинг статусов, антифрод"
    >
      <FieldRow label="Провайдеры" hint="Включить/выключить, rate-limit, профиль секретов.">
        <div style={{ display: "grid", gap: 12 }}>
          {Object.entries(cfg.logisticsPayments.providers).map(([name, p]) => (
            <div key={name} className="card" style={{ padding: 12 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                }}
              >
                <div style={{ fontWeight: 800 }}>{name}</div>
                <Toggle
                  value={p.enabled}
                  onChange={(v) => patch(`logisticsPayments.providers.${name}.enabled`, v)}
                  label="включено"
                />
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 12,
                  marginTop: 10,
                  maxWidth: 720,
                }}
              >
                <div>
                  <div className="text-muted" style={{ fontSize: 12 }}>
                    rateLimitRps
                  </div>
                  <NumberInput
                    value={p.rateLimitRps}
                    min={0}
                    max={1000}
                    onChange={(v) => patch(`logisticsPayments.providers.${name}.rateLimitRps`, v)}
                  />
                </div>
                <div>
                  <div className="text-muted" style={{ fontSize: 12 }}>
                    профиль
                  </div>
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
        label="Маппинг статусов"
        hint="Соответствие внешних статусов внутренним. Здесь редактируется как черновик и применяется кнопкой."
      >
        <div style={{ maxWidth: 720 }}>
          <TextArea
            value={statusMappingDraft}
            onChange={(v) => {
              setStatusMappingDraft(v);
              if (v.trim() === "") {
                setStatusMappingError("Пусто: ожидается JSON-объект.");
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

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={applyStatusMappingDraft}
            >
              Применить
            </button>

            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                setStatusMappingDraft(JSON.stringify(cfg.logisticsPayments.statusMapping, null, 2));
                setStatusMappingError(null);
              }}
            >
              Откатить
            </button>

            <div className="text-muted" style={{ fontSize: 12, alignSelf: "center" }}>
              Подсказка: Ctrl/⌘ + Enter — применить.
            </div>
          </div>

          {statusMappingError ? (
            <div style={{ marginTop: 8 }}>
              <div className="errorBox">{statusMappingError}</div>
            </div>
          ) : null}
        </div>
      </FieldRow>

      <FieldRow label="Антифрод (осторожно)" hint="Пороги/правила проверки заказов.">
        <div style={{ display: "grid", gap: 10, maxWidth: 720 }}>
          <Toggle
            value={cfg.logisticsPayments.antifraud.enabled}
            onChange={(v) => patch("logisticsPayments.antifraud.enabled", v)}
            label="включено"
          />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <div className="text-muted" style={{ fontSize: 12 }}>
                maxOrderValueUAH
              </div>
              <NumberInput
                value={cfg.logisticsPayments.antifraud.maxOrderValueUAH}
                min={0}
                max={100000000}
                step={100}
                onChange={(v) => patch("logisticsPayments.antifraud.maxOrderValueUAH", v)}
              />
            </div>
            <div>
              <div className="text-muted" style={{ fontSize: 12 }}>
                requireManualReviewAboveUAH
              </div>
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
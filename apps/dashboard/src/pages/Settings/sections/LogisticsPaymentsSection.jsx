// apps/dashboard/src/pages/settings/sections/LogisticsPaymentsSection.jsx
import React, { useEffect, useState } from "react";
import Card from "../atoms/Card";
import FieldRow from "../atoms/FieldRow";
import Toggle from "../atoms/Toggle";
import { NumberInput, TextArea, TextInput } from "../atoms/inputs";
import { safeParseJSON } from "../utils";

export default function LogisticsPaymentsSection({ cfg, patch, showToast }) {
  // ----- редактор statusMapping (чернетка) -----
  const [statusMappingDraft, setStatusMappingDraft] = useState(() =>
    JSON.stringify(cfg.logisticsPayments.statusMapping, null, 2)
  );
  const [statusMappingError, setStatusMappingError] = useState(null);

  // синхронизируем черновик, если source-of-truth изменился (например import/reset)
  useEffect(() => {
    setStatusMappingDraft(JSON.stringify(cfg.logisticsPayments.statusMapping, null, 2));
    setStatusMappingError(null);
  }, [cfg.logisticsPayments.statusMapping]);

  const validateStatusMappingDraft = (text) => {
    const parsed = safeParseJSON(text);
    if (!parsed) {
      setStatusMappingError("Помилка JSON: перевір, будь ласка, дужки/коми/лапки.");
      return null;
    }
    setStatusMappingError(null);
    return parsed;
  };

  const applyStatusMappingDraft = () => {
    const parsed = validateStatusMappingDraft(statusMappingDraft);
    if (!parsed) return;
    patch("logisticsPayments.statusMapping", parsed);
    showToast?.({ kind: "success", text: "Маппінг застосовано ✅" }, 1200);
  };

  return (
    <Card title="8) Логістика та оплати" sub="Провайдери, ліміти, профілі webhooks, маппінг статусів, антифрод">
      <FieldRow label="Провайдери" hint="Увімкнути/вимкнути, rate-limit, профіль секретів.">
        <div style={{ display: "grid", gap: 12 }}>
          {Object.entries(cfg.logisticsPayments.providers).map(([name, p]) => (
            <div key={name} className="card" style={{ padding: 12 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <div style={{ fontWeight: 800 }}>{name}</div>
                <Toggle value={p.enabled} onChange={(v) => patch(`logisticsPayments.providers.${name}.enabled`, v)} label="увімкнено" />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 10, maxWidth: 720 }}>
                <div>
                  <div className="muted" style={{ fontSize: 12 }}>rateLimitRps</div>
                  <NumberInput value={p.rateLimitRps} min={0} max={1000} onChange={(v) => patch(`logisticsPayments.providers.${name}.rateLimitRps`, v)} />
                </div>
                <div>
                  <div className="muted" style={{ fontSize: 12 }}>профіль</div>
                  <TextInput value={p.profile} onChange={(v) => patch(`logisticsPayments.providers.${name}.profile`, v)} placeholder="default" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </FieldRow>

      <FieldRow
        label="Маппінг статусів"
        hint="Відповідність зовнішніх статусів внутрішнім. Тут редагується як чернетка і застосовується кнопкою."
      >
        <div style={{ maxWidth: 720 }}>
          <TextArea
            value={statusMappingDraft}
            onChange={(v) => {
              setStatusMappingDraft(v);
              if (v.trim() === "") {
                setStatusMappingError("Порожньо: очікується JSON-обʼєкт.");
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
            <button type="button" className="buttonPrimary" onClick={applyStatusMappingDraft}>
              Застосувати
            </button>

            <button
              type="button"
              className="buttonSecondary"
              onClick={() => {
                setStatusMappingDraft(JSON.stringify(cfg.logisticsPayments.statusMapping, null, 2));
                setStatusMappingError(null);
              }}
            >
              Відкотити
            </button>

            <div className="muted" style={{ fontSize: 12, alignSelf: "center" }}>
              Порада: Ctrl/⌘ + Enter — застосувати.
            </div>
          </div>

          {statusMappingError ? (
            <div style={{ marginTop: 8 }}>
              <div className="errorBox">{statusMappingError}</div>
            </div>
          ) : null}
        </div>
      </FieldRow>

      <FieldRow label="Антифрод (акуратно)" hint="Пороги/правила перевірки замовлень.">
        <div style={{ display: "grid", gap: 10, maxWidth: 720 }}>
          <Toggle value={cfg.logisticsPayments.antifraud.enabled} onChange={(v) => patch("logisticsPayments.antifraud.enabled", v)} label="увімкнено" />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>maxOrderValueUAH</div>
              <NumberInput value={cfg.logisticsPayments.antifraud.maxOrderValueUAH} min={0} max={100000000} step={100} onChange={(v) => patch("logisticsPayments.antifraud.maxOrderValueUAH", v)} />
            </div>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>requireManualReviewAboveUAH</div>
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

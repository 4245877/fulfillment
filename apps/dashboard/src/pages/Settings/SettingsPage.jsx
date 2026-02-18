// apps/dashboard/src/pages/settings/SettingsPage.jsx
import React, { useMemo } from "react";
import styles from "./Settings.module.css";

import { useSettingsConfig } from "./useSettingsConfig";

import UiSection from "./sections/UiSection";
import BackupsSection from "./sections/BackupsSection";
import InfraSection from "./sections/InfraSection";
import OpsSection from "./sections/OpsSection";
import QueuesSection from "./sections/QueuesSection";
import CatalogSection from "./sections/CatalogSection";
import PrintFarmSection from "./sections/PrintFarmSection";
import LogisticsPaymentsSection from "./sections/LogisticsPaymentsSection";
import WebhooksSection from "./sections/WebhooksSection";
import AlertsSection from "./sections/AlertsSection";
import SecuritySection from "./sections/SecuritySection";

const cls = (...xs) => xs.filter(Boolean).join(" ");

export default function SettingsPage() {
  const { cfg, patch, toast, exportJson, importJson, resetAll, showToast, doAction } = useSettingsConfig();

  const nav = useMemo(
    () => [
      { id: "ui", title: "1) Загальне (UI/Wallboard)" },
      { id: "backups", title: "2) Резервні копії та зберігання" },
      { id: "infra", title: "3) Інфраструктура (Servers/Topology)" },
      { id: "ops", title: "4) Стан сервісів і дії оператора" },
      { id: "queues", title: "5) Черги та воркери (Queues)" },
      { id: "catalog", title: "6) Каталог 3M SKU: Indexer / Ingester / Import" },
      { id: "printFarm", title: "7) Виробництво / Print Farm" },
      { id: "logisticsPayments", title: "8) Логістика та оплати" },
      { id: "webhooks", title: "9) Вебхуки" },
      { id: "alerts", title: "10) Алерти та сповіщення" },
      { id: "security", title: "11) Безпека та доступ" },
    ],
    []
  );

  return (
    <div className={cls(styles.root)} style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 16, alignItems: "start" }}>
      {/* Ліва навігація */}
      <div className="card" style={{ position: "sticky", top: 16 }}>
        <div style={{ fontWeight: 900, fontSize: 16 }}>Налаштування</div>
        <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
          Зміни зберігаються локально в браузері. Пізніше можна підключити збереження на сервері.
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
          <button className="buttonSecondary" type="button" onClick={exportJson}>
            Експорт JSON
          </button>

          <label className="buttonSecondary" style={{ cursor: "pointer" }}>
            Імпорт JSON
            <input
              type="file"
              accept="application/json"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) importJson(f);
                e.target.value = "";
              }}
            />
          </label>

          <button type="button" onClick={resetAll}>
            Скинути
          </button>
        </div>

        <div style={{ borderTop: "1px solid var(--border)", margin: "12px 0" }} />

        <div style={{ display: "grid", gap: 6 }}>
          {nav.map((x) => (
            <a
              key={x.id}
              href={`#${x.id}`}
              style={{
                padding: "6px 8px",
                borderRadius: 10,
                background: "color-mix(in srgb, var(--primary) 3%, transparent)",
              }}
            >
              {x.title}
            </a>
          ))}
        </div>

        {toast ? (
          <div style={{ marginTop: 12 }}>
            <div className={toast.kind === "error" ? "errorBox" : "successBox"}>{toast.text}</div>
          </div>
        ) : null}
      </div>

      {/* Контент */}
      <div>
        <div id="ui" />
        <UiSection cfg={cfg} patch={patch} />

        <div id="backups" />
        <BackupsSection cfg={cfg} patch={patch} doAction={doAction} />

        <div id="infra" />
        <InfraSection cfg={cfg} patch={patch} />

        <div id="ops" />
        <OpsSection cfg={cfg} patch={patch} doAction={doAction} />

        <div id="queues" />
        <QueuesSection cfg={cfg} patch={patch} />

        <div id="catalog" />
        <CatalogSection cfg={cfg} patch={patch} />

        <div id="printFarm" />
        <PrintFarmSection cfg={cfg} patch={patch} />

        <div id="logisticsPayments" />
        <LogisticsPaymentsSection cfg={cfg} patch={patch} showToast={showToast} />

        <div id="webhooks" />
        <WebhooksSection cfg={cfg} patch={patch} doAction={doAction} />

        <div id="alerts" />
        <AlertsSection cfg={cfg} patch={patch} />

        <div id="security" />
        <SecuritySection cfg={cfg} patch={patch} />

        <div className="muted" style={{ fontSize: 12, paddingBottom: 16 }}>
          Примітка: зараз це “локальні” налаштування для UI. Коли будеш готовий — я підключу синхронізацію з API (GET/PUT) і застосування до Board/ops.
        </div>
      </div>
    </div>
  );
}

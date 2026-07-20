import React, { useCallback, useEffect, useState } from "react";

import { fetchPrinterStatuses } from "../api/printerFarmApi.js";
import PrinterMonitoringPanel from "../components/printers/PrinterMonitoringPanel.jsx";

import "../styles/wallboard.css";

const PRINTER_POLL_INTERVAL_MS = 5000;

// The atelier print-dashboard owns printer configuration, commands and
// cameras. Its address is deployment-specific (host, port, reverse proxy), so
// it comes from the build-time env (VITE_ATELIER_DASHBOARD_URL, see
// .env.example) — nothing is pinned to an IP, hostname or port here. When the
// variable is not set the link is hidden and the page stays read-only text.
const ATELIER_DASHBOARD_URL = String(
  import.meta.env.VITE_ATELIER_DASHBOARD_URL || ""
).trim();

function formatHeaderTime(value) {
  if (!value) return "—";

  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatHeroDate(value) {
  if (!value) return "—";

  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleDateString("ru-RU", {
    weekday: "long",
    day: "2-digit",
    month: "long",
  });
}

function PrintersHero({ updatedAt, loading, hasError }) {
  return (
    <header className="wallboard-hero">
      <div className="wallboard-hero-inner">
        <div>
          <div className="wallboard-hero-greeting">Lite Forest</div>
          <h1>3D-принтеры</h1>
          <p className="wallboard-hero-sub">
            Состояние печатной фермы (только просмотр). Данные поступают из
            оркестратора печати; управление принтерами и камерами — в{" "}
            {ATELIER_DASHBOARD_URL ? (
              <a href={ATELIER_DASHBOARD_URL} target="_blank" rel="noreferrer">
                дашборде фермы
              </a>
            ) : (
              "дашборде фермы"
            )}
            .
          </p>
        </div>

        <div className="wallboard-hero-meta">
          <div className="wallboard-hero-date">{formatHeroDate(updatedAt)}</div>
          <div className="wallboard-hero-time">{formatHeaderTime(updatedAt)}</div>
          <div
            className={
              hasError
                ? "wallboard-hero-status wallboard-hero-status--danger"
                : "wallboard-hero-status"
            }
          >
            <span className="wallboard-hero-status-dot" />
            {loading
              ? "Обновляю данные…"
              : hasError
                ? "Оркестратор недоступен — я продолжаю попытки"
                : "Мониторинг активен, я приглядываю за фермой"}
          </div>
        </div>
      </div>
    </header>
  );
}

export default function Printers() {
  const [printers, setPrinters] = useState([]);
  const [monitorError, setMonitorError] = useState("");
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState(null);

  const refresh = useCallback(async () => {
    const data = await fetchPrinterStatuses();

    setPrinters(Array.isArray(data?.printers) ? data.printers : []);
    setMonitorError("");
    setUpdatedAt(new Date());
  }, []);

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;

    const load = async () => {
      if (inFlight) return;

      inFlight = true;

      try {
        await refresh();
      } catch (error) {
        if (!cancelled) {
          setMonitorError(
            error instanceof Error
              ? error.message
              : "Мне не удалось получить статус принтеров. Я попробую ещё раз."
          );
        }
      } finally {
        inFlight = false;

        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    load();

    const timer = window.setInterval(load, PRINTER_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [refresh]);

  return (
    <div className="wallboard">
      <PrintersHero
        updatedAt={updatedAt}
        loading={loading}
        hasError={Boolean(monitorError)}
      />

      {loading ? (
        <div className="alert-strip alert-strip--info">
          <div className="alert-strip-icon" aria-hidden="true">
            ⟳
          </div>
          <div className="alert-strip-text">
            Минутку, пожалуйста… я подключаю мониторинг 3D-принтеров.
          </div>
        </div>
      ) : null}

      <div className="wallboard-sections">
        <PrinterMonitoringPanel
          livePrinters={printers}
          monitorError={monitorError}
          loading={loading}
        />
      </div>
    </div>
  );
}

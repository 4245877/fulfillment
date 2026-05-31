import React, { useCallback, useEffect, useMemo, useState } from "react";

import { apiWB as api } from "../api/wallboardApi.js";
import { fetchPrinterStatuses } from "../api/printerFarmApi.js";
import { useSSE } from "../hooks/useSSE.js";
import PrinterMonitoringPanel from "../components/printers/PrinterMonitoringPanel.jsx";

import "../styles/wallboard.css";

const DEFAULT_PRINTS = {
  printers: [],
  jobs: [],
  stats: {},
};

const DEFAULT_PRINTER_MONITOR = {
  printers: [],
  error: "",
};

const PRINTER_POLL_INTERVAL_MS = 5000;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function deepMerge(current, next) {
  if (!isPlainObject(next)) {
    return next === undefined ? current : next;
  }

  const result = { ...(isPlainObject(current) ? current : {}) };

  Object.keys(next).forEach((key) => {
    const currentValue = result[key];
    const nextValue = next[key];

    if (Array.isArray(nextValue)) {
      result[key] = nextValue;
      return;
    }

    if (isPlainObject(nextValue)) {
      result[key] = deepMerge(currentValue, nextValue);
      return;
    }

    result[key] = nextValue;
  });

  return result;
}

function mergePrints(current, next) {
  if (!isPlainObject(next)) return current;

  return {
    ...current,
    ...next,
    stats: deepMerge(current.stats || {}, next.stats || {}),
    printers: Array.isArray(next.printers) ? next.printers : current.printers,
    jobs: Array.isArray(next.jobs) ? next.jobs : current.jobs,
  };
}

function formatHeaderTime(value) {
  if (!value) return "—";

  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleTimeString("uk-UA", {
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

  return date.toLocaleDateString("uk-UA", {
    weekday: "long",
    day: "2-digit",
    month: "long",
  });
}

function PrintersHero({ updatedAt, loading }) {
  return (
    <header className="wallboard-hero">
      <div className="wallboard-hero-inner">
        <div>
          <div className="wallboard-hero-greeting">Lite Forest</div>
          <h1>3D-принтери</h1>
          <p className="wallboard-hero-sub">
            Окрема панель моніторингу друкарської ферми, активних робіт,
            температур і стану обладнання.
          </p>
        </div>

        <div className="wallboard-hero-meta">
          <div className="wallboard-hero-date">{formatHeroDate(updatedAt)}</div>
          <div className="wallboard-hero-time">{formatHeaderTime(updatedAt)}</div>
          <div className="wallboard-hero-status">
            <span className="wallboard-hero-status-dot" />
            {loading ? "Оновлення даних" : "Моніторинг активний"}
          </div>
        </div>
      </div>
    </header>
  );
}

export default function Printers() {
  const [prints, setPrints] = useState(DEFAULT_PRINTS);
  const [printerMonitor, setPrinterMonitor] = useState(DEFAULT_PRINTER_MONITOR);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [updatedAt, setUpdatedAt] = useState(new Date());

  useEffect(() => {
    let isMounted = true;

    api
      .printsOverview()
      .then((data) => {
        if (!isMounted) return;

        setPrints((current) => mergePrints(current, data));
        setLoadError("");
        setUpdatedAt(new Date());
      })
      .catch((error) => {
        if (!isMounted) return;

        setLoadError(
          error instanceof Error
            ? error.message
            : "Не вдалося завантажити зведення друку"
        );
      })
      .finally(() => {
        if (isMounted) {
          setLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;

    const loadPrinterStatuses = async () => {
      if (inFlight) return;

      inFlight = true;

      try {
        const data = await fetchPrinterStatuses();

        if (cancelled) return;

        setPrinterMonitor({
          printers: Array.isArray(data.printers) ? data.printers : [],
          error: "",
        });

        setUpdatedAt(new Date());
      } catch (error) {
        if (cancelled) return;

        setPrinterMonitor((current) => ({
          ...current,
          error:
            error instanceof Error
              ? error.message
              : "Не вдалося отримати статус принтерів",
        }));
      } finally {
        inFlight = false;
      }
    };

    loadPrinterStatuses();

    const timer = window.setInterval(
      loadPrinterStatuses,
      PRINTER_POLL_INTERVAL_MS
    );

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const handleSSEEvent = useCallback((event = {}) => {
    const data = event.payload || event.data || {};

    setUpdatedAt(new Date());

    if (event.type === "print.progress") {
      setPrints((current) => ({
        ...current,
        jobs: current.jobs.map((job) =>
          String(job.id) === String(event.entity_id)
            ? {
                ...job,
                progress: data.progress ?? job.progress,
                eta: data.eta ?? job.eta,
              }
            : job
        ),
      }));

      return;
    }

    if (event.type === "printer.state") {
      setPrints((current) => ({
        ...current,
        printers: current.printers.map((printer) =>
          String(printer.id) === String(event.entity_id)
            ? {
                ...printer,
                state: data.state ?? printer.state,
              }
            : printer
        ),
      }));

      setPrinterMonitor((current) => ({
        ...current,
        printers: current.printers.map((printer) =>
          String(printer.id) === String(event.entity_id)
            ? {
                ...printer,
                status: data.state ?? printer.status,
                state: data.state ?? printer.state,
              }
            : printer
        ),
      }));

      return;
    }

    if (event.domain === "prints" || event.domain === "print") {
      setPrints((current) => mergePrints(current, data));
    }
  }, []);

  const sseOptions = useMemo(
    () => ({
      onEvent: handleSSEEvent,
    }),
    [handleSSEEvent]
  );

  useSSE("/api/events/stream?topics=prints", sseOptions);

  return (
    <div className="wallboard">
      <PrintersHero updatedAt={updatedAt} loading={loading} />

      {loading ? (
        <div className="alert-strip alert-strip--info">
          <div className="alert-strip-icon" aria-hidden="true">
            ⟳
          </div>
          <div className="alert-strip-text">
            Завантажую моніторинг 3D-принтерів…
          </div>
        </div>
      ) : null}

      {loadError ? (
        <div className="alert-strip alert-strip--danger">
          <div className="alert-strip-icon" aria-hidden="true">
            !
          </div>
          <div className="alert-strip-text">{loadError}</div>
        </div>
      ) : null}

      <div className="wallboard-sections">
        <div className="wallboard-row">
          <PrinterMonitoringPanel
            printers={prints.printers}
            jobs={prints.jobs}
            livePrinters={printerMonitor.printers}
            monitorError={printerMonitor.error}
            loading={loading}
          />
        </div>
      </div>
    </div>
  );
}
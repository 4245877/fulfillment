import React, { useEffect, useState } from "react";
import styles from "./Print.module.css";

function normalizeState(state) {
  return String(state || "idle").trim().toLowerCase();
}

function getStateLabel(state) {
  const normalized = normalizeState(state);

  switch (normalized) {
    case "working":
    case "printing":
      return "Друкує";
    case "idle":
      return "Очікує";
    case "offline":
      return "Офлайн";
    case "error":
      return "Помилка";
    default:
      return state || "—";
  }
}

function clampProgress(value) {
  const num = Number(value);

  if (!Number.isFinite(num)) {
    return 0;
  }

  return Math.max(0, Math.min(100, num));
}

function ProgressBar({ value }) {
  const progress = clampProgress(value);

  return (
    <div className={styles.progressWrapper}>
      <div
        className={styles.progressBar}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress}
        aria-label={`Прогрес друку ${progress}%`}
      >
        <div
          className={styles.progressFill}
          style={{ width: `${progress}%` }}
        />
      </div>

      <div className={styles.progressText}>
        <span>Прогрес</span>
        <span className={styles.progressPercent}>{progress}%</span>
      </div>
    </div>
  );
}

function EmptyState({ icon, text }) {
  return (
    <div className={styles.empty}>
      <div className={styles.emptyIcon}>{icon}</div>
      <p className={styles.emptyText}>{text}</p>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className={styles.printerCard}>
      <div
        className={styles.skeleton}
        style={{ height: 20, width: "45%", marginBottom: 12 }}
      />
      <div
        className={styles.skeleton}
        style={{ height: 14, width: "70%", marginBottom: 8 }}
      />
      <div
        className={styles.skeleton}
        style={{ height: 14, width: "55%" }}
      />
    </div>
  );
}

export default function Print() {
  const [printers, setPrinters] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadOverview() {
      try {
        const response = await fetch("/api/prints/overview", {
          headers: {
            Accept: "application/json",
          },
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const payload = await response.json();

        if (cancelled) {
          return;
        }

        setPrinters(Array.isArray(payload?.printers) ? payload.printers : []);
        setJobs(Array.isArray(payload?.jobs) ? payload.jobs : []);
      } catch {
        if (!cancelled) {
          setPrinters([]);
          setJobs([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadOverview();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const source = new EventSource("/api/events/stream?topics=prints");

    function applyEvent(evt) {
      if (!evt?.type) {
        return;
      }

      if (evt.type === "print.progress") {
        setJobs((current) =>
          current.map((job) =>
            String(job.id) === String(evt.entity_id)
              ? {
                  ...job,
                  progress: evt?.data?.progress ?? job.progress,
                  eta: evt?.data?.eta ?? job.eta,
                }
              : job
          )
        );
      }

      if (evt.type === "printer.state") {
        setPrinters((current) =>
          current.map((printer) =>
            String(printer.id) === String(evt.entity_id)
              ? {
                  ...printer,
                  state: evt?.data?.state ?? printer.state,
                }
              : printer
          )
        );
      }
    }

    function parseEventData(rawData, forcedType) {
      try {
        const parsed = JSON.parse(rawData);

        if (forcedType && !parsed.type) {
          parsed.type = forcedType;
        }

        return parsed;
      } catch {
        return forcedType ? { type: forcedType, data: rawData } : null;
      }
    }

    function handleMessage(event) {
      const parsed = parseEventData(event.data);
      if (parsed) {
        applyEvent(parsed);
      }
    }

    function handlePrintProgress(event) {
      const parsed = parseEventData(event.data, "print.progress");
      if (parsed) {
        applyEvent(parsed);
      }
    }

    function handlePrinterState(event) {
      const parsed = parseEventData(event.data, "printer.state");
      if (parsed) {
        applyEvent(parsed);
      }
    }

    source.onmessage = handleMessage;
    source.addEventListener("print.progress", handlePrintProgress);
    source.addEventListener("printer.state", handlePrinterState);

    return () => {
      source.removeEventListener("print.progress", handlePrintProgress);
      source.removeEventListener("printer.state", handlePrinterState);
      source.close();
    };
  }, []);

  return (
    <div className={styles.container}>
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Принтери</h2>

        <div className={styles.grid}>
          {loading ? (
            <>
              <SkeletonCard />
              <SkeletonCard />
            </>
          ) : printers.length === 0 ? (
            <EmptyState icon="🖨️" text="Немає доступних принтерів" />
          ) : (
            printers.map((printer) => {
              const state = normalizeState(printer.state);

              return (
                <article key={printer.id} className={styles.printerCard}>
                  <div className={styles.printerHeader}>
                    <h3 className={styles.printerName}>{printer.name || "—"}</h3>

                    <span className={styles.printerMeta}>
                      {printer.model || "—"}
                      {printer.nozzle ? ` • ${printer.nozzle}` : ""}
                    </span>
                  </div>

                  <div className={styles.printerDetails}>
                    <div className={styles.printerRow}>
                      <strong>Стан:</strong>
                      <span className={styles.status} data-state={state}>
                        {getStateLabel(printer.state)}
                      </span>
                    </div>

                    <div className={styles.printerRow}>
                      <strong>Матеріал:</strong>
                      <span>{printer.material_color || "—"}</span>
                    </div>
                  </div>
                </article>
              );
            })
          )}
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Завдання</h2>

        <div className={styles.grid}>
          {loading ? (
            <>
              <SkeletonCard />
              <SkeletonCard />
            </>
          ) : jobs.length === 0 ? (
            <EmptyState icon="📦" text="Активних завдань немає" />
          ) : (
            jobs.map((job) => (
              <article key={job.id} className={styles.jobCard}>
                <div className={styles.jobHeader}>
                  <div className={styles.jobInfo}>
                    <div className={styles.jobOrder}>
                      {job.order_number || "—"}
                    </div>
                    <div className={styles.jobSku}>
                      {job.sku || "—"} ×{job.qty ?? 0}
                    </div>
                  </div>

                  <span className={styles.jobPrinter}>
                    {job.printer_name || "—"}
                  </span>
                </div>

                <ProgressBar value={job.progress} />

                <div className={styles.progressText}>
                  <span className={styles.eta}>ETA: {job.eta || "—"}</span>
                </div>
              </article>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
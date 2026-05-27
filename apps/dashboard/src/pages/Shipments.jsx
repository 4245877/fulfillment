import React, { useEffect, useState } from "react";
import { api } from "../api/client";
import { useSSE } from "../hooks/useSSE";
import styles from "./Shipments.module.css";

function getStatusClass(status) {
  const value = String(status || "").toLowerCase();

  if (
    value.includes("delivered") ||
    value.includes("completed") ||
    value.includes("done") ||
    value.includes("достав") ||
    value.includes("викон")
  ) {
    return styles.statusSuccess;
  }

  if (
    value.includes("error") ||
    value.includes("failed") ||
    value.includes("cancel") ||
    value.includes("помил") ||
    value.includes("скас")
  ) {
    return styles.statusDanger;
  }

  if (
    value.includes("pending") ||
    value.includes("queued") ||
    value.includes("waiting") ||
    value.includes("очіку")
  ) {
    return styles.statusWarning;
  }

  if (
    value.includes("ship") ||
    value.includes("transit") ||
    value.includes("sent") ||
    value.includes("дороз") ||
    value.includes("відправ")
  ) {
    return styles.statusInfo;
  }

  return styles.statusNeutral;
}

export default function Shipments() {
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");

  async function load() {
    setError("");

    try {
      const data = await api.get("/api/shipments?limit=50");
      const list = Array.isArray(data)
        ? data
        : data?.items || data?.rows || [];

      setRows(Array.isArray(list) ? list : []);
    } catch (e) {
      setRows([]);
      setError(e?.message || String(e));
    }
  }

  useEffect(() => {
    load();
  }, []);

  useSSE("/api/events/stream?topics=shipments", {
    onEvent: (evt) => {
      if (!evt || typeof evt !== "object") return;

      if (evt.type === "shipment.updated") {
        setRows((cur) =>
          Array.isArray(cur)
            ? cur.map((x) =>
                x?.id === evt.entity_id ? { ...x, ...evt.data } : x
              )
            : []
        );
      }
    },
  });

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerText}>
          <div className={styles.eyebrow}>Логістика</div>
          <h2 className={styles.title}>Відправлення</h2>
          <p className={styles.subtitle}>
            Останні відправлення, перевізники, номери ТТН та напрямки доставки.
          </p>
        </div>
      </header>

      {error ? (
        <div className={styles.error}>
          <div className={styles.errorTitle}>Помилка завантаження</div>
          <div className={styles.errorText}>{error}</div>
          <div className={styles.errorHint}>
            Підказка: якщо API ще не запущений — це нормально. UI не має падати.
          </div>
        </div>
      ) : null}

      <div className={styles.list}>
        {(Array.isArray(rows) ? rows : []).map((s) => (
          <article
            key={s.id || `${s.order_number}-${s.awb || ""}`}
            className={styles.card}
          >
            <div className={styles.cardTop}>
              <div className={styles.order}>
                <span className={styles.orderLabel}>Заказ</span>
                <strong className={styles.orderNumber}>
                  {s.order_number || "—"}
                </strong>
              </div>

              <span
                className={`${styles.statusTag} ${getStatusClass(s.status)}`}
                title={s.status || "—"}
              >
                {s.status || "—"}
              </span>
            </div>

            <div className={styles.meta}>
              <span className={styles.metaItem}>
                <span className={styles.metaLabel}>Перевізник:</span>
                <span className={styles.metaValue}>{s.carrier || "—"}</span>
              </span>

              <span className={styles.dot} aria-hidden="true" />

              <span className={styles.metaItem}>
                <span className={styles.metaLabel}>Номер ТТН:</span>
                <span className={styles.metaValue}>{s.awb || "—"}</span>
              </span>
            </div>

            <div className={styles.destination}>
              <span className={styles.destinationLabel}>Куди</span>
              <span className={styles.destinationValue}>
                {s.destination || s.pickup_point || "—"}
              </span>
            </div>
          </article>
        ))}

        {!error && Array.isArray(rows) && rows.length === 0 ? (
          <div className={styles.empty}>
            <div className={styles.emptyTitle}>Відправлень поки немає</div>
            <div className={styles.emptyText}>
              Коли API поверне дані, вони зʼявляться тут автоматично.
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
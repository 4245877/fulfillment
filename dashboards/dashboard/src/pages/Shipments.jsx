import React, { useEffect, useState } from "react";
import { api } from "../api/client";
import { useSSE } from "../hooks/useSSE";

export default function Shipments() {
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");

  async function load() {
    setError("");
    try {
      const data = await api.get("/api/shipments?limit=50");
      const list = Array.isArray(data) ? data : (data?.items || data?.rows || []);
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
            ? cur.map((x) => (x?.id === evt.entity_id ? { ...x, ...evt.data } : x))
            : []
        );
      }
    },
  });

  return (
    <div>
      <h2>Відправлення</h2>

      {error ? (
        <div style={{ marginTop: 10, padding: 10, border: "1px solid #7f1d1d", borderRadius: 10 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Помилка завантаження</div>
          <div style={{ whiteSpace: "pre-wrap", fontSize: 12, color: "#fecaca" }}>{error}</div>
          <div style={{ marginTop: 6, fontSize: 12, color: "#9ca3af" }}>
            Підказка: якщо API ще не запущений — це нормально. UI не має падати.
          </div>
        </div>
      ) : null}

      <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
        {(Array.isArray(rows) ? rows : []).map((s) => (
          <div key={s.id || `${s.order_number}-${s.awb || ""}`} style={{ border: "1px solid #1f2937", borderRadius: 10, padding: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
              <strong>Заказ: {s.order_number || "—"}</strong>
              <span className="tag">{s.status || "—"}</span>
            </div>
            <div style={{ marginTop: 6, color: "#9ca3af" }}>
              Перевізник: {s.carrier || "—"} · Номер ТТН: {s.awb || "—"}
            </div>
            <div style={{ marginTop: 6 }}>
              Куди: {s.destination || s.pickup_point || "—"}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

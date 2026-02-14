import React, { useEffect, useMemo, useState } from "react";
import s from "./Orders.module.css";

function asArray(v) {
  return Array.isArray(v) ? v : [];
}
function norm(v) {
  return String(v ?? "").toLowerCase().trim();
}
function pickId(o) {
  return o?.id ?? o?.order_id ?? o?.uuid ?? o?._id ?? "";
}
function pickStatus(o) {
  return o?.status ?? o?.state ?? o?.stage ?? "";
}

export default function Orders() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");

  async function load() {
    setLoading(true);
    setError(null);

    try {
      const token =
        localStorage.getItem("token") ||
        localStorage.getItem("access_token") ||
        localStorage.getItem("auth_token") ||
        "";

      const res = await fetch("/api/orders", {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });

      if (!res.ok) throw new Error(`GET /api/orders -> ${res.status} ${res.statusText}`);

      const data = await res.json();
      const list = asArray(data?.orders ?? data?.items ?? data ?? []);
      setOrders(list);
    } catch (e) {
      setOrders([]);
      setError(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const list = asArray(orders);
    const qq = norm(q);

    return list.filter((o) => {
      if (status !== "all") {
        const st = norm(pickStatus(o));
        if (st !== norm(status)) return false;
      }
      if (!qq) return true;

      const hay = [pickId(o), pickStatus(o), o?.customer, o?.customer_name, o?.email, o?.phone]
        .map(norm)
        .join(" ");

      return hay.includes(qq);
    });
  }, [orders, q, status]);

  const statuses = useMemo(() => {
    const set = new Set();
    for (const o of asArray(orders)) {
      const st = String(pickStatus(o) ?? "").trim();
      if (st) set.add(st);
    }
    return ["all", ...Array.from(set)];
  }, [orders]);

  return (
    <div>
      <div className={s.topRow}>
        <h2 className={s.title}>Замовлення</h2>

        <button onClick={load} disabled={loading}>
          {loading ? "Завантаження…" : "Оновити"}
        </button>

        <div className={s.controls}>
          <input
            className={s.search}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Пошук (id, статус, клієнт...)"
          />

          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            {statuses.map((x) => (
              <option key={x} value={x}>
                {x === "all" ? "усі статуси" : x}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <div className="errorBox" style={{ marginTop: 12 }}>
          <div className="errorTitle">Помилка завантаження</div>
          <div className="errorText">{String(error?.message || error)}</div>
          <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>
            Підказка: якщо API ще не запущений — це нормально. UI не має падати.
          </div>
        </div>
      )}

      <div className={s.meta}>
        Показано: {filtered.length} / {asArray(orders).length}
      </div>

      <div className={s.list}>
        {filtered.map((o, idx) => (
          <div key={pickId(o) || idx} className="card">
            <div className={s.cardHeader}>
              <div>
                <div className={s.primaryLine}>
                  #{pickId(o) || "(no id)"}{" "}
                  <span className="muted">{o?.created_at ? `• ${o.created_at}` : ""}</span>
                </div>
                <div className={s.subLine}>
                  Статус: <span style={{ color: "var(--text)" }}>{pickStatus(o) || "(unknown)"}</span>
                </div>
              </div>

              <div className="muted">{o?.customer_name || o?.customer || o?.email || o?.phone || ""}</div>
            </div>

            <details className={s.details}>
              <summary className="muted" style={{ cursor: "pointer" }}>
                Деталі (JSON)
              </summary>
              <pre className={s.pre}>{JSON.stringify(o, null, 2)}</pre>
            </details>
          </div>
        ))}

        {!loading && !error && filtered.length === 0 && <div className={s.empty}>Немає даних для відображення.</div>}
      </div>
    </div>
  );
}

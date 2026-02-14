import React, { useEffect, useState } from "react";

export default function Pickup() {
  const [code, setCode] = useState("");
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function find() {
    const trimmed = code.trim();
    if (!trimmed) return;

    setLoading(true);
    setDone(false);

    try {
      const res = await fetch(
        `/api/pickup/search?code=${encodeURIComponent(trimmed)}`,
        { credentials: "include" }
      );

      if (!res.ok) throw new Error("not found");
      setOrder(await res.json());
    } catch {
      setOrder(null);
      alert("Не знайдено. Перевір код або номер замовлення.");
    } finally {
      setLoading(false);
    }
  }

  async function issue() {
    if (!order) return;

    setLoading(true);
    try {
      const res = await fetch(`/api/pickup/${order.id}/issue`, {
        method: "POST",
        credentials: "include"
      });

      if (!res.ok) throw new Error("fail");
      setDone(true);
    } catch {
      alert("Не вдалося видати. Спробуй ще раз.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);

  function onKeyDown(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      find();
    }
  }

  return (
    <div className="wrap">
      <h1>Видача замовлень</h1>
      <p style={{ opacity: 0.8 }}>
        Введи код з SMS/QR або номер замовлення.
      </p>

      <div style={{ display: "grid", gap: 10, margin: "12px 0" }}>
        <input
          placeholder="Код / Номер"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <button onClick={find} disabled={!code.trim() || loading}>
          {loading ? "Пошук…" : "Знайти"}
        </button>
      </div>

      {order && !done && (
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <strong>Замовлення {order.number}</strong>
            <span>Сума: {order.total?.toFixed?.(2)} ₴</span>
          </div>

          <div style={{ opacity: 0.9, marginTop: 6 }}>
            Клієнт: {order.customer_name}
          </div>

          <div style={{ opacity: 0.8, marginTop: 6 }}>
            Статус: {order.fulfillment_status}
          </div>

          <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
            <button onClick={issue} disabled={loading}>
              {loading ? "Обробка…" : "Видати"}
            </button>
          </div>
        </div>
      )}

      {done && (
        <div className="card">
          <strong>Видано ✔</strong>
          <div style={{ opacity: 0.85, marginTop: 6 }}>
            Успішно видано замовлення {order?.number}.
          </div>
        </div>
      )}
    </div>
  );
}

import React, { useEffect, useState } from "react";
import { useSSE } from "../hooks/useSSE";

export default function Audit() {
  const [events, setEvents] = useState([]);

  useEffect(() => {
    setEvents([]);
  }, []);

  useSSE("/api/events/stream?topics=orders,prints,shipments", {
    onEvent: (e) => setEvents((cur) => [e, ...cur].slice(0, 200)),
  });

  return (
    <div>
      <h2>Журнал подій</h2>

      <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
        {events.map((e, idx) => (
          <div
            key={idx}
            style={{
              border: "1px solid #1f2937",
              borderRadius: 10,
              padding: 10,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <strong>{e.type}</strong>
              <span className="tag">{e.occurred_at || e.created_at || ""}</span>
            </div>

            <div style={{ color: "#9ca3af" }}>
              entity: {e.entity} #{e.entity_id}
            </div>

            <pre
              style={{
                whiteSpace: "pre-wrap",
                margin: 0,
                marginTop: 6,
                fontSize: 12,
                color: "#cbd5e1",
              }}
            >
              {JSON.stringify(e.data || {}, null, 2)}
            </pre>
          </div>
        ))}
      </div>
    </div>
  );
}

import React, { useState } from "react";
import { useSSE } from "../hooks/useSSE";
import styles from "./Audit.module.css";

export default function Audit() {
  const [events, setEvents] = useState([]);

  useSSE("/api/events/stream?topics=orders,prints,shipments", {
    onEvent: (e) => setEvents((cur) => [e, ...cur].slice(0, 200)),
  });

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <div className={styles.eyebrow}>Система</div>

          <h2 className={styles.title}>
            Журнал событий
            <span className={styles.badge}>{events.length}</span>
          </h2>

          <p className={styles.subtitle}>
            Живая лента событий заказов, печати и отправлений — я слушаю её
            непрерывно и записываю всё сюда.
          </p>
        </div>
      </div>

      {events.length === 0 ? (
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}>🗂️</div>
          <div className={styles.emptyTitle}>Событий пока нет</div>
          <div className={styles.emptyDescription}>
            Я внимательно слушаю систему — как только что-то произойдёт, запись
            сразу появится здесь.
          </div>
        </div>
      ) : (
        <div className={styles.eventsGrid}>
          {events.map((e, idx) => {
            const time = e.occurred_at || e.created_at || "";
            const type = String(e.type || "");
            const entity = String(e.entity || "");
            const entityId = e.entity_id ?? "—";

            return (
              <div
                key={`${type}-${entity}-${entityId}-${time}-${idx}`}
                className={styles.eventCard}
                data-type={type.toLowerCase()}
              >
                <div className={styles.eventHeader}>
                  <strong className={styles.eventType}>{type || "event"}</strong>
                  {/* An empty timestamp would render as a bare grey pill. */}
                  {time ? (
                    <span className={styles.eventTime}>{time}</span>
                  ) : null}
                </div>

                <div className={styles.eventMeta}>
                  <span className={styles.entityBadge}>
                    entity: {entity} #{entityId}
                  </span>
                </div>

                <div className={styles.eventData}>
                  <pre className={styles.eventDataPre}>
                    {JSON.stringify(e.data || {}, null, 2)}
                  </pre>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
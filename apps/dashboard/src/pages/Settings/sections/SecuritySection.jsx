// apps/dashboard/src/pages/settings/sections/SecuritySection.jsx
import React from "react";
import { Card, FieldRow, ChipsEditor } from "../ui.jsx";
import styles from "../../Settings.module.css";

export default function SecuritySection({ cfg, patch }) {
  return (
    <Card title="11) Безпека та доступ" sub="RBAC для дій, журнал аудиту змін">
      <FieldRow
        label="RBAC: хто може натискати «небезпечні» кнопки"
        hint="Списки ролей для операційних дій."
      >
        <div className={`${styles.inputGroup} ${styles.max720}`}>
          {Object.entries(cfg.security.rbac).map(([k, roles]) => (
            <div key={k}>
              <div className={styles.inputLabel}>{k}</div>

              <ChipsEditor
                value={roles}
                onChange={(arr) => patch(`security.rbac.${k}`, arr)}
                placeholder="admin"
              />
            </div>
          ))}
        </div>
      </FieldRow>

      <FieldRow
        label="Журнал аудиту"
        hint="Заглушка. Пізніше можна підключити до /api/audit/recent."
      >
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>час</th>
                <th>виконавець</th>
                <th>дія</th>
                <th>ціль</th>
              </tr>
            </thead>

            <tbody>
              {(cfg.security.audit.recent || []).map((x, i) => (
                <tr key={i}>
                  <td className="text-muted">{x.ts}</td>
                  <td>{x.actor}</td>
                  <td>{x.action}</td>
                  <td>{x.target}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </FieldRow>
    </Card>
  );
}
// apps/dashboard/src/pages/settings/sections/SecuritySection.jsx
import React from "react";
import { Card, FieldRow, ChipsEditor } from "../ui.jsx";
import styles from "../../Settings.module.css";

export default function SecuritySection({ cfg, patch }) {
  return (
    <Card title="Безопасность и доступ" sub="RBAC для действий, журнал аудита изменений">
      <FieldRow
        label="RBAC: кто может нажимать «опасные» кнопки"
        hint="Списки ролей для операционных действий."
        wide
      >
        <div className={styles.nestedGrid}>
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
        label="Журнал аудита"
        hint="Заглушка. Позже можно подключить к /api/audit/recent."
        wide
      >
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>время</th>
                <th>исполнитель</th>
                <th>действие</th>
                <th>цель</th>
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
// apps/dashboard/src/pages/settings/sections/SecuritySection.jsx
import React from "react";
import { Card, FieldRow, ChipsEditor } from "../ui";


export default function SecuritySection({ cfg, patch }) {
  return (
    <Card title="11) Безпека та доступ" sub="RBAC на дії, audit log змін">
      <FieldRow label="RBAC: хто може натискати «небезпечні» кнопки" hint="Списки ролей для операційних дій.">
        <div style={{ display: "grid", gap: 12, maxWidth: 720 }}>
          {Object.entries(cfg.security.rbac).map(([k, roles]) => (
            <div key={k}>
              <div className="muted" style={{ fontSize: 12 }}>{k}</div>
              <ChipsEditor value={roles} onChange={(arr) => patch(`security.rbac.${k}`, arr)} placeholder="admin" />
            </div>
          ))}
        </div>
      </FieldRow>

      <FieldRow label="Audit log" hint="Плейсхолдер. Пізніше можна підключити до /api/audit/recent.">
        <div style={{ overflowX: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>час</th>
                <th>актор</th>
                <th>дія</th>
                <th>ціль</th>
              </tr>
            </thead>
            <tbody>
              {(cfg.security.audit.recent || []).map((x, i) => (
                <tr key={i}>
                  <td className="muted">{x.ts}</td>
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

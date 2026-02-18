// apps/dashboard/src/pages/settings/sections/WebhooksSection.jsx
import React from "react";
import { Card, FieldRow, Toggle, NumberInput } from "../ui";


export default function WebhooksSection({ cfg, patch, doAction }) {
  return (
    <Card title="9) Вебхуки" sub="Retries/backoff, ідемпотентність, підписи, останні помилки, тестова подія">
      <FieldRow label="Політики" hint="Основні важелі надійності та безпеки вебхуків.">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, maxWidth: 720 }}>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>retries</div>
            <NumberInput value={cfg.webhooks.policy.retries} min={0} max={100} onChange={(v) => patch("webhooks.policy.retries", v)} />
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>backoffMs</div>
            <NumberInput value={cfg.webhooks.policy.backoffMs} min={0} max={3600000} step={100} onChange={(v) => patch("webhooks.policy.backoffMs", v)} />
          </div>
          <div style={{ display: "flex", alignItems: "center" }}>
            <Toggle value={cfg.webhooks.policy.idempotencyEnabled} onChange={(v) => patch("webhooks.policy.idempotencyEnabled", v)} label="idempotencyEnabled" />
          </div>
          <div style={{ display: "flex", alignItems: "center" }}>
            <Toggle value={cfg.webhooks.policy.signatureVerification} onChange={(v) => patch("webhooks.policy.signatureVerification", v)} label="signatureVerification" />
          </div>
        </div>
      </FieldRow>

      <FieldRow label="Останні помилки" hint="Плейсхолдер (можна підключити до /api/webhooks/errors).">
        <div style={{ overflowX: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>час</th>
                <th>джерело</th>
                <th>повідомлення</th>
              </tr>
            </thead>
            <tbody>
              {(cfg.webhooks.recentErrors || []).length ? (
                (cfg.webhooks.recentErrors || []).slice(0, 20).map((e, i) => (
                  <tr key={i}>
                    <td className="muted">{e.ts || "—"}</td>
                    <td>{e.source || "—"}</td>
                    <td>{e.message || "—"}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="3" className="muted">
                    Даних поки немає.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </FieldRow>

      <FieldRow label="Надіслати тестову подію" hint="Опціонально: надіслати тестовий вебхук (якщо API реалізовано).">
        <button
          type="button"
          onClick={() =>
            doAction({
              title: "Надіслати тестову подію",
              description: "Надіслати тестову подію для перевірки траси.",
              url: "/api/ops/webhooks/send-test",
              body: { kind: "ping" },
            })
          }
        >
          надіслати тест
        </button>
      </FieldRow>
    </Card>
  );
}

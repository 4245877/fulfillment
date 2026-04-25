// apps/dashboard/src/pages/settings/sections/WebhooksSection.jsx
import React from "react";
import { Card, FieldRow, Toggle, NumberInput } from "../ui.jsx";

export default function WebhooksSection({ cfg, patch, doAction }) {
  return (
    <Card
      title="9) Вебхуки"
      sub="Повторные попытки/backoff, идемпотентность, подписи, последние ошибки, тестовое событие"
    >
      <FieldRow
        label="Политики"
        hint="Основные рычаги надежности и безопасности вебхуков."
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 12,
            maxWidth: 720,
          }}
        >
          <div>
            <div className="text-muted" style={{ fontSize: 12 }}>
              retries
            </div>
            <NumberInput
              value={cfg.webhooks.policy.retries}
              min={0}
              max={100}
              onChange={(v) => patch("webhooks.policy.retries", v)}
            />
          </div>

          <div>
            <div className="text-muted" style={{ fontSize: 12 }}>
              backoffMs
            </div>
            <NumberInput
              value={cfg.webhooks.policy.backoffMs}
              min={0}
              max={3600000}
              step={100}
              onChange={(v) => patch("webhooks.policy.backoffMs", v)}
            />
          </div>

          <div style={{ display: "flex", alignItems: "center" }}>
            <Toggle
              value={cfg.webhooks.policy.idempotencyEnabled}
              onChange={(v) => patch("webhooks.policy.idempotencyEnabled", v)}
              label="idempotencyEnabled"
            />
          </div>

          <div style={{ display: "flex", alignItems: "center" }}>
            <Toggle
              value={cfg.webhooks.policy.signatureVerification}
              onChange={(v) =>
                patch("webhooks.policy.signatureVerification", v)
              }
              label="signatureVerification"
            />
          </div>
        </div>
      </FieldRow>

      <FieldRow
        label="Последние ошибки"
        hint="Плейсхолдер (можно подключить к /api/webhooks/errors)."
      >
        <div style={{ overflowX: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>время</th>
                <th>источник</th>
                <th>сообщение</th>
              </tr>
            </thead>
            <tbody>
              {(cfg.webhooks.recentErrors || []).length ? (
                (cfg.webhooks.recentErrors || []).slice(0, 20).map((e, i) => (
                  <tr key={i}>
                    <td className="text-muted">{e.ts || "—"}</td>
                    <td>{e.source || "—"}</td>
                    <td>{e.message || "—"}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="3" className="text-muted">
                    Данных пока нет.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </FieldRow>

      <FieldRow
        label="Отправить тестовое событие"
        hint="Опционально: отправить тестовый вебхук (если API реализовано)."
      >
        <button
          className="btn btn-primary btn-sm"
          type="button"
          onClick={() =>
            doAction({
              title: "Отправить тестовое событие",
              description: "Отправить тестовое событие для проверки трассировки.",
              url: "/api/ops/webhooks/send-test",
              body: { kind: "ping" },
            })
          }
        >
          Отправить тест
        </button>
      </FieldRow>
    </Card>
  );
}
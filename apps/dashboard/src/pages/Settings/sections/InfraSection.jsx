// apps/dashboard/src/pages/settings/sections/InfraSection.jsx
import React from "react";
import { Card, FieldRow, Toggle, NumberInput, TextArea } from "../ui.jsx";

const ROLE_OPTIONS = [
  { value: "api", label: "API" },
  { value: "worker", label: "Воркер" },
  { value: "db", label: "База данных" },
  { value: "search", label: "Поиск" },
  { value: "printers", label: "Принтеры" },
  { value: "media", label: "Медиа" },
];

export default function InfraSection({ cfg, patch }) {
  const nodes = cfg?.infra?.nodes || [];
  const pools = cfg?.infra?.pools || {};
  const maintenance = cfg?.infra?.maintenance || {};

  return (
    <Card
      title="3) Инфраструктура (серверы / топология)"
      sub="Ноды, роли, пулы/лимиты, режим технических работ"
    >
      <FieldRow
        label="Список нод"
        hint="Название, роль, хост. (UI-список; серверные данные будут подтягиваться позже)."
      >
        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Название</th>
                  <th>Роль</th>
                  <th>Хост</th>
                  <th>Заметки</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {nodes.map((n, i) => (
                  <tr key={`${n.name}-${i}`}>
                    <td>
                      <input
                        value={n.name}
                        onChange={(e) => {
                          const next = [...nodes];
                          next[i] = { ...next[i], name: e.target.value };
                          patch("infra.nodes", next);
                        }}
                      />
                    </td>
                    <td>
                      <select
                        value={n.role}
                        onChange={(e) => {
                          const next = [...nodes];
                          next[i] = { ...next[i], role: e.target.value };
                          patch("infra.nodes", next);
                        }}
                      >
                        {ROLE_OPTIONS.map((role) => (
                          <option key={role.value} value={role.value}>
                            {role.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        value={n.host}
                        onChange={(e) => {
                          const next = [...nodes];
                          next[i] = { ...next[i], host: e.target.value };
                          patch("infra.nodes", next);
                        }}
                      />
                    </td>
                    <td>
                      <input
                        value={n.notes || ""}
                        onChange={(e) => {
                          const next = [...nodes];
                          next[i] = { ...next[i], notes: e.target.value };
                          patch("infra.nodes", next);
                        }}
                      />
                    </td>
                    <td style={{ width: 1, whiteSpace: "nowrap" }}>
                      <button
                        type="button"
                        onClick={() => {
                          const next = nodes.filter((_, idx) => idx !== i);
                          patch("infra.nodes", next);
                        }}
                      >
                        Удалить
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button
            type="button"
            onClick={() =>
              patch("infra.nodes", [
                ...nodes,
                { name: "new-node", role: "worker", host: "", notes: "" },
              ])
            }
          >
            Добавить ноду
          </button>
        </div>
      </FieldRow>

      <FieldRow
        label="Пулы и лимиты"
        hint="Ограничения для воркеров/очередей и rate limit внешних API."
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
            <div className="muted" style={{ fontSize: 12 }}>
              Макс. воркеров печати
            </div>
            <NumberInput
              value={pools.maxWorkersPrints}
              min={0}
              max={999}
              onChange={(v) => patch("infra.pools.maxWorkersPrints", v)}
            />
          </div>

          <div>
            <div className="muted" style={{ fontSize: 12 }}>
              Макс. воркеров импорта
            </div>
            <NumberInput
              value={pools.maxWorkersImports}
              min={0}
              max={999}
              onChange={(v) => patch("infra.pools.maxWorkersImports", v)}
            />
          </div>

          <div>
            <div className="muted" style={{ fontSize: 12 }}>
              Макс. воркеров медиа
            </div>
            <NumberInput
              value={pools.maxWorkersMedia}
              min={0}
              max={999}
              onChange={(v) => patch("infra.pools.maxWorkersMedia", v)}
            />
          </div>

          <div>
            <div className="muted" style={{ fontSize: 12 }}>
              Макс. воркеров вебхуков
            </div>
            <NumberInput
              value={pools.maxWorkersWebhooks}
              min={0}
              max={999}
              onChange={(v) => patch("infra.pools.maxWorkersWebhooks", v)}
            />
          </div>

          <div>
            <div className="muted" style={{ fontSize: 12 }}>
              Лимит запросов к внешнему API (RPS)
            </div>
            <NumberInput
              value={pools.externalApiRateLimitRps}
              min={0}
              max={1000}
              step={1}
              onChange={(v) => patch("infra.pools.externalApiRateLimitRps", v)}
            />
          </div>
        </div>
      </FieldRow>

      <FieldRow
        label="Режим технических работ (maintenance)"
        hint="Ограничивает функции, но может разрешать чтение каталога."
      >
        <div style={{ display: "grid", gap: 10 }}>
          <Toggle
            value={maintenance.enabled}
            onChange={(v) => patch("infra.maintenance.enabled", v)}
            label="Включить режим техработ"
          />

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 12,
              maxWidth: 520,
            }}
          >
            <Toggle
              value={maintenance.allowCatalogRead}
              onChange={(v) => patch("infra.maintenance.allowCatalogRead", v)}
              label="Разрешить чтение каталога"
            />
            <Toggle
              value={maintenance.blockCheckout}
              onChange={(v) => patch("infra.maintenance.blockCheckout", v)}
              label="Запретить оформление заказа"
            />
          </div>

          <TextArea
            value={maintenance.message}
            onChange={(v) => patch("infra.maintenance.message", v)}
            rows={3}
            placeholder="Сообщение для пользователей"
          />
        </div>
      </FieldRow>
    </Card>
  );
}
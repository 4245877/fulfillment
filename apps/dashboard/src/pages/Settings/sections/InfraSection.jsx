// apps/dashboard/src/pages/settings/sections/InfraSection.jsx
import React from "react";
import Card from "../atoms/Card";
import FieldRow from "../atoms/FieldRow";
import Toggle from "../atoms/Toggle";
import { NumberInput, TextArea, TextInput } from "../atoms/inputs";

export default function InfraSection({ cfg, patch }) {
  return (
    <Card title="3) Інфраструктура (Servers/Topology)" sub="Ноди, ролі, пули/ліміти, режим технічних робіт">
      <FieldRow label="Список нод" hint="Назва, роль, хост. (UI-список; серверні дані підтягуються пізніше).">
        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Назва</th>
                  <th>Роль</th>
                  <th>Хост</th>
                  <th>Нотатки</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(cfg.infra.nodes || []).map((n, i) => (
                  <tr key={`${n.name}-${i}`}>
                    <td>
                      <input
                        value={n.name}
                        onChange={(e) => {
                          const next = [...cfg.infra.nodes];
                          next[i] = { ...next[i], name: e.target.value };
                          patch("infra.nodes", next);
                        }}
                      />
                    </td>
                    <td>
                      <select
                        value={n.role}
                        onChange={(e) => {
                          const next = [...cfg.infra.nodes];
                          next[i] = { ...next[i], role: e.target.value };
                          patch("infra.nodes", next);
                        }}
                      >
                        {["api", "worker", "db", "search", "printers", "media"].map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        value={n.host}
                        onChange={(e) => {
                          const next = [...cfg.infra.nodes];
                          next[i] = { ...next[i], host: e.target.value };
                          patch("infra.nodes", next);
                        }}
                      />
                    </td>
                    <td>
                      <input
                        value={n.notes || ""}
                        onChange={(e) => {
                          const next = [...cfg.infra.nodes];
                          next[i] = { ...next[i], notes: e.target.value };
                          patch("infra.nodes", next);
                        }}
                      />
                    </td>
                    <td style={{ width: 1, whiteSpace: "nowrap" }}>
                      <button
                        type="button"
                        onClick={() => {
                          const next = cfg.infra.nodes.filter((_, idx) => idx !== i);
                          patch("infra.nodes", next);
                        }}
                      >
                        Видалити
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button
            type="button"
            onClick={() => patch("infra.nodes", [...(cfg.infra.nodes || []), { name: "new-node", role: "worker", host: "", notes: "" }])}
          >
            Додати ноду
          </button>
        </div>
      </FieldRow>

      <FieldRow label="Пули та ліміти" hint="Обмеження на воркери/черги та rate-limit зовнішніх API.">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, maxWidth: 720 }}>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>maxWorkersPrints</div>
            <NumberInput value={cfg.infra.pools.maxWorkersPrints} min={0} max={999} onChange={(v) => patch("infra.pools.maxWorkersPrints", v)} />
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>maxWorkersImports</div>
            <NumberInput value={cfg.infra.pools.maxWorkersImports} min={0} max={999} onChange={(v) => patch("infra.pools.maxWorkersImports", v)} />
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>maxWorkersMedia</div>
            <NumberInput value={cfg.infra.pools.maxWorkersMedia} min={0} max={999} onChange={(v) => patch("infra.pools.maxWorkersMedia", v)} />
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>maxWorkersWebhooks</div>
            <NumberInput value={cfg.infra.pools.maxWorkersWebhooks} min={0} max={999} onChange={(v) => patch("infra.pools.maxWorkersWebhooks", v)} />
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>externalApiRateLimitRps</div>
            <NumberInput value={cfg.infra.pools.externalApiRateLimitRps} min={0} max={1000} step={1} onChange={(v) => patch("infra.pools.externalApiRateLimitRps", v)} />
          </div>
        </div>
      </FieldRow>

      <FieldRow label="Режим технічних робіт (maintenance)" hint="Обмежує функції, але може дозволити читання каталогу.">
        <div style={{ display: "grid", gap: 10 }}>
          <Toggle value={cfg.infra.maintenance.enabled} onChange={(v) => patch("infra.maintenance.enabled", v)} label="Увімкнути режим техробіт" />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, maxWidth: 520 }}>
            <Toggle value={cfg.infra.maintenance.allowCatalogRead} onChange={(v) => patch("infra.maintenance.allowCatalogRead", v)} label="Дозволити читання каталогу" />
            <Toggle value={cfg.infra.maintenance.blockCheckout} onChange={(v) => patch("infra.maintenance.blockCheckout", v)} label="Заборонити checkout" />
          </div>
          <TextArea value={cfg.infra.maintenance.message} onChange={(v) => patch("infra.maintenance.message", v)} rows={3} placeholder="Повідомлення для користувачів" />
        </div>
      </FieldRow>
    </Card>
  );
}

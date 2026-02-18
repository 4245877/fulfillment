// apps/dashboard/src/pages/settings/sections/PrintFarmSection.jsx
import React from "react";
import { Card, FieldRow, Toggle, ChipsEditor, NumberInput } from "../ui";
import { Card, FieldRow, Toggle, NumberInput } from "../ui";

export default function PrintFarmSection({ cfg, patch }) {
  return (
    <Card title="7) Виробництво / Print Farm" sub="Принтери, профілі, маршрутизація, SLA/тайм-аути">
      <FieldRow label="Принтери" hint="Маппінг принтерів, профілі сопел/матеріалів.">
        <div style={{ overflowX: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Назва</th>
                <th>Профіль</th>
                <th>Матеріал</th>
                <th>Увімкнено</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(cfg.printFarm.printers || []).map((p, i) => (
                <tr key={`${p.id}-${i}`}>
                  <td>
                    <input
                      value={p.id}
                      onChange={(e) => {
                        const next = [...cfg.printFarm.printers];
                        next[i] = { ...next[i], id: e.target.value };
                        patch("printFarm.printers", next);
                      }}
                    />
                  </td>
                  <td>
                    <input
                      value={p.name}
                      onChange={(e) => {
                        const next = [...cfg.printFarm.printers];
                        next[i] = { ...next[i], name: e.target.value };
                        patch("printFarm.printers", next);
                      }}
                    />
                  </td>
                  <td>
                    <input
                      value={p.profile}
                      onChange={(e) => {
                        const next = [...cfg.printFarm.printers];
                        next[i] = { ...next[i], profile: e.target.value };
                        patch("printFarm.printers", next);
                      }}
                    />
                  </td>
                  <td>
                    <input
                      value={p.material}
                      onChange={(e) => {
                        const next = [...cfg.printFarm.printers];
                        next[i] = { ...next[i], material: e.target.value };
                        patch("printFarm.printers", next);
                      }}
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={!!p.enabled}
                      onChange={(e) => {
                        const next = [...cfg.printFarm.printers];
                        next[i] = { ...next[i], enabled: e.target.checked };
                        patch("printFarm.printers", next);
                      }}
                      style={{ width: 18, height: 18 }}
                    />
                  </td>
                  <td style={{ width: 1, whiteSpace: "nowrap" }}>
                    <button
                      type="button"
                      onClick={() => {
                        const next = cfg.printFarm.printers.filter((_, idx) => idx !== i);
                        patch("printFarm.printers", next);
                      }}
                    >
                      Видалити
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <button
            type="button"
            onClick={() => patch("printFarm.printers", [...(cfg.printFarm.printers || []), { id: "new", name: "New printer", profile: "fdm-0.4", material: "PLA", enabled: true }])}
          >
            Додати принтер
          </button>
        </div>
      </FieldRow>

      <FieldRow label="Маршрутизація задач" hint="Прості правила: яка група принтерів для якого матеріалу.">
        <div style={{ display: "grid", gap: 8 }}>
          <div className="muted" style={{ fontSize: 12 }}>правила</div>
          <ChipsEditor
            value={(cfg.printFarm.routing.rules || []).map((r) => `${r.when} -> ${r.then}`)}
            onChange={(arr) => {
              const rules = arr.map((line) => {
                const [a, b] = String(line).split("->").map((x) => x.trim());
                return { when: a || "", then: b || "" };
              });
              patch("printFarm.routing.rules", rules);
            }}
            placeholder="material=PLA -> printerGroup=fdm-pla"
          />
        </div>
      </FieldRow>

      <FieldRow label="SLA / тайм-аути" hint="Автопауза при error, сповіщення про простій/помилки.">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, maxWidth: 720 }}>
          <div style={{ display: "flex", alignItems: "center" }}>
            <Toggle value={cfg.printFarm.sla.autoPauseOnError} onChange={(v) => patch("printFarm.sla.autoPauseOnError", v)} label="autoPauseOnError" />
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>idleNotifyMinutes</div>
            <NumberInput value={cfg.printFarm.sla.idleNotifyMinutes} min={0} max={100000} onChange={(v) => patch("printFarm.sla.idleNotifyMinutes", v)} />
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>errorNotifyMinutes</div>
            <NumberInput value={cfg.printFarm.sla.errorNotifyMinutes} min={0} max={100000} onChange={(v) => patch("printFarm.sla.errorNotifyMinutes", v)} />
          </div>
        </div>
      </FieldRow>
    </Card>
  );
}

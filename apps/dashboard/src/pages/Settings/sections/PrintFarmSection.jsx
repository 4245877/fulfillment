// apps/dashboard/src/pages/settings/sections/PrintFarmSection.jsx
import React from "react";
import { Card, FieldRow, Toggle, ChipsEditor, NumberInput } from "../ui.jsx";

export default function PrintFarmSection({ cfg, patch }) {
  return (
    <Card
      title="7) Производство / Печатная ферма"
      sub="Принтеры, профили, маршрутизация, SLA/тайм-ауты"
    >
      <FieldRow
        label="Принтеры"
        hint="Сопоставление принтеров, профили сопел и материалов."
      >
        <div style={{ overflowX: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Название</th>
                <th>Профиль</th>
                <th>Материал</th>
                <th>Включено</th>
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
                      Удалить
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <button
            type="button"
            onClick={() =>
              patch("printFarm.printers", [
                ...(cfg.printFarm.printers || []),
                {
                  id: "new",
                  name: "Новый принтер",
                  profile: "fdm-0.4",
                  material: "PLA",
                  enabled: true,
                },
              ])
            }
          >
            Добавить принтер
          </button>
        </div>
      </FieldRow>

      <FieldRow
        label="Маршрутизация задач"
        hint="Простые правила: какая группа принтеров подходит для какого материала."
      >
        <div style={{ display: "grid", gap: 8 }}>
          <div className="muted" style={{ fontSize: 12 }}>
            Правила
          </div>
          <ChipsEditor
            value={(cfg.printFarm.routing.rules || []).map((r) => `${r.when} -> ${r.then}`)}
            onChange={(arr) => {
              const rules = arr.map((line) => {
                const [a, b] = String(line)
                  .split("->")
                  .map((x) => x.trim());
                return { when: a || "", then: b || "" };
              });
              patch("printFarm.routing.rules", rules);
            }}
            placeholder="material=PLA -> printerGroup=fdm-pla"
          />
        </div>
      </FieldRow>

      <FieldRow
        label="SLA / тайм-ауты"
        hint="Автопауза при ошибке, уведомления о простое и ошибках."
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: 12,
            maxWidth: 720,
          }}
        >
          <div style={{ display: "flex", alignItems: "center" }}>
            <Toggle
              value={cfg.printFarm.sla.autoPauseOnError}
              onChange={(v) => patch("printFarm.sla.autoPauseOnError", v)}
              label="Автопауза при ошибке"
            />
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>
              Уведомление о простое (мин.)
            </div>
            <NumberInput
              value={cfg.printFarm.sla.idleNotifyMinutes}
              min={0}
              max={100000}
              onChange={(v) => patch("printFarm.sla.idleNotifyMinutes", v)}
            />
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>
              Уведомление об ошибке (мин.)
            </div>
            <NumberInput
              value={cfg.printFarm.sla.errorNotifyMinutes}
              min={0}
              max={100000}
              onChange={(v) => patch("printFarm.sla.errorNotifyMinutes", v)}
            />
          </div>
        </div>
      </FieldRow>
    </Card>
  );
}
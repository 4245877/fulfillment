import React from "react";
import styles from "../../Settings.module.css";
import { Card, FieldRow, Toggle, ChipsEditor, NumberInput } from "../ui.jsx";

const emptyPrinter = {
  id: "new-printer",
  name: "Новый принтер",
  profile: "fdm-0.4",
  material: "PLA",
  enabled: true,
};

const printerFields = [
  {
    key: "id",
    label: "ID",
    placeholder: "ender3-v3-ke",
  },
  {
    key: "name",
    label: "Название",
    placeholder: "Creality Ender 3 V3 KE",
  },
  {
    key: "profile",
    label: "Профиль",
    placeholder: "fdm-0.4",
  },
  {
    key: "material",
    label: "Материал",
    placeholder: "PLA / PETG",
  },
];

export default function PrintFarmSection({ cfg, patch }) {
  const printFarm = cfg.printFarm || {};
  const printers = Array.isArray(printFarm.printers) ? printFarm.printers : [];
  const routingRules = Array.isArray(printFarm.routing?.rules)
    ? printFarm.routing.rules
    : [];

  const updatePrinter = (index, key, value) => {
    const next = printers.map((printer, i) =>
      i === index ? { ...printer, [key]: value } : printer
    );

    patch("printFarm.printers", next);
  };

  const removePrinter = (index) => {
    const next = printers.filter((_, i) => i !== index);
    patch("printFarm.printers", next);
  };

  const addPrinter = () => {
    const nextIndex = printers.length + 1;

    patch("printFarm.printers", [
      ...printers,
      {
        ...emptyPrinter,
        id: `printer-${nextIndex}`,
        name: `Новый принтер ${nextIndex}`,
      },
    ]);
  };

  return (
    <Card
      title="7) Производство / Печатная ферма"
      sub="Принтеры, профили, маршрутизация, SLA/тайм-ауты"
    >
      <FieldRow
        label="Принтеры"
        hint="Сопоставление принтеров, профили сопел и материалов."
      >
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                {printerFields.map((field) => (
                  <th key={field.key}>{field.label}</th>
                ))}
                <th>Включено</th>
                <th />
              </tr>
            </thead>

            <tbody>
              {printers.length === 0 ? (
                <tr>
                  <td colSpan={printerFields.length + 2}>
                    <div className="muted">Принтеры пока не добавлены.</div>
                  </td>
                </tr>
              ) : (
                printers.map((printer, index) => (
                  <tr key={printer.id || index}>
                    {printerFields.map((field) => (
                      <td key={field.key}>
                        <input
                          className="input"
                          value={printer[field.key] || ""}
                          placeholder={field.placeholder}
                          onChange={(event) =>
                            updatePrinter(
                              index,
                              field.key,
                              event.target.value
                            )
                          }
                        />
                      </td>
                    ))}

                    <td>
                      <input
                        className="checkbox"
                        type="checkbox"
                        checked={!!printer.enabled}
                        onChange={(event) =>
                          updatePrinter(index, "enabled", event.target.checked)
                        }
                      />
                    </td>

                    <td style={{ width: 1, whiteSpace: "nowrap" }}>
                      <button
                        className="btn btn-secondary btn-sm"
                        type="button"
                        onClick={() => removePrinter(index)}
                      >
                        Удалить
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          <div className={styles.buttonGroup}>
            <button
              className="btn btn-primary btn-sm"
              type="button"
              onClick={addPrinter}
            >
              Добавить принтер
            </button>
          </div>
        </div>
      </FieldRow>

      <FieldRow
        label="Маршрутизация задач"
        hint="Простые правила: какая группа принтеров подходит для какого материала."
      >
        <div className={styles.inputGroup}>
          <div className={styles.inputLabel}>Правила</div>

          <ChipsEditor
            value={routingRules.map((rule) => `${rule.when} -> ${rule.then}`)}
            onChange={(items) => {
              const rules = items.map((line) => {
                const [when, then] = String(line)
                  .split("->")
                  .map((item) => item.trim());

                return {
                  when: when || "",
                  then: then || "",
                };
              });

              patch("printFarm.routing.rules", rules);
            }}
            placeholder="material=PLA -> printer=ender3-v3-ke"
          />
        </div>
      </FieldRow>

      <FieldRow
        label="SLA / тайм-ауты"
        hint="Автопауза при ошибке, уведомления о простое и ошибках."
      >
        <div className={`${styles.inputGrid3} ${styles.max720}`}>
          <div style={{ display: "flex", alignItems: "center" }}>
            <Toggle
              value={!!printFarm.sla?.autoPauseOnError}
              onChange={(value) =>
                patch("printFarm.sla.autoPauseOnError", value)
              }
              label="Автопауза при ошибке"
            />
          </div>

          <div>
            <div className={styles.inputLabel}>
              Уведомление о простое, мин.
            </div>
            <NumberInput
              value={printFarm.sla?.idleNotifyMinutes ?? 0}
              min={0}
              max={100000}
              onChange={(value) =>
                patch("printFarm.sla.idleNotifyMinutes", value)
              }
            />
          </div>

          <div>
            <div className={styles.inputLabel}>
              Уведомление об ошибке, мин.
            </div>
            <NumberInput
              value={printFarm.sla?.errorNotifyMinutes ?? 0}
              min={0}
              max={100000}
              onChange={(value) =>
                patch("printFarm.sla.errorNotifyMinutes", value)
              }
            />
          </div>
        </div>
      </FieldRow>
    </Card>
  );
}
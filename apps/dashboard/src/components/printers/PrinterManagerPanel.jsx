import React, { useEffect, useMemo, useState } from "react";
import {
  fetchPrinterConfigs,
  savePrinterConfigs,
  testPrinterConnection,
} from "../../api/printerFarmApi.js";

const DEFAULT_PRINTER = {
  id: "",
  name: "",
  model: "",
  imageUrl: "/printer-images/default-printer.png",
  protocol: "moonraker",
  host: "",
  port: 80,
  deviceUi: "",
  snapshotUrl: "",
  profile: "fdm-0.4",
  material: "PLA",
  nozzle: "0.4",
  enabled: true,
  apiKey: "",
  serial: "",
  accessCode: "",
};

const MODEL_PRESETS = [
  {
    model: "Creality Ender 3 V3 KE",
    imageUrl: "/printer-images/ender-3v3-ke.png",
    protocol: "moonraker",
    port: 80,
  },
  {
    model: "Creality K2",
    imageUrl: "/printer-images/k2.png",
    protocol: "moonraker",
    port: 4408,
  },
  {
    model: "Bambu Lab A1 Combo",
    imageUrl: "/printer-images/a1-combo.png",
    protocol: "bambu",
    port: 8883,
  },
];

function normalizeSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9а-яіїєґё]+/gi, "-")
    .replace(/^-+|-+$/g, "");
}

function makeIdFromName(name) {
  return normalizeSlug(name) || `printer-${Date.now()}`;
}

function makeEmptyPrinter() {
  return {
    ...DEFAULT_PRINTER,
    id: `printer-${Date.now()}`,
    name: "Новий принтер",
  };
}


export default function PrinterManagerPanel({ onChanged }) {
  const [printers, setPrinters] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [form, setForm] = useState(makeEmptyPrinter);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState("");

  const selectedPrinter = useMemo(
    () => printers.find((printer) => printer.id === selectedId) || null,
    [printers, selectedId]
  );

  useEffect(() => {
    let cancelled = false;

    async function loadPrinters() {
      try {
        const data = await fetchPrinterConfigs();

        if (cancelled) return;

        const items = Array.isArray(data?.printers) ? data.printers : [];
        setPrinters(items);

        if (items.length) {
          setSelectedId(items[0].id);
          setForm({
            ...DEFAULT_PRINTER,
            ...items[0],
          });
        }
      } catch (error) {
        if (!cancelled) {
          setMessage(
            error instanceof Error
              ? error.message
              : "Не вдалося завантажити список принтерів"
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadPrinters();

    return () => {
      cancelled = true;
    };
  }, []);

  const startCreate = () => {
    const next = makeEmptyPrinter();

    setSelectedId("");
    setForm(next);
    setMessage("");
  };

  const patchForm = (key, value) => {
    setForm((current) => {
      const next = {
        ...current,
        [key]: value,
      };

      if (key === "name" && (!current.id || current.id.startsWith("printer-"))) {
        next.id = makeIdFromName(value);
      }

      return next;
    });
  };

  const applyPreset = (preset) => {
    setForm((current) => ({
      ...current,
      model: preset.model,
      imageUrl: preset.imageUrl,
      protocol: preset.protocol,
      port: preset.port,
      name:
        current.name && current.name !== "Новий принтер"
          ? current.name
          : preset.model,
      id:
        current.id && !current.id.startsWith("printer-")
          ? current.id
          : makeIdFromName(preset.model),
    }));
  };

  const saveCurrent = async () => {
    const nextPrinter = {
      ...form,
      id: String(form.id || "").trim() || makeIdFromName(form.name),
      name: String(form.name || "").trim(),
      host: String(form.host || "").trim(),
      port: Number(form.port) || undefined,
      enabled: form.enabled !== false,
    };

    const duplicateId = printers.some(
      (printer) => printer.id === nextPrinter.id && printer.id !== selectedId
    );

    if (duplicateId) {
      setMessage("Принтер з таким ID уже існує.");
      return;
    }

    if (!nextPrinter.name || !nextPrinter.host) {
      setMessage("Заповни, будь ласка, назву та Хост / IP.");
      return;
    }

    setSaving(true);
    setMessage("");

    try {
      const exists = printers.some((printer) => printer.id === selectedId);

      const nextPrinters = exists
        ? printers.map((printer) =>
            printer.id === selectedId ? nextPrinter : printer
          )
        : [...printers, nextPrinter];

      const saved = await savePrinterConfigs(nextPrinters);
      const savedPrinters = Array.isArray(saved?.printers)
        ? saved.printers
        : nextPrinters;

      setPrinters(savedPrinters);
      setSelectedId(nextPrinter.id);
      setForm({
        ...DEFAULT_PRINTER,
        ...nextPrinter,
      });
      setMessage("Збережено.");
      onChanged?.();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Не вдалося зберегти принтер"
      );
    } finally {
      setSaving(false);
    }
  };

  const removeCurrent = async () => {
    if (!selectedPrinter) {
      startCreate();
      return;
    }

    const ok = window.confirm(`Видалити принтер "${selectedPrinter.name}"?`);

    if (!ok) return;

    setSaving(true);
    setMessage("");

    try {
      const nextPrinters = printers.filter(
        (printer) => printer.id !== selectedPrinter.id
      );

      const saved = await savePrinterConfigs(nextPrinters);
      const savedPrinters = Array.isArray(saved?.printers)
        ? saved.printers
        : nextPrinters;

      setPrinters(savedPrinters);

      if (savedPrinters.length) {
        setSelectedId(savedPrinters[0].id);
        setForm({
          ...DEFAULT_PRINTER,
          ...savedPrinters[0],
        });
      } else {
        startCreate();
      }

      setMessage("Видалено.");
      onChanged?.();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Не вдалося видалити принтер"
      );
    } finally {
      setSaving(false);
    }
  };

  const testCurrent = async () => {
    setTesting(true);
    setMessage("");

    try {
      const result = await testPrinterConnection({
        ...form,
        port: Number(form.port) || undefined,
      });

      if (result?.ok) {
        setMessage("З’єднання успішне.");
      } else {
        setMessage(
          result?.status?.error
            ? `Помилка: ${result.status.error}`
            : "Принтер не відповів."
        );
      }
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Не вдалося перевірити з’єднання"
      );
    } finally {
      setTesting(false);
    }
  };

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2 className="panel-title">
            <span className="panel-title-dot" />
            Керування 3D-принтерами
          </h2>
          <div className="panel-subtitle">
            Додавання, редагування, видалення та перевірка підключення
          </div>
        </div>

        <button
          className="btn btn-primary btn-sm"
          type="button"
          onClick={startCreate}
        >
          Додати принтер
        </button>
      </div>

      <div className="panel-body">
        {loading ? (
          <div className="alert-strip alert-strip--info">
            Завантажую список принтерів…
          </div>
        ) : null}

        <div className="printer-manager-layout">
          <div className="printer-manager-editor">
            <div className="printer-manager-preview">
              <img
                src={form.imageUrl || "/printer-images/default-printer.png"}
                alt={form.name || "3D-принтер"}
                onError={(event) => {
                  event.currentTarget.onerror = null;
                  event.currentTarget.src = "/printer-images/default-printer.png";
                }}
              />
            </div>

            <div className="printer-preset-grid">
              {MODEL_PRESETS.map((preset) => (
                <button
                  key={preset.model}
                  type="button"
                  className="printer-preset-card"
                  onClick={() => applyPreset(preset)}
                >
                  <img
                    src={preset.imageUrl}
                    alt={preset.model}
                    loading="lazy"
                    onError={(event) => {
                      event.currentTarget.onerror = null;
                      event.currentTarget.src = "/printer-images/default-printer.png";
                    }}
                  />
                  <span>{preset.model}</span>
                </button>
              ))}
            </div>

            <div className="printer-form-grid">
              <label>
                <span>Назва</span>
                <input
                  className="input"
                  value={form.name || ""}
                  onChange={(event) => patchForm("name", event.target.value)}
                  placeholder="Creality K2 PETG 0.4"
                />
              </label>

              <label>
                <span>ID</span>
                <input
                  className="input"
                  value={form.id || ""}
                  onChange={(event) => patchForm("id", event.target.value)}
                  placeholder="creality-k2-petg-04"
                />
              </label>

              <label>
                <span>Модель</span>
                <input
                  className="input"
                  value={form.model || ""}
                  onChange={(event) => patchForm("model", event.target.value)}
                  placeholder="Creality K2"
                />
              </label>

              <label>
                <span>Зображення</span>
                <input
                  className="input"
                  value={form.imageUrl || ""}
                  onChange={(event) => patchForm("imageUrl", event.target.value)}
                  placeholder="/printer-images/creality-k2.png"
                />
              </label>

              <label>
                <span>Протокол</span>
                <select
                  className="input"
                  value={form.protocol || "moonraker"}
                  onChange={(event) => patchForm("protocol", event.target.value)}
                >
                  <option value="moonraker">Moonraker / Klipper</option>
                  <option value="creality">Creality WebSocket</option>
                  <option value="bambu">Bambu MQTT</option>
                </select>
              </label>

              <label>
                <span>Хост / IP</span>
                <input
                  className="input"
                  value={form.host || ""}
                  onChange={(event) => patchForm("host", event.target.value)}
                  placeholder="192.168.0.132"
                />
              </label>

              <label>
                <span>Порт</span>
                <input
                  className="input"
                  type="number"
                  value={form.port ?? ""}
                  onChange={(event) => patchForm("port", event.target.value)}
                  placeholder="4408"
                />
              </label>

              <label>
                <span>Веб-інтерфейс</span>
                <input
                  className="input"
                  value={form.deviceUi || ""}
                  onChange={(event) => patchForm("deviceUi", event.target.value)}
                  placeholder="http://192.168.0.132"
                />
              </label>

              <label>
                <span>URL знімка камери</span>
                <input
                  className="input"
                  value={form.snapshotUrl || ""}
                  onChange={(event) =>
                    patchForm("snapshotUrl", event.target.value)
                  }
                  placeholder="http://go2rtc:1984/api/frame.jpeg?src=k2"
                />
              </label>

              <label>
                <span>Профіль</span>
                <input
                  className="input"
                  value={form.profile || ""}
                  onChange={(event) => patchForm("profile", event.target.value)}
                  placeholder="fdm-0.4"
                />
              </label>

              <label>
                <span>Матеріал</span>
                <input
                  className="input"
                  value={form.material || ""}
                  onChange={(event) => patchForm("material", event.target.value)}
                  placeholder="PLA / PETG"
                />
              </label>

              <label>
                <span>Сопло</span>
                <input
                  className="input"
                  value={form.nozzle || ""}
                  onChange={(event) => patchForm("nozzle", event.target.value)}
                  placeholder="0.4"
                />
              </label>

              <label>
                <span>API-ключ / пароль</span>
                <input
                  className="input"
                  type="password"
                  value={form.apiKey || ""}
                  onChange={(event) => patchForm("apiKey", event.target.value)}
                  placeholder="Moonraker API key, якщо потрібен"
                  autoComplete="new-password"
                />
              </label>

              {form.protocol === "bambu" ? (
                <>
                  <label>
                    <span>Серійний номер Bambu</span>
                    <input
                      className="input"
                      value={form.serial || ""}
                      onChange={(event) =>
                        patchForm("serial", event.target.value)
                      }
                      placeholder="Серійний номер"
                    />
                  </label>

                  <label>
                    <span>Код доступу Bambu</span>
                    <input
                      className="input"
                      type="password"
                      value={form.accessCode || ""}
                      onChange={(event) =>
                        patchForm("accessCode", event.target.value)
                      }
                      placeholder="Код доступу"
                      autoComplete="new-password"
                    />
                  </label>
                </>
              ) : null}
            </div>

            <label className="printer-enabled-row">
              <input
                className="checkbox"
                type="checkbox"
                checked={form.enabled !== false}
                onChange={(event) => patchForm("enabled", event.target.checked)}
              />
              <span>Принтер увімкнений</span>
            </label>

            <div className="printer-manager-actions">
              <button
                className="btn btn-primary"
                type="button"
                onClick={saveCurrent}
                disabled={loading || saving}
              >
                {saving ? "Зберігаю…" : "Зберегти"}
              </button>

              <button
                className="btn btn-secondary"
                type="button"
                onClick={testCurrent}
                disabled={loading || testing}
              >
                {testing ? "Перевіряю…" : "Перевірити підключення"}
              </button>

              {selectedPrinter ? (
                <button
                  className="btn btn-danger"
                  type="button"
                  onClick={removeCurrent}
                  disabled={loading || saving}
                >
                  Видалити
                </button>
              ) : null}
            </div>

            {message ? (
              <div className="printer-manager-message">{message}</div>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
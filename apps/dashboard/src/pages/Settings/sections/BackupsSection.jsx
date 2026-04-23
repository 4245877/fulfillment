// apps/dashboard/src/pages/settings/sections/BackupsSection.jsx
import React from "react";
import { Card, FieldRow, Toggle, NumberInput, Select, TextInput } from "../ui.jsx";

const includeLabels = {
  database: "База данных",
  uploads: "Загрузки",
  media: "Медиафайлы",
  config: "Конфигурация",
  logs: "Логи",
  cache: "Кэш",
};

export default function BackupsSection({ cfg, patch, doAction }) {
  const cronFromPreset = (preset) => {
    if (preset === "hourly") return "0 * * * *";
    if (preset === "daily") return "0 3 * * *";
    if (preset === "weekly") return "0 4 * * 0";
    return cfg.backups.cron;
  };

  return (
    <Card
      title="2) Резервные копии и хранилище"
      sub="Расписание, состав резервной копии, хранение, хранилище, ручные действия"
    >
      <FieldRow label="Расписание" hint="Готовый вариант или собственный cron.">
        <div style={{ display: "grid", gap: 10, maxWidth: 520 }}>
          <Select
            value={cfg.backups.schedulePreset}
            onChange={(v) => {
              patch("backups.schedulePreset", v);
              if (v !== "custom") patch("backups.cron", cronFromPreset(v));
            }}
            options={[
              { value: "hourly", label: "Каждый час" },
              { value: "daily", label: "Ежедневно" },
              { value: "weekly", label: "Еженедельно" },
              { value: "custom", label: "Пользовательский (cron)" },
            ]}
          />
          <TextInput
            value={cfg.backups.cron}
            onChange={(v) => patch("backups.cron", v)}
            placeholder="0 3 * * *"
          />
        </div>
      </FieldRow>

      <FieldRow
        label="Тип и состав резервной копии"
        hint="Полная/инкрементальная + что именно включать в резервную копию."
      >
        <div style={{ display: "grid", gap: 10 }}>
          <Select
            value={cfg.backups.mode}
            onChange={(v) => patch("backups.mode", v)}
            options={[
              { value: "full", label: "Полная" },
              { value: "incremental", label: "Инкрементальная" },
            ]}
          />

          <div style={{ display: "grid", gap: 6 }}>
            {Object.entries(cfg.backups.include).map(([k, v]) => (
              <Toggle
                key={k}
                value={v}
                onChange={(nv) => patch(`backups.include.${k}`, nv)}
                label={includeLabels[k] || k}
              />
            ))}
          </div>
        </div>
      </FieldRow>

      <FieldRow label="Окно выполнения" hint="Чтобы не мешать работе в часы пик.">
        <div style={{ display: "grid", gap: 10, maxWidth: 520 }}>
          <Toggle
            value={cfg.backups.window.avoidPeak}
            onChange={(v) => patch("backups.window.avoidPeak", v)}
            label="Избегать часов пик"
          />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <div className="text-muted" style={{ fontSize: 12 }}>
                начало
              </div>
              <TextInput
                value={cfg.backups.window.start}
                onChange={(v) => patch("backups.window.start", v)}
                placeholder="02:00"
              />
            </div>
            <div>
              <div className="text-muted" style={{ fontSize: 12 }}>
                конец
              </div>
              <TextInput
                value={cfg.backups.window.end}
                onChange={(v) => patch("backups.window.end", v)}
                placeholder="06:00"
              />
            </div>
          </div>
        </div>
      </FieldRow>

      <FieldRow label="Хранение" hint="Сколько хранить ежедневных, еженедельных и ежемесячных копий.">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, maxWidth: 520 }}>
          <div>
            <div className="text-muted" style={{ fontSize: 12 }}>
              ежедневно
            </div>
            <NumberInput
              value={cfg.backups.retention.daily}
              min={0}
              max={3650}
              onChange={(v) => patch("backups.retention.daily", v)}
            />
          </div>
          <div>
            <div className="text-muted" style={{ fontSize: 12 }}>
              еженедельно
            </div>
            <NumberInput
              value={cfg.backups.retention.weekly}
              min={0}
              max={520}
              onChange={(v) => patch("backups.retention.weekly", v)}
            />
          </div>
          <div>
            <div className="text-muted" style={{ fontSize: 12 }}>
              ежемесячно
            </div>
            <NumberInput
              value={cfg.backups.retention.monthly}
              min={0}
              max={240}
              onChange={(v) => patch("backups.retention.monthly", v)}
            />
          </div>
        </div>
      </FieldRow>

      <FieldRow
        label="Хранилище резервных копий"
        hint="S3/MinIO/файловая система. Ключи обычно хранятся на сервере — здесь только профиль."
      >
        <div style={{ display: "grid", gap: 12, maxWidth: 620 }}>
          <Select
            value={cfg.backups.storage.provider}
            onChange={(v) => patch("backups.storage.provider", v)}
            options={[
              { value: "minio", label: "MinIO" },
              { value: "s3", label: "S3" },
              { value: "filesystem", label: "Файловая система" },
            ]}
          />

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <div className="text-muted" style={{ fontSize: 12 }}>
                Бакет (bucket)
              </div>
              <TextInput
                value={cfg.backups.storage.bucket}
                onChange={(v) => patch("backups.storage.bucket", v)}
                placeholder="backups"
              />
            </div>
            <div>
              <div className="text-muted" style={{ fontSize: 12 }}>
                Путь (path)
              </div>
              <TextInput
                value={cfg.backups.storage.path}
                onChange={(v) => patch("backups.storage.path", v)}
                placeholder="fulfillment/"
              />
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <div className="text-muted" style={{ fontSize: 12 }}>
                Профиль шифрования
              </div>
              <TextInput
                value={cfg.backups.storage.encryptionProfile}
                onChange={(v) => patch("backups.storage.encryptionProfile", v)}
                placeholder="server-managed"
              />
            </div>
            <div>
              <div className="text-muted" style={{ fontSize: 12 }}>
                Профиль ключа
              </div>
              <TextInput
                value={cfg.backups.storage.keyProfile}
                onChange={(v) => patch("backups.storage.keyProfile", v)}
                placeholder="default"
              />
            </div>
          </div>
        </div>
      </FieldRow>

      <FieldRow
        label="Ручные действия"
        hint="Пока что кнопки вызывают API-эндпоинты, если они реализованы."
      >
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            className="btn btn-primary btn-sm"
            type="button"
            onClick={() =>
              doAction({
                title: "Запустить резервное копирование сейчас",
                description: "Немедленно запустить резервное копирование.",
                url: "/api/ops/backup/run",
                body: { scope: cfg.backups.include, mode: cfg.backups.mode },
              })
            }
          >
            Запустить резервное копирование
          </button>

          <button
            className="btn btn-secondary btn-sm"
            type="button"
            onClick={() =>
              doAction({
                title: "Тестовое восстановление",
                description: "Тестовое восстановление в песочнице (если доступно).",
                url: "/api/ops/backup/test-restore",
                body: { profile: cfg.backups.storage.keyProfile },
              })
            }
          >
            Тестовое восстановление
          </button>
        </div>
      </FieldRow>
    </Card>
  );
}
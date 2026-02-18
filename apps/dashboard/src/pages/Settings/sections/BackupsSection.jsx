// apps/dashboard/src/pages/settings/sections/BackupsSection.jsx
import React from "react";
import { Card, FieldRow, Toggle, NumberInput, Select, TextInput } from "../ui";


export default function BackupsSection({ cfg, patch, doAction }) {
  const cronFromPreset = (preset) => {
    if (preset === "hourly") return "0 * * * *";
    if (preset === "daily") return "0 3 * * *";
    if (preset === "weekly") return "0 4 * * 0";
    return cfg.backups.cron;
  };

  return (
    <Card title="2) Резервні копії та зберігання" sub="Розклад, склад резервної копії, ретеншн, сховище, ручні дії">
      <FieldRow label="Розклад" hint="Preset або власний cron.">
        <div style={{ display: "grid", gap: 10, maxWidth: 520 }}>
          <Select
            value={cfg.backups.schedulePreset}
            onChange={(v) => {
              patch("backups.schedulePreset", v);
              if (v !== "custom") patch("backups.cron", cronFromPreset(v));
            }}
            options={[
              { value: "hourly", label: "hourly" },
              { value: "daily", label: "daily" },
              { value: "weekly", label: "weekly" },
              { value: "custom", label: "custom (cron)" },
            ]}
          />
          <TextInput value={cfg.backups.cron} onChange={(v) => patch("backups.cron", v)} placeholder="0 3 * * *" />
        </div>
      </FieldRow>

      <FieldRow label="Тип і склад резервної копії" hint="Full/incremental + що саме резервуємо.">
        <div style={{ display: "grid", gap: 10 }}>
          <Select
            value={cfg.backups.mode}
            onChange={(v) => patch("backups.mode", v)}
            options={[
              { value: "full", label: "full" },
              { value: "incremental", label: "incremental" },
            ]}
          />

          <div style={{ display: "grid", gap: 6 }}>
            {Object.entries(cfg.backups.include).map(([k, v]) => (
              <Toggle key={k} value={v} onChange={(nv) => patch(`backups.include.${k}`, nv)} label={k} />
            ))}
          </div>
        </div>
      </FieldRow>

      <FieldRow label="Вікно виконання" hint="Щоб не заважати піковим годинам.">
        <div style={{ display: "grid", gap: 10, maxWidth: 520 }}>
          <Toggle value={cfg.backups.window.avoidPeak} onChange={(v) => patch("backups.window.avoidPeak", v)} label="Уникати піку" />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>початок</div>
              <TextInput value={cfg.backups.window.start} onChange={(v) => patch("backups.window.start", v)} placeholder="02:00" />
            </div>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>кінець</div>
              <TextInput value={cfg.backups.window.end} onChange={(v) => patch("backups.window.end", v)} placeholder="06:00" />
            </div>
          </div>
        </div>
      </FieldRow>

      <FieldRow label="Ретеншн" hint="Скільки зберігати daily/weekly/monthly.">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, maxWidth: 520 }}>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>daily</div>
            <NumberInput value={cfg.backups.retention.daily} min={0} max={3650} onChange={(v) => patch("backups.retention.daily", v)} />
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>weekly</div>
            <NumberInput value={cfg.backups.retention.weekly} min={0} max={520} onChange={(v) => patch("backups.retention.weekly", v)} />
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>monthly</div>
            <NumberInput value={cfg.backups.retention.monthly} min={0} max={240} onChange={(v) => patch("backups.retention.monthly", v)} />
          </div>
        </div>
      </FieldRow>

      <FieldRow label="Сховище резервних копій" hint="S3/MinIO/Filesystem. Ключі зазвичай зберігаються на сервері — тут лише профіль.">
        <div style={{ display: "grid", gap: 12, maxWidth: 620 }}>
          <Select
            value={cfg.backups.storage.provider}
            onChange={(v) => patch("backups.storage.provider", v)}
            options={[
              { value: "minio", label: "minio" },
              { value: "s3", label: "s3" },
              { value: "filesystem", label: "filesystem" },
            ]}
          />

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Бакет (bucket)</div>
              <TextInput value={cfg.backups.storage.bucket} onChange={(v) => patch("backups.storage.bucket", v)} placeholder="backups" />
            </div>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Шлях (path)</div>
              <TextInput value={cfg.backups.storage.path} onChange={(v) => patch("backups.storage.path", v)} placeholder="fulfillment/" />
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Профіль шифрування</div>
              <TextInput value={cfg.backups.storage.encryptionProfile} onChange={(v) => patch("backups.storage.encryptionProfile", v)} placeholder="server-managed" />
            </div>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Профіль ключа</div>
              <TextInput value={cfg.backups.storage.keyProfile} onChange={(v) => patch("backups.storage.keyProfile", v)} placeholder="default" />
            </div>
          </div>
        </div>
      </FieldRow>

      <FieldRow label="Ручні дії" hint="Поки що кнопки викликають API-ендпоїнти, якщо вони реалізовані.">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            className="buttonPrimary"
            type="button"
            onClick={() =>
              doAction({
                title: "Запустити бекап зараз",
                description: "Запустити резервне копіювання негайно.",
                url: "/api/ops/backup/run",
                body: { scope: cfg.backups.include, mode: cfg.backups.mode },
              })
            }
          >
            Запустити бекап
          </button>

          <button
            type="button"
            onClick={() =>
              doAction({
                title: "Тестове відновлення",
                description: "Тестове відновлення у пісочниці (якщо є).",
                url: "/api/ops/backup/test-restore",
                body: { profile: cfg.backups.storage.keyProfile },
              })
            }
          >
            Тестове відновлення
          </button>
        </div>
      </FieldRow>
    </Card>
  );
}

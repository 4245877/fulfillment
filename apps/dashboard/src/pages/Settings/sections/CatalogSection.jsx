// apps/dashboard/src/pages/settings/sections/CatalogSection.jsx
import React from "react";
import { Card, FieldRow, Toggle, ChipsEditor, NumberInput, Select, TextInput } from "../ui.jsx";

const ingesterFieldLabels = {
  batchSizeRows: "Розмір пакета (рядків)",
  concurrency: "Паралелізм",
};

const mediaFieldLabels = {
  maxFileMb: "Максимальний розмір файлу (МБ)",
  retries: "Кількість повторних спроб",
  allowedFormats: "Дозволені формати",
  queue: "Черга",
};

const indexerFieldLabels = {
  shards: "Шарди",
  replicas: "Репліки",
  ratePerMin: "Ліміт за хвилину",
  reindexMode: "Режим переіндексації",
  stopWordsProfile: "Профіль стоп-слів",
  indexedFields: "Індексовані поля",
};

const retentionFieldLabels = {
  importLogsDays: "Журнали імпорту (днів)",
  importErrorsDays: "Помилки імпорту (днів)",
  auditDays: "Аудит (днів)",
};

const normalizeLabels = {
  trim: "Обрізати пробіли",
  lowercase: "Приводити до нижнього регістру",
  uppercase: "Приводити до верхнього регістру",
  collapseSpaces: "Стискати пробіли",
  removeHtml: "Видаляти HTML",
  stripHtml: "Видаляти HTML-розмітку",
  removeAccents: "Видаляти діакритику",
  transliterate: "Транслітерувати",
  normalizeUnicode: "Нормалізувати Unicode",
  dedupe: "Видаляти дублікати",
};

export default function CatalogSection({ cfg, patch }) {
  return (
    <Card
      title="6) Каталог 3M SKU: індексатор / завантажувач / імпорт"
      sub="Пакети, паралелізм, нормалізація, медіа, індекс, зберігання журналів"
    >
      <FieldRow
        label="Завантажувач"
        hint="Розмір пакета, паралелізм, правила нормалізації, медіаконвеєр."
      >
        <div style={{ display: "grid", gap: 12 }}>
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
                {ingesterFieldLabels.batchSizeRows}
              </div>
              <NumberInput
                value={cfg.catalog.ingester.batchSizeRows}
                min={1}
                max={1000000}
                step={100}
                onChange={(v) => patch("catalog.ingester.batchSizeRows", v)}
              />
            </div>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>
                {ingesterFieldLabels.concurrency}
              </div>
              <NumberInput
                value={cfg.catalog.ingester.concurrency}
                min={1}
                max={256}
                onChange={(v) => patch("catalog.ingester.concurrency", v)}
              />
            </div>
          </div>

          <div className="card" style={{ padding: 12 }}>
            <div style={{ fontWeight: 800, marginBottom: 8 }}>Нормалізація</div>
            <div style={{ display: "grid", gap: 6 }}>
              {Object.entries(cfg.catalog.ingester.normalize).map(([k, v]) => (
                <Toggle
                  key={k}
                  value={v}
                  onChange={(nv) => patch(`catalog.ingester.normalize.${k}`, nv)}
                  label={normalizeLabels[k] || k}
                />
              ))}
            </div>
          </div>

          <div className="card" style={{ padding: 12 }}>
            <div style={{ fontWeight: 800, marginBottom: 8 }}>Медіа</div>
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
                  {mediaFieldLabels.maxFileMb}
                </div>
                <NumberInput
                  value={cfg.catalog.ingester.media.maxFileMb}
                  min={1}
                  max={2000}
                  onChange={(v) => patch("catalog.ingester.media.maxFileMb", v)}
                />
              </div>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>
                  {mediaFieldLabels.retries}
                </div>
                <NumberInput
                  value={cfg.catalog.ingester.media.retries}
                  min={0}
                  max={100}
                  onChange={(v) => patch("catalog.ingester.media.retries", v)}
                />
              </div>
            </div>

            <div style={{ marginTop: 10 }}>
              <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
                {mediaFieldLabels.allowedFormats}
              </div>
              <ChipsEditor
                value={cfg.catalog.ingester.media.allowedFormats}
                onChange={(arr) => patch("catalog.ingester.media.allowedFormats", arr)}
                placeholder="jpg"
              />
            </div>

            <div style={{ marginTop: 10, maxWidth: 320 }}>
              <div className="muted" style={{ fontSize: 12 }}>
                {mediaFieldLabels.queue}
              </div>
              <TextInput
                value={cfg.catalog.ingester.media.queue}
                onChange={(v) => patch("catalog.ingester.media.queue", v)}
                placeholder="media"
              />
            </div>
          </div>
        </div>
      </FieldRow>

      <FieldRow
        label="Індексатор / пошук"
        hint="Шарди/репліки, ліміт за хвилину, часткова/повна переіндексація, поля індексу."
      >
        <div style={{ display: "grid", gap: 12 }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gap: 12,
              maxWidth: 720,
            }}
          >
            <div>
              <div className="muted" style={{ fontSize: 12 }}>
                {indexerFieldLabels.shards}
              </div>
              <NumberInput
                value={cfg.catalog.indexer.shards}
                min={1}
                max={200}
                onChange={(v) => patch("catalog.indexer.shards", v)}
              />
            </div>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>
                {indexerFieldLabels.replicas}
              </div>
              <NumberInput
                value={cfg.catalog.indexer.replicas}
                min={0}
                max={10}
                onChange={(v) => patch("catalog.indexer.replicas", v)}
              />
            </div>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>
                {indexerFieldLabels.ratePerMin}
              </div>
              <NumberInput
                value={cfg.catalog.indexer.ratePerMin}
                min={0}
                max={10000000}
                step={100}
                onChange={(v) => patch("catalog.indexer.ratePerMin", v)}
              />
            </div>
          </div>

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
                {indexerFieldLabels.reindexMode}
              </div>
              <Select
                value={cfg.catalog.indexer.reindexMode}
                onChange={(v) => patch("catalog.indexer.reindexMode", v)}
                options={[
                  { value: "partial", label: "Часткова" },
                  { value: "full", label: "Повна" },
                ]}
              />
            </div>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>
                {indexerFieldLabels.stopWordsProfile}
              </div>
              <TextInput
                value={cfg.catalog.indexer.stopWordsProfile}
                onChange={(v) => patch("catalog.indexer.stopWordsProfile", v)}
                placeholder="default"
              />
            </div>
          </div>

          <div>
            <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
              {indexerFieldLabels.indexedFields}
            </div>
            <ChipsEditor
              value={cfg.catalog.indexer.indexedFields}
              onChange={(arr) => patch("catalog.indexer.indexedFields", arr)}
              placeholder="sku"
            />
          </div>
        </div>
      </FieldRow>

      <FieldRow
        label="Зберігання даних / аудит"
        hint="Скільки зберігати журнали імпорту, помилки та дані аудиту."
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: 12,
            maxWidth: 720,
          }}
        >
          <div>
            <div className="muted" style={{ fontSize: 12 }}>
              {retentionFieldLabels.importLogsDays}
            </div>
            <NumberInput
              value={cfg.catalog.retention.importLogsDays}
              min={0}
              max={3650}
              onChange={(v) => patch("catalog.retention.importLogsDays", v)}
            />
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>
              {retentionFieldLabels.importErrorsDays}
            </div>
            <NumberInput
              value={cfg.catalog.retention.importErrorsDays}
              min={0}
              max={3650}
              onChange={(v) => patch("catalog.retention.importErrorsDays", v)}
            />
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>
              {retentionFieldLabels.auditDays}
            </div>
            <NumberInput
              value={cfg.catalog.retention.auditDays}
              min={0}
              max={3650}
              onChange={(v) => patch("catalog.retention.auditDays", v)}
            />
          </div>
        </div>
      </FieldRow>
    </Card>
  );
}
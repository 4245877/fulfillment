// apps/dashboard/src/pages/settings/sections/CatalogSection.jsx
import React from "react";
import { Card, FieldRow, Toggle, ChipsEditor, NumberInput, Select, TextInput } from "../ui.jsx";


export default function CatalogSection({ cfg, patch }) {
  return (
    <Card title="6) Каталог 3M SKU: Indexer / Ingester / Import" sub="Пакети, паралельність, нормалізація, медіа, індекс, ретеншн логів">
      <FieldRow label="Ingester" hint="Batch size, паралельність, правила нормалізації, медіа-пайплайн.">
        <div style={{ display: "grid", gap: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, maxWidth: 720 }}>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>batchSizeRows</div>
              <NumberInput value={cfg.catalog.ingester.batchSizeRows} min={1} max={1000000} step={100} onChange={(v) => patch("catalog.ingester.batchSizeRows", v)} />
            </div>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>concurrency</div>
              <NumberInput value={cfg.catalog.ingester.concurrency} min={1} max={256} onChange={(v) => patch("catalog.ingester.concurrency", v)} />
            </div>
          </div>

          <div className="card" style={{ padding: 12 }}>
            <div style={{ fontWeight: 800, marginBottom: 8 }}>Нормалізація</div>
            <div style={{ display: "grid", gap: 6 }}>
              {Object.entries(cfg.catalog.ingester.normalize).map(([k, v]) => (
                <Toggle key={k} value={v} onChange={(nv) => patch(`catalog.ingester.normalize.${k}`, nv)} label={k} />
              ))}
            </div>
          </div>

          <div className="card" style={{ padding: 12 }}>
            <div style={{ fontWeight: 800, marginBottom: 8 }}>Медіа</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, maxWidth: 720 }}>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>maxFileMb</div>
                <NumberInput value={cfg.catalog.ingester.media.maxFileMb} min={1} max={2000} onChange={(v) => patch("catalog.ingester.media.maxFileMb", v)} />
              </div>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>retries</div>
                <NumberInput value={cfg.catalog.ingester.media.retries} min={0} max={100} onChange={(v) => patch("catalog.ingester.media.retries", v)} />
              </div>
            </div>

            <div style={{ marginTop: 10 }}>
              <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>allowedFormats</div>
              <ChipsEditor value={cfg.catalog.ingester.media.allowedFormats} onChange={(arr) => patch("catalog.ingester.media.allowedFormats", arr)} placeholder="jpg" />
            </div>

            <div style={{ marginTop: 10, maxWidth: 320 }}>
              <div className="muted" style={{ fontSize: 12 }}>queue</div>
              <TextInput value={cfg.catalog.ingester.media.queue} onChange={(v) => patch("catalog.ingester.media.queue", v)} placeholder="media" />
            </div>
          </div>
        </div>
      </FieldRow>

      <FieldRow label="Indexer / Search" hint="shards/replicas, rate/min, partial/full reindex, поля індексу.">
        <div style={{ display: "grid", gap: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, maxWidth: 720 }}>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>shards</div>
              <NumberInput value={cfg.catalog.indexer.shards} min={1} max={200} onChange={(v) => patch("catalog.indexer.shards", v)} />
            </div>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>replicas</div>
              <NumberInput value={cfg.catalog.indexer.replicas} min={0} max={10} onChange={(v) => patch("catalog.indexer.replicas", v)} />
            </div>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>ratePerMin</div>
              <NumberInput value={cfg.catalog.indexer.ratePerMin} min={0} max={10000000} step={100} onChange={(v) => patch("catalog.indexer.ratePerMin", v)} />
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, maxWidth: 720 }}>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>reindexMode</div>
              <Select
                value={cfg.catalog.indexer.reindexMode}
                onChange={(v) => patch("catalog.indexer.reindexMode", v)}
                options={[
                  { value: "partial", label: "partial" },
                  { value: "full", label: "full" },
                ]}
              />
            </div>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>stopWordsProfile</div>
              <TextInput value={cfg.catalog.indexer.stopWordsProfile} onChange={(v) => patch("catalog.indexer.stopWordsProfile", v)} placeholder="default" />
            </div>
          </div>

          <div>
            <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>indexedFields</div>
            <ChipsEditor value={cfg.catalog.indexer.indexedFields} onChange={(arr) => patch("catalog.indexer.indexedFields", arr)} placeholder="sku" />
          </div>
        </div>
      </FieldRow>

      <FieldRow label="Data retention / audit" hint="Скільки тримати логи імпорту/помилок та аудит.">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, maxWidth: 720 }}>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>importLogsDays</div>
            <NumberInput value={cfg.catalog.retention.importLogsDays} min={0} max={3650} onChange={(v) => patch("catalog.retention.importLogsDays", v)} />
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>importErrorsDays</div>
            <NumberInput value={cfg.catalog.retention.importErrorsDays} min={0} max={3650} onChange={(v) => patch("catalog.retention.importErrorsDays", v)} />
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>auditDays</div>
            <NumberInput value={cfg.catalog.retention.auditDays} min={0} max={3650} onChange={(v) => patch("catalog.retention.auditDays", v)} />
          </div>
        </div>
      </FieldRow>
    </Card>
  );
}

import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import Widget from "./components/Widget.jsx";
import Bar from "./components/Bar.jsx";
import { api, openSSE } from "./api.js";
import { useSSE } from "./hooks/useSSE.js";

function Pill({ text, tone="info" }){ return <span className={`badge ${tone}`}>{text}</span>; }
function Num({ children }){ return <span className="num">{children}</span>; }

function Header({ stats }) {
  const now = new Date().toLocaleTimeString();
  return (
    <header className="header">
      <div className="title">
        <span>DRUKARNYA • Operations Wallboard</span>
        <span className="pill">Обновлено: {now}</span>
      </div>
      <div className="row">
        <Pill text={`Printing: ${stats?.printing ?? 0}`} tone="ok" />
        <Pill text={`Queued: ${stats?.queued ?? 0}`} tone="info" />
        <Pill text={`Done: ${stats?.done ?? 0}`} tone="ok" />
      </div>
    </header>
  );
}

function SectionOrders({ data = {} }) {
  const o = data.orders || {};
  const items = [
    ["PrePrintCheck", o.PrePrintCheck||0],
    ["Queued",        o.Queued||0],
    ["Printing",      o.Printing||0],
    ["PostProcess",   o.PostProcess||0],
    ["Packaging",     o.Packaging||0],
    ["Shipment",      o.Shipment||0],
    ["Pickup",        o.Pickup||0],
    ["Delivered",     o.Delivered||0],
    ["Issued",        o.Issued||0],
  ];
  return (
    <Widget title="Замовлення — конвеєр" sub="Фонтан по етапам">
      <div className="kpi">
        {items.map(([k,v])=>(
          <div key={k} className="box">
            <div className="small">{k}</div>
            <div className="num">{v}</div>
          </div>
        ))}
      </div>
    </Widget>
  );
}

function SectionPrintFarm({ printers = [], jobs = [] }) {
  return (
    <Widget title="3D Ферма — принтери та роботи" sub="Стани обладнання і прогрес завдань">
      <div className="list"> {/* было style={{marginTop:8}} — больше не нужно */}
        {printers.map(p=>(
          <div key={p.id} className="row row--tight"> {/* было style={{gap:8}} */}
            <strong>{p.name}</strong>
            <span className="small">{p.model} • {p.nozzle || "n/a"}</span>
            <Pill text={p.state || "unknown"} tone={p.state==="printing"?"ok":p.state==="error"?"danger":"info"} />
            <span className="small">{p.material_color||"-"}</span>
          </div>
        ))}
      </div>

      <table className="table table--jobs">
        <colgroup>
          <col className="col-order" />
          <col className="col-sku" />
          <col className="col-printer" />
          <col className="col-prog" />
          <col className="col-eta" />
        </colgroup>
        <thead>
          <tr>
            <th>Замовлення</th>
            <th>SKU×Qty</th>
            <th>Принтер</th>
            <th>Прогрес</th>
            <th>ETA</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map(j=>(
            <tr key={j.id}>
              <td>{j.order_number}</td>
              <td>{j.sku} ×{j.qty}</td>
              <td>{j.printer_name||"—"}</td>
              <td><Bar v={j.progress||0}/></td> {/* minWidth удалён — теперь через colgroup */}
              <td>{j.eta||"—"}</td>
            </tr>
          ))}
          {!jobs.length && <tr><td colSpan="5" className="small">Немає активних завдань.</td></tr>}
        </tbody>
      </table>
    </Widget>
  );
}

function SectionQueues({ q = {} }) {
  const rows = [
    ["prints",   q.prints?.ready ?? 0, q.prints?.running ?? 0, q.prints?.lagMs ?? 0],
    ["imports",  q.imports?.backlog ?? 0, "—", q.imports?.lagMs ?? 0],
    ["media",    q.media?.backlog ?? 0, "—", q.media?.lagMs ?? 0],
    ["webhooks", q.webhooks?.backlog ?? 0, "—", q.webhooks?.lagMs ?? 0],
    ["notify",   q.notify?.backlog ?? 0, "—", q.notify?.lagMs ?? 0],
  ];
  const tone = (ms)=> ms>60000?"danger": ms>5000?"warn":"ok";
  return (
    <Widget title="Черги та відставання" sub="Lag і розміри черг">
      <table className="table table--queues">
        <colgroup>
          <col className="col-name" />
          <col className="col-ready" />
          <col className="col-run" />
          <col className="col-lag" />
        </colgroup>
        <thead>
          <tr><th>Черга</th><th>Ready</th><th>Running</th><th>Lag</th></tr>
        </thead>
        <tbody>
          {rows.map(([name, ready, running, lag])=>(
            <tr key={name}>
              <td>{name}</td>
              <td>{ready}</td>
              <td>{running}</td>
              <td><Pill tone={tone(lag)} text={`${lag} ms`} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Widget>
  );
}

function SectionMaterials({ m = {} }) {
  const low = m.low || [];
  return (
    <Widget title="Матеріали" sub="Запаси філаменту/смоли і дефіцит">
      <div className="kpi">
        <div className="box">
          <div className="small">Філамент</div>
          <div className="num">{(m.filamentKg ?? 0).toFixed(1)} кг</div>
        </div>
        <div className="box">
          <div className="small">Смола</div>
          <div className="num">{(m.resinL ?? 0).toFixed(1)} л</div>
        </div>
        <div className="box">
          <div className="small">Ролики в роботі</div>
          <div className="num">{m.reelsInUse ?? 0}</div>
        </div>
        <div className="box">
          <div className="small">Поріг дефіциту</div>
          <div className="num">{m.lowThresholdKg ?? 1.0} кг</div>
        </div>
      </div>
      <div className="list">
        {low.map((x, i)=>(
          <div key={i} className="row">
            <span className="small">{x.material}</span>
            <Pill tone="warn" text={`${x.remainKg} кг`} />
          </div>
        ))}
        {!low.length && <div className="small">Дефіциту не виявлено.</div>}
      </div>
    </Widget>
  );
}

function SectionLogistics({ l = {} }) {
  const items = [
    ["new", l.new || 0], ["inTransit", l.inTransit || 0],
    ["delivered", l.delivered || 0], ["problem", l.problem || 0],
  ];
  return (
    <Widget title="Логістика" sub="Статуси відправлень і проблеми">
      <div className="kpi">
        {items.map(([k,v])=>(
          <div key={k} className="box">
            <div className="small">{k}</div>
            <div className="num">{v}</div>
          </div>
        ))}
      </div>
      {l.byCarrier && (
        <table className="table">
          <thead>
            <tr><th>Перевізник</th><th>New</th><th>InTransit</th><th>Delivered</th><th>Problem</th></tr>
          </thead>
          <tbody>
            {Object.entries(l.byCarrier).map(([c,s])=>(
              <tr key={c}>
                <td>{c}</td>
                <td>{s.new||0}</td>
                <td>{s.inTransit||0}</td>
                <td>{s.delivered||0}</td>
                <td>{s.problem||0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Widget>
  );
}

function SectionPayments({ p = {} }) {
  return (
    <Widget title="Оплати" sub="Передоплата та доплати перед відвантаженням">
      <div className="kpi">
        <div className="box"><div className="small">Очікує 25%</div><div className="num">{p.awaitingPrepay||0}</div></div>
        <div className="box"><div className="small">Очікує доплату</div><div className="num">{p.awaitingRest||0}</div></div>
        <div className="box"><div className="small">Disputes</div><div className="num">{p.disputes||0}</div></div>
        <div className="box"><div className="small">Середній чек</div><div className="num">{p.avgCheckUAH||0} ₴</div></div>
      </div>
    </Widget>
  );
}

function SectionServices({ s = {} }) {
  const asPill = (v)=> v==="up" ? <Pill text="UP" tone="ok"/> :
                          v==="degraded" ? <Pill text="DEGRADED" tone="warn"/> :
                          <Pill text={String(v||"down").toUpperCase()} tone="danger"/>;
  const rows = [
    ["Shop API", s.shop], ["Fulfillment API", s.fulfillment],
    ["Printers Net", s.printers], ["PostgreSQL", s.db],
    ["Redis", s.redis], ["Search Indexer", s.indexer],
  ];
  return (
    <Widget title="Сервіси та здоров'я" sub="Uptime і стан контурів">
      <table className="table">
        <thead><tr><th>Сервіс</th><th>Статус</th></tr></thead>
        <tbody>
          {rows.map(([n,v])=> (<tr key={n}><td>{n}</td><td>{asPill(v)}</td></tr>))}
        </tbody>
      </table>
    </Widget>
  );
}

function SectionIndexer({ idx = {} }) {
  return (
    <Widget title="Пошуковий індекс" sub="Беклог індексації каталогу">
      <div className="kpi">
        <div className="box"><div className="small">Backlog</div><div className="num">{idx.backlog||0}</div></div>
        <div className="box"><div className="small">Оновлено</div><div className="num">{idx.lastIndexedAt||"—"}</div></div>
        <div className="box"><div className="small">Швидкість</div><div className="num">{idx.ratePerMin||0}/m</div></div>
        <div className="box"><div className="small">Шард</div><div className="num">{idx.shards||1}</div></div>
      </div>
    </Widget>
  );
}

function SectionIngester({ ing = {} }) {
  const batches = ing.batches || [];
  return (
    <Widget title="Імпорт/Ingester" sub="CSV, медіа, нормалізація">
      <table className="table">
        <thead><tr><th>Batch</th><th>Rows</th><th>OK</th><th>Fail</th><th>Тривалість</th></tr></thead>
        <tbody>
          {batches.map(b=>(
            <tr key={b.id}>
              <td>{b.id}</td>
              <td>{b.rows||0}</td>
              <td>{b.ok||0}</td>
              <td>{b.fail||0}</td>
              <td>{b.duration||"—"}</td>
            </tr>
          ))}
          {!batches.length && <tr><td colSpan="5" className="small">Немає останніх пакетів.</td></tr>}
        </tbody>
      </table>
      <div className="kpi"> {/* было style={{marginTop:8}} */}
        <div className="box"><div className="small">Media backlog</div><div className="num">{ing.mediaBacklog||0}</div></div>
        <div className="box"><div className="small">Трансформації/хв</div><div className="num">{ing.mediaRatePerMin||0}</div></div>
        <div className="box"><div className="small">Помилки 1h</div><div className="num">{ing.errors1h||0}</div></div>
        <div className="box"><div className="small">Версія pricing.yml</div><div className="num">{ing.pricingVersion||"—"}</div></div>
      </div>
    </Widget>
  );
}

function SectionWebhooks({ wh = {} }) {
  const items = wh.providers ? Object.entries(wh.providers) : [];
  return (
    <Widget title="Webhooks" sub="Провайдери платежів/перевізники">
      <table className="table">
        <thead><tr><th>Джерело</th><th>OK rate</th><th>Fail (5m)</th><th>Остання помилка</th></tr></thead>
        <tbody>
          {items.map(([name, v])=>(
            <tr key={name}>
              <td>{name}</td>
              <td>{Math.round((v.successRate||0)*100)}%</td>
              <td><Pill tone={v.failed5m>0?'warn':'ok'} text={String(v.failed5m||0)} /></td>
              <td className="small">{v.lastError||"—"}</td>
            </tr>
          ))}
          {!items.length && <tr><td colSpan="4" className="small">Дані відсутні.</td></tr>}
        </tbody>
      </table>
    </Widget>
  );
}

function SectionAlerts({ alerts = [] }) {
  const tone = (lvl)=> lvl==="error"?"danger": lvl==="warn"?"warn":"info";
  return (
    <Widget title="Оповіщення" sub="Останні 10">
      <div className="list">
        {alerts.slice(0,10).map((a,i)=>(
          <div key={i} className="row">
            <Pill tone={tone(a.level)} text={a.level.toUpperCase()} />
            <div className="small">{a.title}</div> {/* было style={{flex:1}} */}
            <div className="small">{a.ts||""}</div>
          </div>
        ))}
        {!alerts.length && <div className="small">Немає оповіщень.</div>}
      </div>
    </Widget>
  );
}

function App(){
  const [ops, setOps] = useState({ stats:{}, printers:[], jobs:[] });
  const [prints, setPrints] = useState({ printers:[], jobs:[], stats:{} });

  // Первична загрузка
  useEffect(()=>{
    api.opsOverview().then(setOps);
    api.printsOverview().then(setPrints);
  },[]);

  // SSE обновления
  useSSE("/api/events/stream?topics=orders,prints,shipments,ops", {
    onEvent: (e) => {
      if(e.type === "print.progress"){
        setPrints(cur => ({ ...cur, jobs: cur.jobs.map(j=> j.id===e.entity_id ? { ...j, progress:e.data.progress, eta:e.data.eta } : j) }));
      }
      if(e.type === "printer.state"){
        setPrints(cur => ({ ...cur, printers: cur.printers.map(p=> p.id===e.entity_id ? { ...p, state:e.data.state } : p) }));
      }
      if(e.domain === "ops"){
        setOps(cur => ({ ...cur, ...e.payload })); // свободный апдейт для опс-секции
      }
    }
  });

  const headerStats = useMemo(()=> ({
    printing: (prints.stats?.printing || 0),
    queued:   (prints.stats?.queued || 0),
    done:     (prints.stats?.done || 0),
  }), [prints]);

  const S = ops.stats || {};

  return (
    <div className="wrap">
      
      <Header stats={headerStats} />
      <div className="grid">
        <SectionOrders data={S} />
        <SectionPrintFarm printers={prints.printers} jobs={prints.jobs} />
        <SectionQueues q={S.queues} />
        <SectionMaterials m={S.materials} />
        <SectionLogistics l={S.logistics} />
        <SectionPayments p={S.payments} />
        <SectionIndexer idx={S.indexer} />
        <SectionIngester ing={S.ingester} />
        <SectionWebhooks wh={S.webhooks} />
        <SectionServices s={S.services} />
        <SectionAlerts alerts={S.alerts || []} />
      </div>
    </div>
  );
}

const root = createRoot(document.getElementById("root"));
root.render(<App />);

import React, { useEffect, useState } from "react";



export default function Print(){
const [printers, setPrinters] = useState([]);
const [jobs, setJobs] = useState([]);


useEffect(()=>{
api.get("/api/prints/overview").then((x)=>{
setPrinters(x.printers||[]);
setJobs(x.jobs||[]);
}).catch(()=>{});
},[]);


useSSE("/api/events/stream?topics=prints", {
onEvent: (evt) => {
if (evt.type === "print.progress") {
setJobs((cur)=>cur.map(j=> j.id===evt.entity_id ? { ...j, progress: evt.data.progress, eta: evt.data.eta } : j));
}
if (evt.type === "printer.state") {
setPrinters((cur)=>cur.map(p=> p.id===evt.entity_id ? { ...p, state: evt.data.state } : p));
}
}
});


return (
<div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
<section>
<h2>Принтери</h2>
<div style={{display:'grid',gap:8}}>
{printers.map(p=> (
<div key={p.id} style={{border:'1px solid #1f2937',borderRadius:12,padding:12}}>
<div style={{display:'flex',justifyContent:'space-between',marginBottom:6}}>
<strong>{p.name}</strong>
<span className="tag">{p.model} • {p.nozzle}</span>
</div>
<div>Стан: <span className="status">{p.state}</span></div>
<div>Матеріал: {p.material_color || '-'} </div>
</div>
))}
</div>
</section>
<section>
<h2>Завдання</h2>
<div style={{display:'grid',gap:8}}>
{jobs.map(j=> (
<div key={j.id} style={{border:'1px solid #1f2937',borderRadius:12,padding:12}}>
<div style={{display:'flex',justifyContent:'space-between',marginBottom:6}}>
<div><strong>{j.order_number}</strong> • {j.sku} ×{j.qty}</div>
<span className="tag">{j.printer_name || '—'}</span>
</div>
<Bar value={j.progress || 0} />
<div style={{marginTop:6,color:'#9ca3af'}}>ETA: {j.eta || '—'}</div>
</div>
))}
</div>
</section>
</div>
);
}
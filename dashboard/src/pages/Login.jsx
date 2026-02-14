import React, { useState } from "react";


export default function Login() {
const [email, setEmail] = useState("");
const [code, setCode] = useState("");
return (
<div style={{ maxWidth: 360, margin: "10vh auto" }}>
<h1>Вхід до панелі</h1>
<p style={{ color: "#9ca3af" }}>Введи email і одноразовий код.</p>
<div style={{ display: "grid", gap: 12, marginTop: 16 }}>
<input placeholder="email" value={email} onChange={(e)=>setEmail(e.target.value)} />
<input placeholder="код" value={code} onChange={(e)=>setCode(e.target.value)} />
<button className="btn">Увійти</button>
</div>
</div>
);
}
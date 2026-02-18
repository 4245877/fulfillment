// apps/dashboard/src/pages/settings/api.js
export async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });

  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  if (!res.ok) {
    const snippet = text ? `\n\n${text.slice(0, 300)}` : "";
    throw new Error(`${res.status} ${res.statusText} @ ${url}${snippet}`);
  }

  return json;
}

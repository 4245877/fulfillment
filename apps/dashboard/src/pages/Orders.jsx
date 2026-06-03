import React, { useEffect, useMemo, useState } from "react";
import { api } from "../api/client.js";
import s from "./Orders.module.css";

const ORDER_STATUSES = [
  "New",
  "Accepted",
  "PrePrintCheck",
  "Queued",
  "Printing",
  "PostProcess",
  "Packaging",
  "Shipment",
  "Pickup",
  "Delivered",
  "Issued",
  "Cancelled",
  "Problem",
];

function asArray(v) {
  return Array.isArray(v) ? v : [];
}

function norm(v) {
  return String(v ?? "").toLowerCase().trim();
}

function pickId(o) {
  return o?.id ?? o?.order_id ?? o?.uuid ?? o?._id ?? "";
}

function pickShopId(o) {
  return o?.shop_order_id ?? o?.order_id ?? "";
}

function pickStatus(o) {
  return o?.status ?? o?.state ?? o?.stage ?? "";
}

function formatMoney(value, currency = "UAH") {
  const n = Number(value);

  if (!Number.isFinite(n)) return "—";

  return `${new Intl.NumberFormat("uk-UA").format(n)} ${
    currency === "UAH" ? "грн" : currency
  }`;
}

function formatDate(value) {
  if (!value) return "";

  const d = new Date(value);

  if (Number.isNaN(d.getTime())) return String(value);

  return d.toLocaleString("uk-UA", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function pickItemImage(item) {
  return item?.image_url ?? item?.imageUrl ?? item?.image ?? null;
}

function pickItemFiles(item) {
  return asArray(item?.files).filter((file) => file?.url);
}

function fileTitle(file, index) {
  const type = String(file?.type || "").toUpperCase();
  const name = file?.filename || file?.name;

  if (name && type) return `${type} · ${name}`;
  if (name) return name;
  if (type) return `${type} файл`;

  return `Файл ${index + 1}`;
}

export default function Orders() {
  const [orders, setOrders] = useState([]);
  const [apiStatuses, setApiStatuses] = useState(ORDER_STATUSES);
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState("");
  const [error, setError] = useState(null);

  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");

  async function load() {
    setLoading(true);
    setError(null);

    try {
      const data = await api.listOrders({
        status: status === "all" ? undefined : status,
        q: q || undefined,
        limit: 200,
      });

      const list = asArray(data?.orders ?? data?.items ?? data ?? []);
      const statuses = asArray(data?.statuses);

      setOrders(list);

      if (statuses.length > 0) {
        setApiStatuses(statuses);
      }
    } catch (e) {
      setOrders([]);
      setError(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // Первый раз грузим всё. Фильтрация ниже локальная.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const list = asArray(orders);
    const qq = norm(q);

    return list.filter((o) => {
      if (status !== "all") {
        const st = norm(pickStatus(o));

        if (st !== norm(status)) {
          return false;
        }
      }

      if (!qq) {
        return true;
      }

      const hay = [
        pickId(o),
        pickShopId(o),
        pickStatus(o),
        o?.customer,
        o?.customer_name,
        o?.email,
        o?.phone,
      ]
        .map(norm)
        .join(" ");

      return hay.includes(qq);
    });
  }, [orders, q, status]);

  const statuses = useMemo(() => {
    const set = new Set(["all", ...apiStatuses]);

    for (const o of asArray(orders)) {
      const st = String(pickStatus(o) ?? "").trim();

      if (st) {
        set.add(st);
      }
    }

    return Array.from(set);
  }, [orders, apiStatuses]);

  async function updateStatus(order, nextStatus) {
    const id = pickId(order);
    const prevStatus = pickStatus(order);

    if (!id || !nextStatus || nextStatus === prevStatus) return;

    setSavingId(id);
    setError(null);

    const prevOrders = orders;

    setOrders((current) =>
      current.map((item) =>
        pickId(item) === id ? { ...item, status: nextStatus } : item
      )
    );

    try {
      const data = await api.updateOrderStatus(id, {
        status: nextStatus,
        actor: "dashboard",
      });

      const updated = data?.order;

      if (updated) {
        setOrders((current) =>
          current.map((item) => (pickId(item) === id ? updated : item))
        );
      }
    } catch (e) {
      setOrders(prevOrders);
      setError(e);
    } finally {
      setSavingId("");
    }
  }

  return (
    <div>
      <div className={s.topRow}>
        <h2 className={s.title}>Замовлення</h2>

        <button
          type="button"
          className={`btn btn-secondary ${s.reloadButton}`}
          onClick={load}
          disabled={loading}
        >
          {loading ? "Завантаження…" : "Оновити"}
        </button>

        <div className={s.controls}>
          <input
            className={`input ${s.search}`}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Пошук за ID, статусом або клієнтом…"
          />

          <select
            className={`select ${s.statusSelect}`}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            {statuses.map((x) => (
              <option key={x} value={x}>
                {x === "all" ? "усі статуси" : x}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <div className={`alert alert-danger ${s.errorBox}`}>
          <div>
            <div className="alert-title">Помилка</div>
            <p>{String(error?.message || error)}</p>
          </div>
        </div>
      )}

      <div className={s.meta}>
        Показано: {filtered.length} / {asArray(orders).length}
      </div>

      <div className={s.list}>
        {filtered.map((o, idx) => {
          const id = pickId(o);
          const shopId = pickShopId(o);
          const currentStatus = pickStatus(o) || "New";
          const items = asArray(o?.items);

          return (
            <div key={id || idx} className={`card ${s.orderCard}`}>
              <div className={s.cardHeader}>
                <div>
                  <div className={s.primaryLine}>
                    #{id || "без ID"}{" "}
                    <span className="text-muted">
                      {o?.created_at ? `• ${formatDate(o.created_at)}` : ""}
                    </span>
                  </div>

                  {shopId && shopId !== id ? (
                    <div className={s.subLine}>ID магазину: {shopId}</div>
                  ) : null}

                  <div className={s.subLine}>
                    Сума:{" "}
                    <strong>
                      {formatMoney(o?.total_uah ?? o?.total, o?.currency)}
                    </strong>
                  </div>
                </div>

                <div className={s.sideBlock}>
                  <div className={`text-muted ${s.customerInfo}`}>
                    {o?.customer_name ||
                      o?.customer ||
                      o?.email ||
                      o?.phone ||
                      "Клієнт не вказаний"}
                  </div>

                  <label className={s.statusEditor}>
                    <span>Статус</span>
                    <select
                      className={`select ${s.statusSelectSmall}`}
                      value={currentStatus}
                      onChange={(e) => updateStatus(o, e.target.value)}
                      disabled={savingId === id}
                    >
                      {apiStatuses.map((x) => (
                        <option key={x} value={x}>
                          {x}
                        </option>
                      ))}
                    </select>
                  </label>

                  {savingId === id ? (
                    <div className={s.savingText}>Збереження…</div>
                  ) : null}
                </div>
              </div>

              {items.length > 0 ? (
                <div className={s.itemsList}>
                  {items.map((item, itemIdx) => {
                    const imageUrl = pickItemImage(item);
                    const files = pickItemFiles(item);

                    return (
                      <div key={`${id}-item-${itemIdx}`} className={s.itemCard}>
                        <div className={s.itemImageBox}>
                          {imageUrl ? (
                            <img
                              className={s.itemImage}
                              src={imageUrl}
                              alt={item.name || item.title || item.sku || "Товар"}
                              loading="lazy"
                            />
                          ) : (
                            <div className={s.itemImagePlaceholder}>Без фото</div>
                          )}
                        </div>

                        <div className={s.itemBody}>
                          <div className={s.itemTitle}>
                            {item.name || item.title || item.sku || "Товар"}
                          </div>

                          <div className={s.itemMeta}>
                            <span>Кількість: {item.qty || item.quantity || 1}</span>

                            {item.sku ? <span>SKU: {item.sku}</span> : null}

                            {item.price != null ? (
                              <span>
                                Ціна: {formatMoney(item.price, o?.currency)}
                              </span>
                            ) : null}

                            {item.total != null ? (
                              <span>
                                Разом: {formatMoney(item.total, o?.currency)}
                              </span>
                            ) : null}
                          </div>

                          <div className={s.filesBlock}>
                            <div className={s.filesTitle}>Файли моделі</div>

                            {files.length > 0 ? (
                              <div className={s.filesList}>
                                {files.map((file, fileIdx) => (
                                  <a
                                    key={`${id}-item-${itemIdx}-file-${fileIdx}`}
                                    className={s.fileLink}
                                    href={file.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    download={file.filename || undefined}
                                  >
                                    Завантажити {fileTitle(file, fileIdx)}
                                  </a>
                                ))}
                              </div>
                            ) : (
                              <div className={s.noFiles}>
                                STL/3MF файли не прикріплені
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : null}

              <details className={s.details}>
                <summary className={`text-muted ${s.detailsSummary}`}>
                  Деталі JSON
                </summary>
                <pre className={s.pre}>{JSON.stringify(o, null, 2)}</pre>
              </details>
            </div>
          );
        })}

        {!loading && !error && filtered.length === 0 && (
          <div className={s.empty}>Немає даних для відображення.</div>
        )}
      </div>
    </div>
  );
}
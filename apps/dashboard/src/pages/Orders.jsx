import React, {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from "react";
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

const ORDER_STATUS_LABELS = {
  New: "Нове",
  Accepted: "Прийнято",
  PrePrintCheck: "Перевірка перед друком",
  Queued: "У черзі",
  Printing: "Друкується",
  PostProcess: "Постобробка",
  Packaging: "Пакування",
  Shipment: "Відправлення",
  Pickup: "Самовивіз",
  Delivered: "Доставлено",
  Issued: "Видано",
  Cancelled: "Скасовано",
  Problem: "Проблема",
};

function orderStatusLabel(status) {
  return ORDER_STATUS_LABELS[status] ?? status;
}

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

function safeUrl(value) {
  const url = String(value ?? "").trim();

  if (!url) return "";

  try {
    const parsed = new URL(url, window.location.origin);

    if (!["http:", "https:", "blob:"].includes(parsed.protocol)) {
      return "";
    }

    return parsed.href;
  } catch {
    return "";
  }
}

function pickModelFiles(entity) {
  const rawFiles = asArray(
    entity?.files ??
      entity?.model_files ??
      entity?.modelFiles ??
      entity?.attachments
  );

  return rawFiles
    .map((file) => {
      const url = safeUrl(file?.url ?? file?.href ?? file?.download_url);
      const filename = file?.filename ?? file?.name ?? "";

      return {
        ...file,
        url,
        filename,
      };
    })
    .filter((file) => {
      if (!file.url) return false;

      const hay = `${file.filename} ${file.url} ${file.type ?? ""}`.toLowerCase();

      return (
        hay.includes(".stl") ||
        hay.includes(".3mf") ||
        hay.includes("stl") ||
        hay.includes("3mf")
      );
    });
}

function pickItemFiles(item) {
  return pickModelFiles(item);
}

function pickModelSource(entity) {
  const source =
    entity?.source_url ??
    entity?.sourceUrl ??
    entity?.model_source_url ??
    entity?.modelSourceUrl ??
    entity?.model_url ??
    entity?.modelUrl ??
    entity?.source?.url ??
    entity?.model?.source_url ??
    entity?.model?.sourceUrl ??
    "";

  return safeUrl(source);
}

function sourceLabel(url) {
  if (!url) return "";

  try {
    const host = new URL(url).hostname.replace(/^www\./, "");

    if (host.includes("makerworld")) return "MakerWorld";
    if (host.includes("printables")) return "Printables";
    if (host.includes("thingiverse")) return "Thingiverse";
    if (host.includes("cults3d")) return "Cults3D";

    return host;
  } catch {
    return "Джерело моделі";
  }
}

function objectOrEmpty(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

const COMPANY_NAME_RE =
  /\b(тов|тзов|фоп|пп|пат|приватне підприємство|компанія|llc|ltd)\b/i;

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function keyText(value) {
  return norm(value).replace(/[\s-]+/g, "_");
}

function compareText(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[№#"'`’().,;:\s-]+/g, "");
}

function sameText(a, b) {
  const aa = compareText(a);
  const bb = compareText(b);

  return Boolean(aa && bb && aa === bb);
}

function cleanLocation(value) {
  const cleaned = cleanText(value)
    .replace(/,\s*місто\s*,/gi, ", ")
    .replace(/\bмісто\s+/gi, "");

  return cleanText(cleaned).replace(/\s+,/g, ",").replace(/,\s+/g, ", ");
}

function splitPersonName(value) {
  const fullName = cleanText(value);

  if (!fullName || COMPANY_NAME_RE.test(fullName)) {
    return { fullName };
  }

  const parts = fullName.split(/\s+/).filter(Boolean);

  if (parts.length < 2 || parts.length > 4) {
    return { fullName };
  }

  return {
    fullName,
    lastName: parts[0] ?? "",
    firstName: parts[1] ?? "",
    middleName: parts.slice(2).join(" "),
  };
}

function formatDeliveryService(value) {
  const raw = cleanText(value);
  const key = keyText(raw);

  if (!raw) return "";
  if (
    key.includes("nova_post") ||
    key.includes("novaposhta") ||
    raw.toLowerCase().includes("нова пошта")
  ) {
    return "Нова пошта";
  }

  if (key.includes("ukrposhta") || raw.toLowerCase().includes("укрпошта")) {
    return "Укрпошта";
  }

  return raw;
}

function looksLikePickupPoint(value) {
  return /відділен|поштомат|postomat|warehouse|branch|office|№\s*\d+/i.test(
    cleanText(value)
  );
}

function formatDeliveryMethod(method, carrier, warehouse) {
  const raw = cleanText(method);
  const key = keyText(raw);

  if (key === "nova_post" || carrier === "Нова пошта") {
    return warehouse ? "Відділення / поштомат" : "Нова пошта";
  }

  const labels = {
    pickup: "Самовивіз",
    courier: "Кур’єр",
    delivery: "Доставка",
    ukrposhta: "Укрпошта",
  };

  return labels[key] ?? raw;
}

function PersonNameRows({ value, fallbackLabel = "ПІБ" }) {
  const person = splitPersonName(value);

  if (!person.fullName) return null;

  if (!person.lastName || !person.firstName) {
    return <InfoRow label={fallbackLabel} value={person.fullName} />;
  }

  return (
    <>
      <InfoRow label="Прізвище" value={person.lastName} />
      <InfoRow label="Ім’я" value={person.firstName} />
      <InfoRow label="По батькові" value={person.middleName} />
    </>
  );
}

function pickCustomer(order) {
  const customerObj = objectOrEmpty(order?.customer);
  const clientObj = objectOrEmpty(order?.client);
  const buyerObj = objectOrEmpty(order?.buyer);

  const name =
    order?.customer_name ??
    order?.customerName ??
    order?.client_name ??
    order?.clientName ??
    customerObj?.name ??
    customerObj?.full_name ??
    clientObj?.name ??
    buyerObj?.name ??
    (typeof order?.customer === "string" ? order.customer : "");

  const phone =
    order?.phone ??
    order?.customer_phone ??
    order?.customerPhone ??
    order?.client_phone ??
    order?.clientPhone ??
    customerObj?.phone ??
    clientObj?.phone ??
    buyerObj?.phone ??
    "";

  const email =
    order?.email ??
    order?.customer_email ??
    order?.customerEmail ??
    order?.client_email ??
    order?.clientEmail ??
    customerObj?.email ??
    clientObj?.email ??
    buyerObj?.email ??
    "";

  return { name, phone, email };
}

function telHref(phone) {
  const cleaned = String(phone ?? "").replace(/[^\d+]/g, "");

  return cleaned ? `tel:${cleaned}` : "";
}

function mailHref(email) {
  const value = String(email ?? "").trim();

  return value ? `mailto:${value}` : "";
}

function pickDelivery(order) {
  const delivery = objectOrEmpty(
    order?.delivery ??
      order?.shipping ??
      order?.shipment ??
      order?.shipping_address ??
      order?.shippingAddress ??
      order?.source_payload?.delivery ??
      order?.source_payload?.shipping_address
  );

  const address = objectOrEmpty(delivery?.address ?? order?.address);

  const rawMethod =
    delivery?.method ??
    order?.shipping_method ??
    order?.shippingMethod ??
    "";

  const rawCarrier =
    delivery?.carrier ??
    delivery?.service ??
    delivery?.provider ??
    order?.delivery_service ??
    order?.carrier ??
    "";

  const carrier = formatDeliveryService(rawCarrier || rawMethod);

  const recipient =
    delivery?.recipient ??
    delivery?.recipient_name ??
    delivery?.recipientName ??
    delivery?.name ??
    order?.recipient_name ??
    order?.recipientName ??
    "";

  const phone =
    delivery?.phone ??
    delivery?.recipient_phone ??
    delivery?.recipientPhone ??
    order?.recipient_phone ??
    "";

  const line = cleanText(
    delivery?.line ??
      delivery?.address_line ??
      delivery?.addressLine ??
      delivery?.street ??
      address?.line ??
      address?.line1 ??
      address?.street ??
      ""
  );

  const rawWarehouse = cleanText(
    delivery?.warehouse ??
      delivery?.branch ??
      delivery?.office ??
      delivery?.post_office ??
      delivery?.postOffice ??
      delivery?.warehouse_name ??
      delivery?.warehouseName ??
      ""
  );

  const isNovaPost = carrier === "Нова пошта" || keyText(rawMethod) === "nova_post";

  const warehouse =
    rawWarehouse || (isNovaPost && looksLikePickupPoint(line) ? line : "");

  const addressLine = line && !sameText(line, warehouse) ? line : "";

  return {
    recipient: cleanText(recipient),
    phone: cleanText(phone),
    carrier,
    method: formatDeliveryMethod(rawMethod, carrier, warehouse),

    city: cleanLocation(delivery?.city ?? address?.city ?? order?.city ?? ""),
    cityRef: delivery?.city_ref ?? delivery?.cityRef ?? "",

    region: cleanLocation(
      delivery?.region ??
        delivery?.state ??
        address?.region ??
        address?.state ??
        order?.region ??
        ""
    ),

    address: addressLine,
    warehouse,
    warehouseRef: delivery?.warehouse_ref ?? delivery?.warehouseRef ?? "",

    postalCode:
      delivery?.postal_code ??
      delivery?.postalCode ??
      delivery?.zip ??
      address?.postal_code ??
      order?.postal_code ??
      "",

    tracking:
      delivery?.tracking_number ??
      delivery?.trackingNumber ??
      delivery?.ttn ??
      order?.tracking_number ??
      order?.ttn ??
      "",

    comment:
      delivery?.comment ??
      delivery?.note ??
      order?.delivery_comment ??
      "",
  };
}

function hasDeliveryData(delivery) {
  return [
    delivery.recipient,
    delivery.phone,
    delivery.carrier,
    delivery.method,
    delivery.city,
    delivery.region,
    delivery.address,
    delivery.warehouse,
    delivery.postalCode,
    delivery.tracking,
    delivery.comment,
  ].some((value) => String(value ?? "").trim());
}

function pickPayment(order) {
  const payment = objectOrEmpty(order?.payment);

  const statusRaw = norm(
    order?.payment_status ??
      order?.paymentStatus ??
      payment?.status ??
      payment?.type ??
      payment?.kind
  );

  const paidAmount =
    order?.paid_amount_uah ??
    order?.paidAmountUah ??
    order?.paid_amount ??
    order?.paidAmount ??
    payment?.paid_amount_uah ??
    payment?.paidAmountUah ??
    payment?.paid_amount ??
    payment?.paidAmount ??
    null;

  const totalAmount = order?.total_uah ?? order?.total ?? payment?.total ?? null;

  const paid = Number(paidAmount);
  const total = Number(totalAmount);

  const isPartial =
    statusRaw.includes("partial") ||
    statusRaw.includes("partly") ||
    statusRaw.includes("част") ||
    (Number.isFinite(paid) &&
      Number.isFinite(total) &&
      paid > 0 &&
      paid < total);

  const isFull =
    statusRaw.includes("full") ||
    statusRaw.includes("paid") ||
    statusRaw.includes("complete") ||
    statusRaw.includes("повн") ||
    (Number.isFinite(paid) &&
      Number.isFinite(total) &&
      total > 0 &&
      paid >= total);

  return {
    kind: isPartial ? "partial" : isFull ? "full" : "unknown",
    label: isPartial ? "Часткова" : isFull ? "Повна" : "Не вказано",
    paidAmount,
  };
}

function InfoRow({ label, value, href }) {
  if (!String(value ?? "").trim()) return null;

  return (
    <div className={s.infoRow}>
      <span>{label}</span>

      {href ? <a href={href}>{value}</a> : <strong>{value}</strong>}
    </div>
  );
}

function fileTitle(file, index) {
  const type = String(file?.type || "").toUpperCase();
  const name = file?.filename || file?.name;

  if (name && type) return `${type} · ${name}`;
  if (name) return name;
  if (type) return `${type} файл`;

  return `Файл ${index + 1}`;
}

// Memoized per-order card. With up to 200 orders rendered, keeping each card
// pure means a search keystroke or a single status change only re-renders the
// cards that actually changed, instead of re-parsing every order every time.
const OrderCard = memo(function OrderCard({
  order,
  apiStatuses,
  saving,
  onUpdateStatus,
}) {
  // The raw JSON dump is expensive to serialize and bloats the DOM, so only
  // build it while the <details> block is actually open.
  const [showRaw, setShowRaw] = useState(false);

  const id = pickId(order);
  const shopId = pickShopId(order);
  const currentStatus = pickStatus(order) || "New";

  // Parse the order shape once per order, not on every parent re-render.
  const derived = useMemo(() => {
    const customer = pickCustomer(order);

    return {
      items: asArray(order?.items),
      customer,
      customerSummary: [customer.name, customer.email, customer.phone]
        .filter(Boolean)
        .join(" · "),
      delivery: pickDelivery(order),
      payment: pickPayment(order),
      orderFiles: pickModelFiles(order),
      orderSource: pickModelSource(order),
    };
  }, [order]);

  const { items, customer, customerSummary, delivery, payment, orderFiles, orderSource } =
    derived;

  return (
    <div className={`card ${s.orderCard}`}>
      <div className={s.cardHeader}>
        <div>
          <div className={s.primaryLine}>
            #{id || "без ID"}{" "}
            <span className="text-muted">
              {order?.created_at ? `• ${formatDate(order.created_at)}` : ""}
            </span>
          </div>

          {shopId && shopId !== id ? (
            <div className={s.subLine}>ID магазину: {shopId}</div>
          ) : null}

          <div className={s.subLine}>
            Сума:{" "}
            <strong>
              {formatMoney(order?.total_uah ?? order?.total, order?.currency)}
            </strong>
          </div>
        </div>

        <div className={s.sideBlock}>
          <div className={`text-muted ${s.customerInfo}`}>
            {customerSummary || "Клієнт не вказаний"}
          </div>

          <label className={s.statusEditor}>
            <span>Статус</span>
            <select
              className={`select ${s.statusSelectSmall}`}
              value={currentStatus}
              onChange={(e) => onUpdateStatus(order, e.target.value)}
              disabled={saving}
            >
              {apiStatuses.map((x) => (
                <option key={x} value={x}>
                  {orderStatusLabel(x)}
                </option>
              ))}
            </select>
          </label>

          {saving ? <div className={s.savingText}>Збереження…</div> : null}
        </div>
      </div>

      <div className={s.orderInfoGrid}>
        <div className={s.infoCard}>
          <div className={s.infoTitle}>Клієнт</div>

          <PersonNameRows value={customer.name} />
          <InfoRow
            label="Телефон"
            value={customer.phone}
            href={telHref(customer.phone)}
          />
          <InfoRow
            label="Email"
            value={customer.email}
            href={mailHref(customer.email)}
          />

          {!customer.name && !customer.phone && !customer.email ? (
            <div className={s.emptyInfo}>Дані клієнта не вказані</div>
          ) : null}
        </div>

        <div className={s.infoCard}>
          <div className={s.infoTitle}>Доставка</div>

          {hasDeliveryData(delivery) ? (
            <>
              {delivery.recipient ? (
                <div className={s.infoSubTitle}>Отримувач</div>
              ) : null}

              <PersonNameRows
                value={delivery.recipient}
                fallbackLabel="Отримувач"
              />

              <InfoRow
                label="Телефон"
                value={delivery.phone}
                href={telHref(delivery.phone)}
              />

              <div className={s.infoSubTitle}>Доставка</div>

              <InfoRow label="Служба" value={delivery.carrier} />
              <InfoRow label="Спосіб" value={delivery.method} />
              <InfoRow label="Місто" value={delivery.city} />
              <InfoRow label="Область" value={delivery.region} />

              <InfoRow label="Відділення" value={delivery.warehouse} />
              <InfoRow label="Адреса" value={delivery.address} />

              <InfoRow label="Індекс" value={delivery.postalCode} />
              <InfoRow label="ТТН" value={delivery.tracking} />
              <InfoRow label="Коментар" value={delivery.comment} />
            </>
          ) : (
            <div className={s.emptyInfo}>Дані доставки не вказані</div>
          )}
        </div>

        <div className={s.infoCard}>
          <div className={s.infoTitle}>Оплата</div>

          <div
            className={`${s.paymentBadge} ${
              payment.kind === "partial"
                ? s.paymentPartial
                : payment.kind === "full"
                  ? s.paymentFull
                  : s.paymentUnknown
            }`}
          >
            {payment.label}
          </div>

          {payment.kind === "partial" ? (
            <div className={s.paidAmount}>
              Оплачено:{" "}
              <strong>{formatMoney(payment.paidAmount, order?.currency)}</strong>
            </div>
          ) : null}
        </div>

        <div className={s.infoCard}>
          <div className={s.infoTitle}>Файли замовлення</div>

          {orderSource ? (
            <a
              className={s.sourceLink}
              href={orderSource}
              target="_blank"
              rel="noreferrer"
            >
              Джерело моделі: {sourceLabel(orderSource)}
            </a>
          ) : (
            <div className={s.emptyInfo}>Джерело моделі не вказано</div>
          )}

          {orderFiles.length > 0 ? (
            <div className={s.filesList}>
              {orderFiles.map((file, fileIdx) => (
                <a
                  key={`${id}-order-file-${fileIdx}`}
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
              STL/3MF файли замовлення не прикріплені
            </div>
          )}
        </div>
      </div>

      {items.length > 0 ? (
        <div className={s.itemsList}>
          {items.map((item, itemIdx) => {
            const imageUrl = pickItemImage(item);
            const files = pickItemFiles(item);
            const sourceUrl = pickModelSource(item) || orderSource;

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
                    <span>Кількість: {item.qty ?? item.quantity ?? 1}</span>

                    {item.sku ? <span>SKU: {item.sku}</span> : null}

                    {item.price != null ? (
                      <span>Ціна: {formatMoney(item.price, order?.currency)}</span>
                    ) : null}

                    {item.total != null ? (
                      <span>Разом: {formatMoney(item.total, order?.currency)}</span>
                    ) : null}
                  </div>

                  {sourceUrl ? (
                    <div className={s.sourceBlock}>
                      <a
                        className={s.sourceLink}
                        href={sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Джерело моделі: {sourceLabel(sourceUrl)}
                      </a>
                    </div>
                  ) : null}

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

      <details
        className={s.details}
        onToggle={(e) => setShowRaw(e.currentTarget.open)}
      >
        <summary className={`text-muted ${s.detailsSummary}`}>
          Службові дані
        </summary>
        {showRaw ? (
          <pre className={s.pre}>{JSON.stringify(order, null, 2)}</pre>
        ) : null}
      </details>
    </div>
  );
});

export default function Orders() {
  const [orders, setOrders] = useState([]);
  const [apiStatuses, setApiStatuses] = useState(ORDER_STATUSES);
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState("");
  const [error, setError] = useState(null);

  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");

  // Keep the search box responsive: typing updates `q` instantly, but the
  // expensive filter + re-render of the order list runs against the deferred
  // value so keystrokes don't block on low-power devices.
  const deferredQ = useDeferredValue(q);

  const load = useCallback(async () => {
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
  }, [status, q]);

  useEffect(() => {
    load();
    // Перший раз завантажуємо всі замовлення. Фільтрація нижче локальна.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const list = asArray(orders);
    const qq = norm(deferredQ);

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
        orderStatusLabel(pickStatus(o)),
        o?.customer,
        o?.customer_name,
        o?.email,
        o?.phone,
      ]
        .map(norm)
        .join(" ");

      return hay.includes(qq);
    });
  }, [orders, deferredQ, status]);

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

  // Stable identity so the memoized OrderCard isn't invalidated on every
  // render. Rollback targets only the affected order rather than snapshotting
  // and restoring the whole list (which would clobber concurrent updates).
  const updateStatus = useCallback(async (order, nextStatus) => {
    const id = pickId(order);
    const prevStatus = pickStatus(order);

    if (!id || !nextStatus || nextStatus === prevStatus) return;

    setSavingId(id);
    setError(null);

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
      setOrders((current) =>
        current.map((item) =>
          pickId(item) === id ? { ...item, status: prevStatus } : item
        )
      );
      setError(e);
    } finally {
      setSavingId("");
    }
  }, []);

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
          {loading ? "Хвилинку…" : "Оновити"}
        </button>

        <div className={s.controls}>
          <input
            className={`input ${s.search}`}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Пошук за ID, статусом або клієнтом…"
            aria-label="Пошук замовлень"
          />

          <select
            className={`select ${s.statusSelect}`}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            aria-label="Фільтр за статусом"
          >
            {statuses.map((x) => (
              <option key={x} value={x}>
                {x === "all" ? "усі статуси" : orderStatusLabel(x)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <div className={`alert alert-danger ${s.errorBox}`}>
          <div>
            <div className="alert-title">Щось пішло не так</div>
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

          return (
            <OrderCard
              key={id || idx}
              order={o}
              apiStatuses={apiStatuses}
              saving={savingId === id}
              onUpdateStatus={updateStatus}
            />
          );
        })}

        {!loading && !error && filtered.length === 0 && (
          <div className={s.empty}>
            Ой… за цими умовами я нічого не знайшла. Спробуйте, будь ласка,
            змінити пошук або фільтр.
          </div>
        )}
      </div>
    </div>
  );
}
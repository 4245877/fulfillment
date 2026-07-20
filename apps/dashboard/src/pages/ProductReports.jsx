import React, { useEffect, useMemo, useState } from "react";

import { api } from "../api/client.js";
import "./ProductReports.css";

const VIEW_OPTIONS = [
  { value: "active", label: "Активные" },
  { value: "archived", label: "Архив" },
  { value: "deleted", label: "Удалённые" },
];

const STATUS_OPTIONS = [
  { value: "", label: "Все статусы" },
  { value: "new", label: "Новые" },
  { value: "in_review", label: "На рассмотрении" },
  { value: "resolved", label: "Решённые" },
  { value: "rejected", label: "Отклонённые" },
];

const STATUS_LABELS = {
  new: "Новая",
  in_review: "На рассмотрении",
  resolved: "Решённая",
  rejected: "Отклонённая",
};

function formatDate(value) {
  if (!value) return "—";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("ru-RU", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function getProductTitle(report) {
  return (
    report.product_name ||
    report.product_sku ||
    report.product_id ||
    "Товар без названия"
  );
}

export default function ProductReports() {
  const [items, setItems] = useState([]);
  const [view, setView] = useState("active");
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [draftNotes, setDraftNotes] = useState({});
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState("");
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  const stats = useMemo(() => {
    return items.reduce(
      (acc, item) => {
        acc.total += 1;
        acc[item.status] = (acc[item.status] || 0) + 1;
        return acc;
      },
      {
        total: 0,
        new: 0,
        in_review: 0,
        resolved: 0,
        rejected: 0,
      }
    );
  }, [items]);

  useEffect(() => {
    const ctrl = new AbortController();

    async function load() {
      setLoading(true);
      setError("");

      try {
        const data = await api.listProductReports(
          {
            view,
            status,
            q: q.trim(),
            limit: 200,
          },
          {
            signal: ctrl.signal,
          }
        );

        const nextItems = Array.isArray(data?.items) ? data.items : [];

        setItems(nextItems);

        setDraftNotes((prev) => {
          const next = { ...prev };

          nextItems.forEach((item) => {
            if (next[item.report_id] === undefined) {
              next[item.report_id] = item.admin_note || "";
            }
          });

          return next;
        });
      } catch (err) {
        if (ctrl.signal.aborted) return;

        setError(
          err instanceof Error
            ? err.message
            : "Мне не удалось загрузить жалобы. Попробуйте, пожалуйста, ещё раз."
        );
      } finally {
        if (!ctrl.signal.aborted) {
          setLoading(false);
        }
      }
    }

    load();

    return () => ctrl.abort();
  }, [view, status, q, refreshKey]);

  async function updateReport(report, payload) {
    setActionId(report.report_id);
    setError("");

    try {
      const data = await api.updateProductReport(report.report_id, payload);
      const nextItem = data?.item;

      if (!nextItem) {
        throw new Error("API не вернул обновлённую жалобу");
      }

      setItems((prev) =>
        prev.map((item) =>
          item.report_id === nextItem.report_id ? nextItem : item
        )
      );

      if (Object.prototype.hasOwnProperty.call(payload, "admin_note")) {
        setDraftNotes((prev) => ({
          ...prev,
          [nextItem.report_id]: nextItem.admin_note || "",
        }));
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Мне не удалось обновить жалобу. Попробуйте, пожалуйста, ещё раз."
      );
    } finally {
      setActionId("");
    }
  }

  async function runReportAction(report, action) {
    setActionId(report.report_id);
    setError("");

    try {
      if (action === "archive") {
        await api.archiveProductReport(report.report_id);
      }

      if (action === "restore") {
        await api.restoreProductReport(report.report_id);
      }

      if (action === "delete") {
        const ok = window.confirm(
          "Переместить жалобу в «Удалённые»? Не волнуйтесь — при необходимости я смогу её восстановить."
        );

        if (!ok) return;

        await api.deleteProductReport(report.report_id);
      }

      if (action === "delete-permanently") {
        const ok = window.confirm(
          "Жалоба будет удалена навсегда — это действие нельзя отменить. Я сделаю это только с вашего подтверждения. Продолжить?"
        );

        if (!ok) return;

        await api.permanentlyDeleteProductReport(report.report_id);
      }

      setItems((prev) =>
        prev.filter((item) => item.report_id !== report.report_id)
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Мне не удалось выполнить это действие. Попробуйте, пожалуйста, ещё раз."
      );
    } finally {
      setActionId("");
    }
  }

  function handleNoteChange(reportId, value) {
    setDraftNotes((prev) => ({
      ...prev,
      [reportId]: value,
    }));
  }

  return (
    <section className="product-reports-page">
      <header className="product-reports-page__header">
        <div>
          <h1>Жалобы на товары</h1>
          <p>
            Я собираю здесь жалобы покупателей: активные — на виду, завершённые
            можно перенести в архив, восстановить или удалить, не потеряв ни
            одной важной заявки.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setRefreshKey((v) => v + 1)}
          disabled={loading}
          aria-label="Обновить список жалоб"
        >
          Обновить
        </button>
      </header>

      <nav className="product-reports-page__views" aria-label="Разделы жалоб">
        {VIEW_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            className={
              view === option.value
                ? "product-reports-page__view product-reports-page__view--active"
                : "product-reports-page__view"
            }
            onClick={() => setView(option.value)}
            disabled={loading && view === option.value}
          >
            {option.label}
          </button>
        ))}
      </nav>

      <div className="product-reports-page__filters" role="search">
        <label htmlFor="reports-status-filter">
          <span>Статус</span>
          <select
            id="reports-status-filter"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value || "all"} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        <label htmlFor="reports-search">
          <span>Поиск</span>
          <input
            id="reports-search"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Название, SKU, причина, комментарий…"
          />
        </label>
      </div>

      <dl
        className="product-reports-page__stats"
        aria-label="Статистика жалоб"
      >
        <div>
          <dt>В этом разделе</dt>
          <dd>{stats.total}</dd>
        </div>
        <div>
          <dt>Новые</dt>
          <dd>{stats.new}</dd>
        </div>
        <div>
          <dt>На рассмотрении</dt>
          <dd>{stats.in_review}</dd>
        </div>
        <div>
          <dt>Решённые</dt>
          <dd>{stats.resolved}</dd>
        </div>
        <div>
          <dt>Отклонённые</dt>
          <dd>{stats.rejected}</dd>
        </div>
      </dl>

      {error && (
        <div className="product-reports-page__error" role="alert">
          {error}
        </div>
      )}

      {loading ? (
        <div className="product-reports-page__empty" aria-live="polite">
          Минутку, пожалуйста… я собираю жалобы.
        </div>
      ) : items.length === 0 ? (
        <div className="product-reports-page__empty" aria-live="polite">
          По этим фильтрам жалоб нет — кажется, всё хорошо ♡
        </div>
      ) : (
        <div className="product-reports-list" aria-label="Список жалоб">
          {items.map((report) => {
            const noteValue = draftNotes[report.report_id] ?? "";
            const isBusy = actionId === report.report_id;
            const cardId = `report-${report.report_id}`;
            const isDeleted = Boolean(report.deleted_at);

            return (
              <article
                key={report.report_id}
                className={`product-report-card product-report-card--${
                  report.status || "unknown"
                }`}
                aria-labelledby={`${cardId}-title`}
              >
                <header className="product-report-card__header">
                  <div>
                    <h2 id={`${cardId}-title`}>{getProductTitle(report)}</h2>
                    <p>
                      ID товара: {report.product_id || "—"}
                      {report.product_sku
                        ? ` · SKU: ${report.product_sku}`
                        : ""}
                    </p>
                  </div>

                  <div className="product-report-card__badges">
                    {report.archived_at && !report.deleted_at && (
                      <span className="product-report-visibility product-report-visibility--archived">
                        Архив
                      </span>
                    )}

                    {report.deleted_at && (
                      <span className="product-report-visibility product-report-visibility--deleted">
                        Удалено
                      </span>
                    )}

                    <span
                      className={`product-report-status product-report-status--${report.status}`}
                      aria-label={`Статус: ${
                        STATUS_LABELS[report.status] || report.status
                      }`}
                    >
                      {STATUS_LABELS[report.status] || report.status}
                    </span>
                  </div>
                </header>

                <dl className="product-report-card__meta">
                  <div>
                    <dt>Причина</dt>
                    <dd>{report.reason || "—"}</dd>
                  </div>
                  <div>
                    <dt>Создано</dt>
                    <dd>
                      <time dateTime={report.created_at}>
                        {formatDate(report.created_at)}
                      </time>
                    </dd>
                  </div>
                  <div>
                    <dt>Закрыто</dt>
                    <dd>
                      {report.resolved_at ? (
                        <time dateTime={report.resolved_at}>
                          {formatDate(report.resolved_at)}
                        </time>
                      ) : (
                        "—"
                      )}
                    </dd>
                  </div>

                  {report.archived_at && !report.deleted_at && (
                    <div>
                      <dt>В архиве</dt>
                      <dd>
                        <time dateTime={report.archived_at}>
                          {formatDate(report.archived_at)}
                        </time>
                      </dd>
                    </div>
                  )}

                  {report.deleted_at && (
                    <div>
                      <dt>Удалено</dt>
                      <dd>
                        <time dateTime={report.deleted_at}>
                          {formatDate(report.deleted_at)}
                        </time>
                      </dd>
                    </div>
                  )}
                </dl>

                <div className="product-report-card__section">
                  <h3>Комментарий пользователя</h3>
                  <p>{report.comment || "Без комментария."}</p>
                </div>

                {report.page_url && (
                  <div className="product-report-card__section">
                    <h3>Страница</h3>
                    <a
                      href={report.page_url}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      Открыть страницу товара
                    </a>
                  </div>
                )}

                {!isDeleted && (
                  <div className="product-report-card__controls">
                    <label htmlFor={`${cardId}-status`}>
                      <span>Статус</span>
                      <select
                        id={`${cardId}-status`}
                        value={report.status}
                        disabled={isBusy}
                        onChange={(e) =>
                          updateReport(report, { status: e.target.value })
                        }
                      >
                        {STATUS_OPTIONS.filter((o) => o.value).map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label htmlFor={`${cardId}-note`}>
                      <span>Заметка администратора</span>
                      <textarea
                        id={`${cardId}-note`}
                        rows={3}
                        value={noteValue}
                        disabled={isBusy}
                        onChange={(e) =>
                          handleNoteChange(report.report_id, e.target.value)
                        }
                        placeholder="Что проверено, какое решение принято…"
                      />
                    </label>

                    <button
                      type="button"
                      disabled={isBusy}
                      aria-busy={isBusy}
                      onClick={() =>
                        updateReport(report, { admin_note: noteValue })
                      }
                    >
                      {isBusy ? "Сохранение…" : "Сохранить заметку"}
                    </button>
                  </div>
                )}

                <footer className="product-report-card__actions">
                  {view === "active" && (
                    <>
                      <button
                        type="button"
                        disabled={isBusy}
                        data-variant="secondary"
                        onClick={() => runReportAction(report, "archive")}
                      >
                        Архивировать
                      </button>

                      <button
                        type="button"
                        disabled={isBusy}
                        data-variant="danger"
                        onClick={() => runReportAction(report, "delete")}
                      >
                        Удалить
                      </button>
                    </>
                  )}

                  {view === "archived" && (
                    <>
                      <button
                        type="button"
                        disabled={isBusy}
                        data-variant="primary"
                        onClick={() => runReportAction(report, "restore")}
                      >
                        Восстановить
                      </button>

                      <button
                        type="button"
                        disabled={isBusy}
                        data-variant="danger"
                        onClick={() => runReportAction(report, "delete")}
                      >
                        Удалить
                      </button>
                    </>
                  )}

                  {view === "deleted" && (
                    <>
                      <button
                        type="button"
                        disabled={isBusy}
                        data-variant="primary"
                        onClick={() => runReportAction(report, "restore")}
                      >
                        Восстановить
                      </button>

                      <button
                        type="button"
                        disabled={isBusy}
                        data-variant="danger"
                        onClick={() =>
                          runReportAction(report, "delete-permanently")
                        }
                      >
                        Удалить навсегда
                      </button>
                    </>
                  )}
                </footer>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
import React, { useEffect, useMemo, useRef, useState } from "react";

import { appealsApi } from "../api/appealsApi.js";
import s from "./Appeals.module.css";

const STATUS_META = {
  new: { label: "Нове" },
  in_progress: { label: "В роботі" },
  closed: { label: "Закрито" },
};

const FILTERS = [
  { value: "all", label: "Усі" },
  { value: "new", label: "Нові" },
  { value: "in_progress", label: "В роботі" },
  { value: "closed", label: "Закриті" },
];

const STATUS_ORDER = ["new", "in_progress", "closed"];

/* ── Helpers ──────────────────────────────────────────────────── */

function displayName(customer) {
  return customer.name?.trim() || customer.contact?.trim() || "Анонімний клієнт";
}

function initialsOf(customer) {
  const name = customer.name?.trim();
  if (name) {
    const parts = name.split(/\s+/).filter(Boolean);
    return (parts[0][0] + (parts[1]?.[0] || "")).toUpperCase();
  }
  const handle = (customer.contact || "").replace(/^@/, "").trim();
  const letter = handle.match(/[\p{L}\p{N}]/u);
  return (letter ? letter[0] : "∗").toUpperCase();
}

function timeAgo(iso) {
  const diffMin = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (diffMin < 1) return "щойно";
  if (diffMin < 60) return `${diffMin} хв`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr} год`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay === 1) return "вчора";
  if (diffDay < 7) return `${diffDay} дн`;
  return new Date(iso).toLocaleDateString("uk-UA", {
    day: "2-digit",
    month: "2-digit",
  });
}

function clockTime(iso) {
  return new Date(iso).toLocaleTimeString("uk-UA", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function dayLabel(iso) {
  const date = new Date(iso);
  const now = new Date();
  const diffDays = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (diffDays === 0) return "Сьогодні";
  if (diffDays === 1) return "Вчора";
  return date.toLocaleDateString("uk-UA", {
    day: "numeric",
    month: "long",
    ...(date.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
  });
}

function lastMessage(thread) {
  return thread.messages[thread.messages.length - 1];
}

function matchesQuery(thread, query) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const last = lastMessage(thread)?.text || "";
  return [
    thread.customer.name,
    thread.customer.contact,
    thread.product.name,
    thread.product.sku,
    last,
  ]
    .filter(Boolean)
    .some((value) => value.toLowerCase().includes(q));
}

const sortThreads = (threads) => [...threads].sort(
  (a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime()
);

/* ── Icons ────────────────────────────────────────────────────── */

const Icon = {
  Search: (props) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.2-3.2" />
    </svg>
  ),
  Tag: (props) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M3 11V5a2 2 0 0 1 2-2h6l9 9-8 8-9-9Z" />
      <circle cx="7.5" cy="7.5" r="1.4" />
    </svg>
  ),
  Box: (props) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M21 8 12 3 3 8v8l9 5 9-5V8Z" />
      <path d="m3 8 9 5 9-5M12 13v8" />
    </svg>
  ),
  Back: (props) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="m15 18-6-6 6-6" />
    </svg>
  ),
  Send: (props) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M4 12 20 4l-5 16-4-7-7-1Z" />
    </svg>
  ),
  Refresh: (props) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
      <path d="M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16" />
      <path d="M3 21v-5h5" />
    </svg>
  ),
};

/* ── Sub-components ───────────────────────────────────────────── */

function Avatar({ customer, status, size = "md" }) {
  return (
    <span
      className={`${s.avatar} ${size === "lg" ? s.avatarLg : ""}`}
      data-status={status}
      aria-hidden="true"
    >
      {initialsOf(customer)}
    </span>
  );
}

function StatusPill({ status }) {
  return (
    <span className={s.statusPill} data-status={status}>
      {STATUS_META[status]?.label || status}
    </span>
  );
}

function ThreadRow({ thread, active, onSelect }) {
  const last = lastMessage(thread);
  const preview = last
    ? `${last.author === "operator" ? "Ви: " : ""}${last.text}`
    : "Без повідомлень";

  return (
    <button
      type="button"
      className={s.row}
      data-status={thread.status}
      data-active={active ? "true" : "false"}
      data-unread={thread.unread > 0 ? "true" : "false"}
      onClick={() => onSelect(thread.id)}
      aria-pressed={active}
    >
      <Avatar customer={thread.customer} status={thread.status} />

      <span className={s.rowBody}>
        <span className={s.rowLine1}>
          <span className={s.rowName}>{displayName(thread.customer)}</span>
          <StatusPill status={thread.status} />
        </span>

        <span className={s.rowProduct}>
          <Icon.Tag className={s.rowProductIcon} />
          <span>{thread.product.name}</span>
        </span>

        <span className={s.rowLine3}>
          <span className={s.rowPreview}>{preview}</span>
          <span className={s.rowMeta}>
            <time dateTime={thread.lastMessageAt}>
              {timeAgo(thread.lastMessageAt)}
            </time>
            {thread.unread > 0 && (
              <span className={s.unreadBadge}>{thread.unread}</span>
            )}
          </span>
        </span>
      </span>
    </button>
  );
}

function SkeletonRow() {
  return (
    <div className={s.skeletonRow} aria-hidden="true">
      <span className={`${s.skelAvatar} ${s.shimmer}`} />
      <span className={s.skelBody}>
        <span className={`${s.skelLine} ${s.shimmer}`} style={{ width: "55%" }} />
        <span className={`${s.skelLine} ${s.shimmer}`} style={{ width: "75%" }} />
        <span className={`${s.skelLine} ${s.shimmer}`} style={{ width: "40%" }} />
      </span>
    </div>
  );
}

function Conversation({ thread }) {
  const items = [];
  let prevDay = null;

  thread.messages.forEach((message) => {
    const label = dayLabel(message.at);
    if (label !== prevDay) {
      items.push(
        <div className={s.daySep} key={`day-${message.id}`}>
          <span>{label}</span>
        </div>
      );
      prevDay = label;
    }

    items.push(
      <div
        className={s.bubbleRow}
        data-author={message.author}
        key={message.id}
      >
        <div className={s.bubble} data-pending={message.pending ? "true" : undefined}>
          <span className={s.bubbleText}>{message.text}</span>
          <time className={s.bubbleTime} dateTime={message.at}>
            {clockTime(message.at)}
          </time>
        </div>
      </div>
    );
  });

  return <>{items}</>;
}

/* ── Page ─────────────────────────────────────────────────────── */

export default function Appeals() {
  const [threads, setThreads] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [actionError, setActionError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  const messagesRef = useRef(null);
  const composerRef = useRef(null);

  const active = useMemo(
    () => threads.find((thread) => thread.id === selectedId) || null,
    [threads, selectedId]
  );

  const counts = useMemo(
    () =>
      threads.reduce(
        (acc, thread) => {
          acc.all += 1;
          acc[thread.status] = (acc[thread.status] || 0) + 1;
          return acc;
        },
        { all: 0, new: 0, in_progress: 0, closed: 0 }
      ),
    [threads]
  );

  const visibleThreads = useMemo(
    () =>
      sortThreads(
        threads.filter(
          (thread) =>
            (statusFilter === "all" || thread.status === statusFilter) &&
            matchesQuery(thread, query)
        )
      ),
    [threads, statusFilter, query]
  );

  // Initial load + manual refresh.
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setListError("");

    appealsApi
      .list()
      .then((data) => {
        if (alive) setThreads(data);
      })
      .catch(() => {
        if (alive) setListError("Не вдалося завантажити звернення");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [refreshKey]);

  // Keep the conversation pinned to the newest message.
  useEffect(() => {
    const node = messagesRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [selectedId, active?.messages.length]);

  function handleSelect(id) {
    setSelectedId(id);
    setActionError("");
    setThreads((prev) =>
      prev.map((thread) => (thread.id === id ? { ...thread, unread: 0 } : thread))
    );
    appealsApi.markRead(id).catch(() => {});
  }

  function resetComposerHeight() {
    const node = composerRef.current;
    if (node) node.style.height = "";
  }

  function handleDraftInput(event) {
    setDraft(event.target.value);
    const node = event.target;
    node.style.height = "auto";
    node.style.height = `${Math.min(node.scrollHeight, 140)}px`;
  }

  function handleComposerKeyDown(event) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      handleSend();
    }
  }

  async function handleSend(event) {
    event?.preventDefault();
    const text = draft.trim();
    if (!text || !active || sending) return;

    const id = active.id;
    setSending(true);
    setActionError("");

    const optimistic = {
      id: `tmp-${Date.now()}`,
      author: "operator",
      text,
      at: new Date().toISOString(),
      pending: true,
    };

    setThreads((prev) =>
      sortThreads(
        prev.map((thread) =>
          thread.id === id
            ? {
                ...thread,
                messages: [...thread.messages, optimistic],
                lastMessageAt: optimistic.at,
                status: thread.status === "new" ? "in_progress" : thread.status,
              }
            : thread
        )
      )
    );
    setDraft("");
    resetComposerHeight();

    try {
      const { thread } = await appealsApi.sendMessage(id, text);
      setThreads((prev) =>
        sortThreads(prev.map((item) => (item.id === thread.id ? thread : item)))
      );
    } catch {
      setActionError("Не вдалося надіслати повідомлення. Спробуйте ще раз.");
      setThreads((prev) =>
        prev.map((thread) =>
          thread.id === id
            ? {
                ...thread,
                messages: thread.messages.filter((m) => m.id !== optimistic.id),
              }
            : thread
        )
      );
      setDraft(text);
    } finally {
      setSending(false);
    }
  }

  async function handleStatusChange(status) {
    if (!active) return;
    const id = active.id;
    setActionError("");
    setThreads((prev) =>
      prev.map((thread) => (thread.id === id ? { ...thread, status } : thread))
    );

    try {
      const thread = await appealsApi.setStatus(id, status);
      setThreads((prev) =>
        prev.map((item) => (item.id === thread.id ? thread : item))
      );
    } catch {
      setActionError("Не вдалося змінити статус звернення");
    }
  }

  return (
    <section
      className={s.page}
      data-pane={selectedId ? "chat" : "list"}
      aria-label="Звернення клієнтів"
    >
      {/* ── Inbox / thread list ───────────────────────────────── */}
      <aside className={s.listPane} aria-label="Список звернень">
        <header className={s.listHeader}>
          <div className={s.listTitleRow}>
            <div>
              <h1 className={s.title}>Звернення</h1>
              <p className={s.subtitle}>Запитання покупців про ваші вироби</p>
            </div>
            <button
              type="button"
              className={s.refreshBtn}
              onClick={() => setRefreshKey((value) => value + 1)}
              disabled={loading}
              aria-label="Оновити список звернень"
              title="Оновити"
            >
              <Icon.Refresh className={s.refreshIcon} data-spinning={loading ? "true" : undefined} />
            </button>
          </div>

          <div className={s.search}>
            <Icon.Search className={s.searchIcon} />
            <input
              type="search"
              className={s.searchInput}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Пошук за клієнтом, товаром, текстом…"
              aria-label="Пошук звернень"
            />
          </div>

          <div className={s.filters} role="tablist" aria-label="Фільтр за статусом">
            {FILTERS.map((filter) => (
              <button
                key={filter.value}
                type="button"
                role="tab"
                aria-selected={statusFilter === filter.value}
                className={s.filterBtn}
                data-active={statusFilter === filter.value ? "true" : "false"}
                data-status={filter.value}
                onClick={() => setStatusFilter(filter.value)}
              >
                {filter.label}
                <span className={s.filterCount}>{counts[filter.value] ?? 0}</span>
              </button>
            ))}
          </div>
        </header>

        <div className={s.list}>
          {loading ? (
            Array.from({ length: 5 }).map((_, index) => <SkeletonRow key={index} />)
          ) : listError ? (
            <div className={s.listError} role="alert">
              {listError}
            </div>
          ) : visibleThreads.length === 0 ? (
            <div className={s.listEmpty}>
              <p>Звернень за цими умовами немає.</p>
            </div>
          ) : (
            visibleThreads.map((thread) => (
              <ThreadRow
                key={thread.id}
                thread={thread}
                active={thread.id === selectedId}
                onSelect={handleSelect}
              />
            ))
          )}
        </div>
      </aside>

      {/* ── Conversation ──────────────────────────────────────── */}
      <section className={s.chatPane} aria-label="Діалог зі зверненням">
        {active ? (
          <>
            <header className={s.chatHeader}>
              <button
                type="button"
                className={s.backBtn}
                onClick={() => setSelectedId(null)}
                aria-label="Назад до списку"
              >
                <Icon.Back />
              </button>

              <Avatar customer={active.customer} status={active.status} size="lg" />

              <div className={s.chatHeaderInfo}>
                <span className={s.chatName}>{displayName(active.customer)}</span>
                <span className={s.chatContact}>
                  {active.customer.contact || "Контакт недоступний"}
                </span>
              </div>

              <div className={s.statusControl} data-status={active.status}>
                <select
                  className={s.statusSelect}
                  value={active.status}
                  onChange={(event) => handleStatusChange(event.target.value)}
                  aria-label="Статус звернення"
                >
                  {STATUS_ORDER.map((value) => (
                    <option key={value} value={value}>
                      {STATUS_META[value].label}
                    </option>
                  ))}
                </select>
              </div>
            </header>

            <div className={s.productContext}>
              <span className={s.prodIcon} aria-hidden="true">
                <Icon.Box />
              </span>
              <div className={s.prodText}>
                <span className={s.prodLabel}>Запитання щодо товару</span>
                <span className={s.prodName}>{active.product.name}</span>
                <span className={s.prodSku}>Артикул: {active.product.sku}</span>
              </div>
              <a
                className={s.prodLink}
                href={active.product.url}
                target="_blank"
                rel="noreferrer noopener"
              >
                Відкрити товар
              </a>
            </div>

            <div className={s.messages} ref={messagesRef}>
              <Conversation thread={active} />
            </div>

            {actionError && (
              <div className={s.actionError} role="alert">
                {actionError}
              </div>
            )}

            <form className={s.composer} onSubmit={handleSend}>
              <textarea
                ref={composerRef}
                className={s.composerInput}
                value={draft}
                onChange={handleDraftInput}
                onKeyDown={handleComposerKeyDown}
                placeholder="Напишіть відповідь клієнту…"
                rows={1}
                aria-label="Текст відповіді"
              />
              <button
                type="submit"
                className={s.sendBtn}
                disabled={!draft.trim() || sending}
                aria-label="Надіслати відповідь"
                data-sending={sending ? "true" : undefined}
              >
                <Icon.Send className={s.sendIcon} />
              </button>
            </form>
          </>
        ) : (
          <div className={s.chatEmpty}>
            <div className={s.chatEmptyArt} aria-hidden="true">
              <svg viewBox="0 0 120 120" fill="none">
                <rect x="20" y="24" width="80" height="58" rx="20" className={s.chatEmptyBubble} />
                <path d="M40 72 L62 72 L40 96 Z" className={s.chatEmptyBubble} />
                <path
                  d="M60 64c-10-7-18-13-18-22 0-6 5-9 9-9 4 0 7 2 9 5 2-3 5-5 9-5 4 0 9 3 9 9 0 9-8 15-18 22Z"
                  className={s.chatEmptyHeart}
                />
              </svg>
            </div>
            <h2 className={s.chatEmptyTitle}>Оберіть звернення</h2>
            <p className={s.chatEmptyText}>
              Виберіть діалог зі списку ліворуч, щоб переглянути запитання клієнта
              та відповісти на нього.
            </p>
          </div>
        )}
      </section>
    </section>
  );
}

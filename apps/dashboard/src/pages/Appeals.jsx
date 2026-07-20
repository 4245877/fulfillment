import React, { useEffect, useMemo, useRef, useState } from "react";

import { appealsApi } from "../api/appealsApi.js";
import s from "./Appeals.module.css";

const STATUS_META = {
  new: { label: "Новое" },
  in_progress: { label: "В работе" },
  closed: { label: "Закрыто" },
};

const FILTERS = [
  { value: "all", label: "Все" },
  { value: "new", label: "Новые" },
  { value: "in_progress", label: "В работе" },
  { value: "closed", label: "Закрытые" },
];

const STATUS_ORDER = ["new", "in_progress", "closed"];

/* ── Helpers ──────────────────────────────────────────────────── */

function displayName(customer) {
  return customer.name?.trim() || customer.contact?.trim() || "Анонимный клиент";
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
  if (diffMin < 1) return "только что";
  if (diffMin < 60) return `${diffMin} мин`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr} ч`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay === 1) return "вчера";
  if (diffDay < 7) return `${diffDay} дн`;
  return new Date(iso).toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
  });
}

function clockTime(iso) {
  return new Date(iso).toLocaleTimeString("ru-RU", {
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
  if (diffDays === 0) return "Сегодня";
  if (diffDays === 1) return "Вчера";
  return date.toLocaleDateString("ru-RU", {
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
    ? `${last.author === "operator" ? "Вы: " : ""}${last.text}`
    : "Без сообщений";

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
  const prevSelectedRef = useRef(null);

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
      .catch((err) => {
        // The API returns a clean { ok:false, error } message (e.g. "Сервис
        // обращений недоступен"); fall back to a generic line only when the
        // request never reached it (API down / network).
        if (alive)
          setListError(
            err?.body?.error ||
              "Ой… мне не удалось загрузить обращения. Проверьте, пожалуйста, подключение к сервису — я попробую ещё раз."
          );
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [refreshKey]);

  // Keep the conversation pinned to the newest message. Jump instantly when
  // switching threads; glide only for a new message in the open thread (and
  // never glide when the user prefers reduced motion).
  useEffect(() => {
    const node = messagesRef.current;
    if (!node) return;
    const switchedThread = prevSelectedRef.current !== selectedId;
    prevSelectedRef.current = selectedId;
    const reduceMotion = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    node.scrollTo({
      top: node.scrollHeight,
      behavior: switchedThread || reduceMotion ? "auto" : "smooth",
    });
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
    const prevThread = active; // snapshot for a clean rollback on failure
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
    } catch (err) {
      setActionError(
        err?.body?.error ||
          "Мне не удалось отправить сообщение. Попробуйте, пожалуйста, ещё раз — клиент не должен остаться без ответа."
      );
      // Full rollback: drop the optimistic message and restore the thread's
      // prior status and lastMessageAt (the send may have advanced new →
      // in_progress and bumped the list sort key).
      setThreads((prev) =>
        sortThreads(prev.map((thread) => (thread.id === id ? prevThread : thread)))
      );
      setDraft(text);
    } finally {
      setSending(false);
    }
  }

  async function handleStatusChange(status) {
    if (!active) return;
    const id = active.id;
    const prevStatus = active.status;
    setActionError("");
    setThreads((prev) =>
      prev.map((thread) => (thread.id === id ? { ...thread, status } : thread))
    );

    try {
      const thread = await appealsApi.setStatus(id, status);
      setThreads((prev) =>
        prev.map((item) => (item.id === thread.id ? thread : item))
      );
    } catch (err) {
      // Roll back so the UI never shows a status the service didn't accept.
      setThreads((prev) =>
        prev.map((thread) =>
          thread.id === id ? { ...thread, status: prevStatus } : thread
        )
      );
      setActionError(
        err?.body?.error ||
          "Мне не удалось изменить статус обращения. Попробуйте, пожалуйста, ещё раз."
      );
    }
  }

  return (
    <section
      className={s.page}
      data-pane={active ? "chat" : "list"}
      aria-label="Обращения клиентов"
    >
      {/* ── Inbox / thread list ───────────────────────────────── */}
      <aside className={s.listPane} aria-label="Список обращений">
        <header className={s.listHeader}>
          <div className={s.listTitleRow}>
            <div>
              <h1 className={s.title}>Обращения</h1>
              <p className={s.subtitle}>
                Вопросы покупателей о ваших изделиях — позаботимся, чтобы никто
                не остался без ответа ♡
              </p>
            </div>
            <button
              type="button"
              className={s.refreshBtn}
              onClick={() => setRefreshKey((value) => value + 1)}
              disabled={loading}
              aria-label="Обновить список обращений"
              title="Обновить"
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
              placeholder="Поиск по клиенту, товару, тексту…"
              aria-label="Поиск обращений"
            />
          </div>

          <div className={s.filters} role="group" aria-label="Фильтр по статусу">
            {FILTERS.map((filter) => (
              <button
                key={filter.value}
                type="button"
                aria-pressed={statusFilter === filter.value}
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
              <p>
                {threads.length === 0
                  ? "Пока обращений нет — всё спокойно ♡"
                  : "Ой… по этим условиям я ничего не нашла."}
              </p>
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
      <section className={s.chatPane} aria-label="Диалог с обращением">
        {active ? (
          <>
            <header className={s.chatHeader}>
              <button
                type="button"
                className={s.backBtn}
                onClick={() => setSelectedId(null)}
                aria-label="Назад к списку"
              >
                <Icon.Back />
              </button>

              <Avatar customer={active.customer} status={active.status} size="lg" />

              <div className={s.chatHeaderInfo}>
                <span className={s.chatName}>{displayName(active.customer)}</span>
                <span className={s.chatContact}>
                  {active.customer.contact || "Контакт недоступен"}
                </span>
              </div>

              <div className={s.statusControl} data-status={active.status}>
                <select
                  className={s.statusSelect}
                  value={active.status}
                  onChange={(event) => handleStatusChange(event.target.value)}
                  aria-label="Статус обращения"
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
                <span className={s.prodLabel}>Вопрос по товару</span>
                <span className={s.prodName}>{active.product.name}</span>
                <span className={s.prodSku}>Артикул: {active.product.sku}</span>
              </div>
              <a
                className={s.prodLink}
                href={active.product.url}
                target="_blank"
                rel="noreferrer noopener"
              >
                Открыть товар
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
                placeholder="Напишите ответ клиенту…"
                rows={1}
                aria-label="Текст ответа"
              />
              <button
                type="submit"
                className={s.sendBtn}
                disabled={!draft.trim() || sending}
                aria-label="Отправить ответ"
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
                <defs>
                  <linearGradient id="appealsEmptyHeart" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" className={s.chatEmptyHeartStop1} />
                    <stop offset="1" className={s.chatEmptyHeartStop2} />
                  </linearGradient>
                </defs>
                {/* One continuous speech bubble — body and tail share a single
                    outline, so the pointer joins seamlessly (no severed edge,
                    no stray inner stroke). */}
                <path
                  className={s.chatEmptyBubble}
                  d="M20 40 C20 30.1 28.1 22 38 22 L82 22 C91.9 22 100 30.1 100 40 L100 60 C100 69.9 91.9 78 82 78 L58 78 L33 96 L46 78 L38 78 C28.1 78 20 69.9 20 60 Z"
                />
                <path
                  className={s.chatEmptyHeart}
                  d="M60 60 C52 54 45 50 45 42 C45 36 47 32 51 32 C55 32 58 35 60 37 C62 35 65 32 69 32 C73 32 75 36 75 42 C75 50 68 54 60 60 Z"
                />
                <path
                  className={s.chatEmptySparkle}
                  d="M90 28 L91.4 31.6 L95 33 L91.4 34.4 L90 38 L88.6 34.4 L85 33 L88.6 31.6 Z"
                />
                <path
                  className={s.chatEmptySparkle}
                  style={{ animationDelay: "1.1s" }}
                  d="M32 52 L33.12 54.88 L36 56 L33.12 57.12 L32 60 L30.88 57.12 L28 56 L30.88 54.88 Z"
                />
              </svg>
            </div>
            <h2 className={s.chatEmptyTitle}>Выберите обращение</h2>
            <p className={s.chatEmptyText}>
              Выберите диалог из списка слева — и я покажу вопрос клиента,
              чтобы вы могли ответить.
            </p>
          </div>
        )}
      </section>
    </section>
  );
}

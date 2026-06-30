// Appeals (Звернення) — customer ⇄ operator chat data layer.
//
// The backend for appeals is not built yet, so this module serves an in-memory
// mock store that behaves like the real thing: it persists for the browser
// session, orders threads by latest activity, and returns fresh copies so the
// UI never mutates the store directly.
//
// ── Wiring the real backend later ───────────────────────────────────────────
// Each method below maps 1:1 to an intended REST endpoint. When the API lands,
// replace the body of each method with the matching `api.*` call (the import is
// ready) and delete the mock store — the page component needs no changes.
//
//   list()              → GET    /api/appeals
//   get(id)             → GET    /api/appeals/:id
//   markRead(id)        → POST   /api/appeals/:id/read
//   sendMessage(id,txt) → POST   /api/appeals/:id/messages   { text }
//   setStatus(id,status)→ PATCH  /api/appeals/:id            { status }
//
// import { api } from "./client.js";

const now = Date.now();
const minutesAgo = (m) => new Date(now - m * 60_000).toISOString();
const hoursAgo = (h) => minutesAgo(h * 60);
const daysAgo = (d) => minutesAgo(d * 60 * 24);

let messageSeq = 1000;
const nextMessageId = () => `msg-${++messageSeq}`;

// Seed conversations. Statuses: "new" | "in_progress" | "closed".
const store = [
  {
    id: "apl-1042",
    status: "new",
    unread: 1,
    createdAt: minutesAgo(3),
    lastMessageAt: minutesAgo(3),
    customer: { name: "Олена Ковальчук", contact: "+380 67 123 45 67" },
    product: {
      id: "NL-MOON-15",
      name: "Нічник «Місяць» 15 см",
      sku: "NL-MOON-15",
      url: "/product/nl-moon-15",
    },
    messages: [
      {
        id: nextMessageId(),
        author: "customer",
        text: "Доброго дня! Чи можливо виготовити нічник «Місяць» діаметром 20 см замість 15? І чи буде світло теплим?",
        at: minutesAgo(3),
      },
    ],
  },
  {
    id: "apl-1041",
    status: "new",
    unread: 1,
    createdAt: minutesAgo(15),
    lastMessageAt: minutesAgo(15),
    customer: { name: "Назар Кравець", contact: "+380 63 222 11 00" },
    product: {
      id: "NL-DRAGON",
      name: "Геометричний нічник «Дракон»",
      sku: "NL-DRAGON",
      url: "/product/nl-dragon",
    },
    messages: [
      {
        id: nextMessageId(),
        author: "customer",
        text: "Доброго! Світиться рівномірно чи помітно шари друку?",
        at: minutesAgo(15),
      },
    ],
  },
  {
    id: "apl-1039",
    status: "in_progress",
    unread: 0,
    createdAt: hoursAgo(2),
    lastMessageAt: minutesAgo(25),
    customer: { name: "Андрій Мельник", contact: "@andriy_m" },
    product: {
      id: "HS-WAVE",
      name: "Підставка для навушників «Хвиля»",
      sku: "HS-WAVE",
      url: "/product/hs-wave",
    },
    messages: [
      {
        id: nextMessageId(),
        author: "customer",
        text: "Вітаю! Яку вагу витримує підставка? У мене масивні студійні навушники.",
        at: hoursAgo(2),
      },
      {
        id: nextMessageId(),
        author: "operator",
        text: "Доброго дня, Андрію! Підставка спокійно тримає до 1.5 кг — навіть великі студійні навушники не проблема 🙂",
        at: minutesAgo(115),
      },
      {
        id: nextMessageId(),
        author: "customer",
        text: "Чудово, дякую! А які кольори є в наявності?",
        at: minutesAgo(28),
      },
      {
        id: nextMessageId(),
        author: "operator",
        text: "Є графіт, мʼятний, пудровий і білий. Можу скинути фото зразків, якщо зручно.",
        at: minutesAgo(25),
      },
    ],
  },
  {
    id: "apl-1036",
    status: "new",
    unread: 2,
    createdAt: hoursAgo(1),
    lastMessageAt: hoursAgo(1),
    customer: { name: "", contact: "@kvitka" },
    product: {
      id: "PLNT-GEO",
      name: "Кашпо для сукулентів «Гео»",
      sku: "PLNT-GEO",
      url: "/product/plnt-geo",
    },
    messages: [
      {
        id: nextMessageId(),
        author: "customer",
        text: "Скільки коштує доставка по Україні?",
        at: minutesAgo(65),
      },
      {
        id: nextMessageId(),
        author: "customer",
        text: "І чи є самовивіз у Львові?",
        at: hoursAgo(1),
      },
    ],
  },
  {
    id: "apl-1031",
    status: "in_progress",
    unread: 1,
    createdAt: daysAgo(1),
    lastMessageAt: hoursAgo(4),
    customer: { name: "Софія Бондаренко", contact: "sofia.b@gmail.com" },
    product: {
      id: "VS-SPIRAL-25",
      name: "Ваза «Спіраль» 25 см",
      sku: "VS-SPIRAL-25",
      url: "/product/vs-spiral-25",
    },
    messages: [
      {
        id: nextMessageId(),
        author: "customer",
        text: "Замовила вазу, підкажіть, коли буде готова?",
        at: daysAgo(1),
      },
      {
        id: nextMessageId(),
        author: "operator",
        text: "Доброго дня, Софіє! Вже друкуємо, відправимо завтра Новою поштою ✨",
        at: minutesAgo(60 * 23),
      },
      {
        id: nextMessageId(),
        author: "customer",
        text: "Дякую! А чи можна додати листівку до замовлення?",
        at: hoursAgo(4),
      },
    ],
  },
  {
    id: "apl-1020",
    status: "closed",
    unread: 0,
    createdAt: daysAgo(2),
    lastMessageAt: daysAgo(2),
    customer: { name: "Дмитро Шевченко", contact: "+380 50 987 65 43" },
    product: {
      id: "PH-CAT",
      name: "Тримач для телефону «Котик»",
      sku: "PH-CAT",
      url: "/product/ph-cat",
    },
    messages: [
      {
        id: nextMessageId(),
        author: "customer",
        text: "Чи підійде тримач для iPhone 15 Pro Max у чохлі?",
        at: daysAgo(2),
      },
      {
        id: nextMessageId(),
        author: "operator",
        text: "Так, тримач універсальний — підійде навіть у товстому чохлі 👍",
        at: minutesAgo(60 * 24 * 2 - 30),
      },
      {
        id: nextMessageId(),
        author: "customer",
        text: "Супер, дякую!",
        at: minutesAgo(60 * 24 * 2 - 35),
      },
    ],
  },
  {
    id: "apl-1004",
    status: "closed",
    unread: 0,
    createdAt: daysAgo(5),
    lastMessageAt: daysAgo(5),
    customer: { name: "Марія Ткаченко", contact: "@maria_tk" },
    product: {
      id: "KEY-INIT",
      name: "Брелок з ініціалами",
      sku: "KEY-INIT",
      url: "/product/key-init",
    },
    messages: [
      {
        id: nextMessageId(),
        author: "customer",
        text: "Можна брелок з літерами «М» та «Д»?",
        at: daysAgo(5),
      },
      {
        id: nextMessageId(),
        author: "operator",
        text: "Звичайно! Зробимо персональний брелок із вашими ініціалами. Який колір бажаєте?",
        at: minutesAgo(60 * 24 * 5 - 20),
      },
      {
        id: nextMessageId(),
        author: "customer",
        text: "Рожевий 💕 дякую!",
        at: minutesAgo(60 * 24 * 5 - 40),
      },
      {
        id: nextMessageId(),
        author: "operator",
        text: "Прийнято, передаю в роботу 🌸",
        at: minutesAgo(60 * 24 * 5 - 45),
      },
    ],
  },
];

const clone = (value) =>
  typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const byLatest = (a, b) =>
  new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime();

const find = (id) => store.find((thread) => thread.id === id);

export const appealsApi = {
  async list() {
    // GET /api/appeals
    await delay(260);
    return clone(store).sort(byLatest);
  },

  async get(id) {
    // GET /api/appeals/:id
    await delay(120);
    const thread = find(id);
    return thread ? clone(thread) : null;
  },

  async markRead(id) {
    // POST /api/appeals/:id/read
    const thread = find(id);
    if (thread) thread.unread = 0;
    return thread ? clone(thread) : null;
  },

  async sendMessage(id, text) {
    // POST /api/appeals/:id/messages
    await delay(180);
    const thread = find(id);
    if (!thread) throw new Error("Звернення не знайдено");

    const message = {
      id: nextMessageId(),
      author: "operator",
      text: String(text).trim(),
      at: new Date().toISOString(),
    };

    thread.messages.push(message);
    thread.lastMessageAt = message.at;
    // Answering a brand-new appeal moves it into active work automatically.
    if (thread.status === "new") thread.status = "in_progress";

    return { message: clone(message), thread: clone(thread) };
  },

  async setStatus(id, status) {
    // PATCH /api/appeals/:id
    await delay(140);
    const thread = find(id);
    if (!thread) throw new Error("Звернення не знайдено");
    thread.status = status;
    return clone(thread);
  },
};

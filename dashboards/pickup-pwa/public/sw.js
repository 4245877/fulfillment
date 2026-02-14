self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// минимальный “пустой” SW, чтобы registration не был 404
self.addEventListener("fetch", () => {});

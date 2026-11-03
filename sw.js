// Кэш для повторных заходов: стили, скрипты, шрифты и фото берутся с телефона, а не скачиваются заново —
// сайт и вкладки открываются сразу, даже на медленной сети. GitHub Pages разрешает браузеру хранить файлы
// только 10 минут, поэтому без этого кэша каждый новый заход заново спрашивает каждый файл.
// Страница (index.html) всегда берётся свежая из сети, а через неё — новые версии файлов (?v=… от tools/bust.mjs).
const CACHE = "nss-v1";
const MAX = 400; // сколько файлов держать, старые удаляются

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));

let puts = 0;
const put = async (req, res) => {
  const c = await caches.open(CACHE);
  await c.put(req, res);
  // изредка подрезаем кэш: ключи идут в порядке добавления, удаляем самые старые
  if (++puts % 50 === 0) { const keys = await c.keys(); for (const k of keys.slice(0, Math.max(0, keys.length - MAX))) await c.delete(k); }
};
const fromNet = (req) => fetch(req).then((res) => { if (res.ok || res.type === "opaque") put(req, res.clone()); return res; });

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || req.headers.has("range")) return; // видео грузится кусками — его не трогаем
  const u = new URL(req.url);
  const own = u.origin === location.origin;
  if (own && /\.mp4$/.test(u.pathname)) return;

  // страница: свежая из сети; сеть не ответила за 3 секунды или её нет — сохранённая копия
  if (req.mode === "navigate") {
    e.respondWith((async () => {
      const net = fromNet(req);
      const saved = await caches.match(req, { ignoreSearch: true });
      if (!saved) return net.catch(() => caches.match("./"));
      return Promise.race([net, new Promise((r) => setTimeout(() => r(saved), 3000))]).catch(() => saved);
    })());
    return;
  }
  // файлы с версией (?v=…) и шрифты Google никогда не меняются по тому же адресу — сразу из кэша
  if ((own && u.searchParams.has("v")) || u.host === "fonts.gstatic.com") {
    e.respondWith(caches.match(req).then((m) => m || fromNet(req)));
    return;
  }
  // остальное своё и стили шрифтов: сразу из кэша, а в фоне обновляем на следующий раз
  if (own || u.host === "fonts.googleapis.com") {
    e.respondWith(caches.match(req).then((m) => {
      const net = fromNet(req).catch(() => m);
      if (m) { e.waitUntil(net); return m; }
      return net;
    }));
  }
  // Supabase (заказы, отзывы, вход) и всё прочее — напрямую, без кэша
});

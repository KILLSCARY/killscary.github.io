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

const IMG = /\.(webp|jpe?g|png|gif|svg)(\?|$)/i;
const put = async (req, res) => {
  const c = await caches.open(CACHE);
  await c.put(req, res);
  const u = new URL(req.url);
  // новая версия своего файла (?v=…): из прежних оставляем одну — её ещё может попросить страница из кэша
  if (u.origin === location.origin && u.searchParams.has("v")) {
    const old = (await c.keys()).filter((k) => { const x = new URL(k.url); return x.pathname === u.pathname && x.search !== u.search; });
    for (const k of old.slice(0, -1)) await c.delete(k);
  }
  // изредка подрезаем кэш — только картинки (самые старые первыми). Скрипты и стили не трогаем:
  // раньше они как самые старые записи удалялись первыми, и без сети страница открывалась без JS.
  // Счётчик в памяти обнуляется при каждом перезапуске SW, поэтому — случайная выборка, примерно раз в 20 записей.
  if (Math.random() < 0.05) {
    const imgs = (await c.keys()).filter((k) => IMG.test(k.url));
    for (const k of imgs.slice(0, Math.max(0, imgs.length - MAX))) await c.delete(k);
  }
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
      e.waitUntil(net.catch(() => {})); // копия в кэше обновится, даже если ответили сохранённой
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

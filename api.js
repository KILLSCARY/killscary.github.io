// Слой данных профиля: вход, профиль, заказы, отзывы.
// Две реализации с одинаковым интерфейсом:
//   demo     — всё в localStorage этого браузера (когда в config.js нет ключей);
//   supabase — настоящая база, вход через бота @nssauth_bot, фото в Storage;
//              заказы и отзывы уходят менеджерам в бота (функция tg-bot).
// Все методы асинхронные и бросают Error с русским текстом, пригодным для показа.
(() => {
  const cfg = window.NSS_CONFIG || {};
  const ORDER_STATUSES = ["new", "confirmed", "shipped", "delivered", "cancelled"];

  const fail = (msg) => { throw new Error(msg); };
  function checkReview(r) {
    if (!r.product_id) fail("Выберите товар");
    if (!Number.isInteger(r.rating) || r.rating < 1 || r.rating > 5) fail("Поставьте оценку от 1 до 5");
    const t = String(r.text || "").trim();
    if (t.length < 10) fail("Напишите хотя бы пару предложений — от 10 символов");
    if (t.length > 2000) fail("Отзыв слишком длинный — до 2000 символов");
    if ((r.files || []).length > 5) fail("Можно прикрепить до 5 фото");
    return t;
  }
  const cut = (v, n) => String(v || "").trim().slice(0, n);
  function cleanTelegram(v) {
    const tg = cut(v, 40).replace(/^https?:\/\/t\.me\//i, "").replace(/^@+/, "");
    if (tg && !/^[A-Za-z0-9_]{4,32}$/.test(tg)) fail("Telegram: укажите @username — латиница, цифры и _");
    return tg ? "@" + tg : "";
  }
  function cleanProfile(p) {
    return { name: cut(p.name, 80), phone: cut(p.phone, 32), telegram: cleanTelegram(p.telegram), city: cut(p.city, 80) };
  }
  // покупатель сам может отменить заказ, пока его не отправили (то же правило — в функции tg-bot)
  const CANCELLABLE = ["new", "confirmed"];
  // способы доставки и оплаты (те же коды — в базе и в функции tg-bot)
  // price — стоимость доставки для покупателя (тарифы магазина: поменять здесь), days — срок
  const DELIVERY = {
    cdek_pvz: { label: "СДЭК — пункт выдачи", days: "3–5 дней", price: 350, address: "Адрес пункта выдачи СДЭК" },
    cdek_courier: { label: "СДЭК — курьер до двери", days: "3–5 дней", price: 600, address: "Улица, дом, квартира" },
    post: { label: "Почта России", days: "3–5 дней, до отделения", price: 400, address: "Улица, дом, квартира" },
    spb_courier: { label: "Курьер по Санкт-Петербургу", days: "1–2 дня, время согласует менеджер", price: 500, address: "Улица, дом, квартира", city: "Санкт-Петербург" },
  };
  const FREE_DELIVERY_FROM = 10000; // от этой суммы товаров (после скидки) доставка бесплатная
  const shipPrice = (method, goods) => (goods >= FREE_DELIVERY_FROM ? 0 : DELIVERY[method]?.price ?? 0);
  const PAYMENT = { on_confirm: "После подтверждения заказа менеджером" };
  const goodsSum = (items) => items.reduce((s, i) => s + (Number(i.price) || 0) * i.qty, 0);
  const cleanPromo = (v) => String(v || "").trim().toUpperCase();
  function checkOrder(o) {
    if (!Array.isArray(o.items) || !o.items.length) fail("Корзина пуста");
    for (const it of o.items) if (!it.id || !(it.qty > 0)) fail("Ошибка в составе заказа");
    const c = o.contact || {}, d = o.delivery || {};
    const contact = { name: cut(c.name, 80), phone: cut(c.phone, 32), telegram: cleanTelegram(c.telegram) };
    if (contact.name.length < 2) fail("Укажите имя и фамилию получателя");
    const digits = contact.phone.replace(/\D/g, "");
    if (!/^[+\d\s()-]+$/.test(contact.phone) || digits.length < 10 || digits.length > 15) fail("Проверьте номер телефона — например, +7 900 000-00-00");
    const m = DELIVERY[d.method];
    if (!m) fail("Выберите способ доставки");
    const delivery = { method: d.method, city: m.city || cut(d.city, 80), address: cut(d.address, 200), zip: d.method === "post" ? cut(d.zip, 6) : "" };
    if (!delivery.city) fail("Укажите город");
    if (delivery.address.length < 5) fail(d.method === "cdek_pvz" ? "Укажите адрес пункта выдачи СДЭК" : "Укажите адрес доставки");
    if (d.method === "post" && !/^\d{6}$/.test(delivery.zip)) fail("Индекс — 6 цифр");
    if (!PAYMENT[o.payment]) fail("Выберите способ оплаты");
    // скидка — та, что показал promo_check; функция tg-bot перепроверит код перед отправкой менеджеру
    const goods = goodsSum(o.items);
    const promo = o.promo ? cleanPromo(o.promo) : null;
    if (promo && !/^[A-Z0-9_-]{3,32}$/.test(promo)) fail("Проверьте промокод");
    const discount = promo ? Math.max(0, Math.min(Math.round(o.discount || 0), goods)) : 0;
    delivery.price = shipPrice(d.method, goods - discount);
    const total = goods - discount + delivery.price;
    return { items: o.items, total, comment: cut(o.comment, 1000), contact, delivery, payment: o.payment, promo, discount };
  }
  const checkQuestion = (q) => {
    const text = String(q.text || "").trim();
    if (!q.product_id) fail("Товар не найден");
    if (text.length < 5) fail("Вопрос слишком короткий — от 5 символов");
    if (text.length > 1000) fail("Вопрос слишком длинный — до 1000 символов");
    return text;
  };
  const NOT_BOUGHT = "Отзыв можно оставить только на товар из полученного заказа";
  const REVIEW_KEY = /^([0-9]{1,9}|u-[0-9a-f-]{36})$/;

  // ================= DEMO =================
  function demoAdapter() {
    const DB_KEY = "nss-demo-db", SES_KEY = "nss-demo-session";
    const read = () => { try { return JSON.parse(localStorage.getItem(DB_KEY)) || { users: {}, seq: 1000 }; } catch { return { users: {}, seq: 1000 }; } };
    const write = (db) => {
      try { localStorage.setItem(DB_KEY, JSON.stringify(db)); }
      catch { fail("В браузере закончилось место для демо-данных. Удалите старые отзывы с фото."); }
    };
    const uid = () => (crypto.randomUUID ? crypto.randomUUID() : "u" + Date.now() + Math.random().toString(16).slice(2));
    const listeners = new Set();
    const session = () => { try { return JSON.parse(localStorage.getItem(SES_KEY)); } catch { return null; } };
    const me = (db = read()) => { const s = session(); return s && db.users[s.key] ? db.users[s.key] : null; };
    const need = (db) => me(db) || fail("Войдите в профиль");
    const pub = (u) => (u ? { id: u.id, name: u.profile.name || u.tgName, username: u.username, photo: null } : null);
    const emit = () => { const u = pub(me()); listeners.forEach((cb) => cb(u)); };
    const blobToDataUrl = (b) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error("Не удалось прочитать фото")); r.readAsDataURL(b); });

    return {
      mode: "demo",
      async getUser() { return pub(me()); },
      onAuth(cb) { listeners.add(cb); return () => listeners.delete(cb); },
      // демо-вход вместо Telegram: имя и @username вводятся вручную, ничего не проверяется
      async loginDemo({ name, username }) {
        name = String(name || "").trim().slice(0, 80);
        username = String(username || "").trim().replace(/^@+/, "").slice(0, 32);
        if (!name) fail("Введите имя");
        if (username && !/^[A-Za-z0-9_]{3,32}$/.test(username)) fail("Username в Telegram — латиница, цифры и _");
        const key = username ? "@" + username.toLowerCase() : "name:" + name.toLowerCase();
        const db = read();
        db.users[key] ||= { id: uid(), tgName: name, username: username || null, profile: { name, telegram: username ? "@" + username : "" }, orders: [], reviews: [] };
        write(db);
        localStorage.setItem(SES_KEY, JSON.stringify({ key }));
        emit();
        return pub(db.users[key]);
      },
      async signOut() { localStorage.removeItem(SES_KEY); emit(); },
      async getProfile() { return { ...need(read()).profile }; },
      async saveProfile(p) { const db = read(); need(db).profile = cleanProfile(p); write(db); return { ...need(db).profile }; },
      async listOrders() { return [...need(read()).orders].sort((a, b) => b.created_at.localeCompare(a.created_at)); },
      async createOrder(o) {
        const clean = checkOrder(o);
        const db = read(), u = need(db);
        const order = { id: uid(), number: ++db.seq, status: "new", ...clean, created_at: new Date().toISOString() };
        u.orders.push(order); write(db);
        return { ...order, notified: true };
      },
      async listMyReviews() { return [...need(read()).reviews].sort((a, b) => b.created_at.localeCompare(a.created_at)); },
      async createReview(r) {
        const text = checkReview(r);
        if (need(read()).reviews.some((x) => x.product_id === r.product_id)) fail("Вы уже оставили отзыв на этот товар");
        // как в базе: отзыв — только на товар из доставленного заказа
        // набор в старом заказе может быть записан как «set-<номер>»: сравниваем постоянные id
        const canon = window.NSS?.canonId || ((id) => id);
        if (!need(read()).orders.some((o) => o.status === "delivered" && o.items.some((i) => canon(i.id) === r.product_id))) fail(NOT_BOUGHT);
        const photos = [];
        for (const f of r.files || []) photos.push(await blobToDataUrl(f));
        const db = read(), u = need(db);
        const rev = { id: uid(), product_id: r.product_id, rating: r.rating, text, photos, author_name: (u.profile.name || "").trim() || null, status: "pending", created_at: new Date().toISOString() };
        u.reviews.push(rev); write(db);
        return rev;
      },
      async deleteReview(id) {
        const db = read(), u = need(db);
        const r = u.reviews.find((x) => x.id === id);
        if (!r) fail("Отзыв не найден");
        if (r.status !== "pending") fail("Опубликованный отзыв удалить нельзя — напишите магазину");
        u.reviews = u.reviews.filter((x) => x.id !== id); write(db);
      },
      async listPublicReviews() {
        const out = [];
        for (const u of Object.values(read().users)) for (const r of u.reviews) if (r.status === "approved") {
          const verified = u.orders.some((o) => o.status === "delivered" && o.items.some((i) => i.id === r.product_id));
          out.push({ id: r.id, product_id: r.product_id, rating: r.rating, text: r.text, photos: r.photos, created_at: r.created_at, author: r.author_name || "Покупатель", verified });
        }
        return out.sort((a, b) => b.created_at.localeCompare(a.created_at));
      },
      // инструменты демо-режима: в Supabase это делает магазин в панели управления
      async demoAdvanceOrder(id) {
        const db = read(), o = need(db).orders.find((x) => x.id === id);
        if (!o) fail("Заказ не найден");
        const flow = ["new", "confirmed", "shipped", "delivered"], i = flow.indexOf(o.status);
        if (i >= 0 && i < flow.length - 1) o.status = flow[i + 1];
        write(db); return o;
      },
      async cancelOrder(id) {
        const db = read(), o = need(db).orders.find((x) => x.id === id);
        if (!o || !CANCELLABLE.includes(o.status)) fail("Заказ уже отправлен или отменён — отменить его можно только через менеджера в боте");
        o.status = "cancelled"; write(db); return o;
      },
      async demoModerate(approve) { const db = read(); need(db).reviews.forEach((r) => { if (r.status === "pending") r.status = approve ? "approved" : "rejected"; }); write(db); },
      // наличие в демо: отметки хранятся в этом браузере (в Supabase их ставит менеджер в боте)
      async listStock() { return { ...(read().stock || {}) }; },
      async demoSetStock(id, inStock) { const db = read(); (db.stock ||= {})[id] = !!inStock; write(db); },
      // промокоды демо-режима (в Supabase их заводит менеджер командой /promo в боте)
      async checkPromo(code, goods) {
        const demo = { DEMO10: { percent: 10, min: 0 }, DEMO500: { amount: 500, min: 3000 } }[cleanPromo(code)];
        if (!demo) fail("Промокод не найден или больше не действует");
        if (goods < demo.min) fail(`Промокод действует для заказа от ${demo.min.toLocaleString("ru-RU")} ₽`);
        const discount = demo.percent ? Math.floor(goods * demo.percent / 100) : Math.min(demo.amount, goods);
        return { code: cleanPromo(code), discount, label: demo.percent ? `−${demo.percent}%` : `−${demo.amount} ₽` };
      },
      async stockSubscribe(productId) {
        const db = read(), u = need(db);
        u.alerts = [...new Set([...(u.alerts || []), productId])]; write(db);
      },
      async myStockAlerts() { return [...(me()?.alerts || [])]; },
      async askQuestion(q) {
        const text = checkQuestion(q), db = read(), u = need(db);
        (db.questions ||= []).push({ id: uid(), product_id: q.product_id, text, author: u.profile.name || "Покупатель", answer: null, created_at: new Date().toISOString() });
        write(db);
      },
      async listPublicQuestions() { return (read().questions || []).filter((q) => q.answer); },
      // в демо отвечает «магазин» — для проверки, как ответ выглядит на сайте
      async demoAnswerQuestions(answer) { const db = read(); (db.questions || []).forEach((q) => { if (!q.answer) Object.assign(q, { answer, answered_at: new Date().toISOString() }); }); write(db); },
      async helpfulCounts() {
        const out = {};
        for (const [k, users] of Object.entries(read().votes || {})) if (users.length) out[k] = users.length;
        return out;
      },
      async myVotes() { const u = me(); return u ? Object.entries(read().votes || {}).filter(([, users]) => users.includes(u.id)).map(([k]) => k) : []; },
      async setHelpful(key, on) {
        if (!REVIEW_KEY.test(key)) fail("Отзыв не найден");
        const db = read(), u = need(db), votes = (db.votes ||= {});
        const set = new Set(votes[key] || []);
        on ? set.add(u.id) : set.delete(u.id);
        votes[key] = [...set]; write(db);
      },
    };
  }

  // ================= SUPABASE =================
  // библиотека лежит на нашем сайте (vendor/supabase.js) и подключена в index.html;
  // запасной путь — подгрузить её самим, но не дольше 10 секунд
  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement("script"); s.src = src; s.onload = res;
      s.onerror = () => rej(new Error("Не удалось загрузить Supabase"));
      setTimeout(() => rej(new Error("Supabase не загрузился за 10 секунд")), 10000);
      document.head.appendChild(s);
    });
  }
  async function supabaseAdapter() {
    if (!window.supabase) await loadScript("vendor/supabase.js");
    const BASE = String(cfg.supabaseUrl).trim().replace(/\/+$/, ""); // без слэша на конце
    const sb = window.supabase.createClient(BASE, cfg.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true } });
    const BUCKET = "review-photos";
    // в базе — пути «<user_id>/<uuid>.jpg», наружу отдаём готовые ссылки
    const photoUrl = (path) => `${BASE}/storage/v1/object/public/${BUCKET}/${path.split("/").map(encodeURIComponent).join("/")}`;
    const withUrls = (r) => ({ ...r, photos: (r.photos || []).map(photoUrl) });
    const ok = ({ data, error }, msg) => { if (error) { console.error(error); fail(msg || error.message); } return data; };
    async function need() { const { data } = await sb.auth.getSession(); return data.session?.user || fail("Войдите в профиль"); }
    // вызов функции бота; токен пользователя — в x-user-token
    async function fn(body, withUser) {
      const headers = { "Content-Type": "application/json", apikey: cfg.supabaseAnonKey, Authorization: `Bearer ${cfg.supabaseAnonKey}` };
      if (withUser) { const { data } = await sb.auth.getSession(); if (data.session) headers["x-user-token"] = data.session.access_token; }
      let res;
      try { res = await fetch(`${BASE}/functions/v1/tg-bot`, { method: "POST", headers, body: JSON.stringify(body) }); }
      catch { fail("Нет связи с сервером. Проверьте интернет"); }
      const out = await res.json().catch(() => ({}));
      if (!res.ok) fail(out.error || "Ошибка сервера. Попробуйте ещё раз");
      return out;
    }
    const listeners = new Set();
    // имя и @username берутся из Telegram — их кладёт в метаданные функция tg-bot
    const pubUser = (u) => (u ? { id: u.id, name: u.user_metadata?.name || "Покупатель", username: u.user_metadata?.username || null, photo: u.user_metadata?.photo_url || null } : null);
    // слушателей зовём после выхода из колбэка: вызовы Supabase прямо внутри onAuthStateChange
    // ждут ту же блокировку сессии и могут зависнуть навсегда
    sb.auth.onAuthStateChange((_e, s) => { const u = pubUser(s?.user); setTimeout(() => listeners.forEach((cb) => cb(u)), 0); });

    return {
      mode: "supabase",
      async getUser() { const { data } = await sb.auth.getSession(); return pubUser(data.session?.user); },
      onAuth(cb) { listeners.add(cb); return () => listeners.delete(cb); },
      // Вход через бота: сайт получает одноразовый код и ссылку t.me/<бот>?start=l_<код>,
      // покупатель жмёт «Подтвердить вход» в боте, сайт опрашивает функцию и получает токен входа.
      botLoginStart: () => fn({ action: "login_start" }),
      async botLoginPoll(code) {
        const r = await fn({ action: "login_poll", code });
        if (r.status !== "ok") return { status: r.status };
        const { data, error } = await sb.auth.verifyOtp({ token_hash: r.token_hash, type: "magiclink" });
        if (error) { console.error(error); fail("Не удалось войти. Попробуйте ещё раз"); }
        return { status: "ok", user: pubUser(data.user) };
      },
      async signOut() { await sb.auth.signOut(); },
      async getProfile() {
        const u = await need();
        return ok(await sb.from("profiles").select("name, phone, telegram, city").eq("id", u.id).maybeSingle(), "Не удалось загрузить профиль") || {};
      },
      async saveProfile(p) {
        const u = await need();
        return ok(await sb.from("profiles").upsert({ id: u.id, ...cleanProfile(p) }).select("name, phone, telegram, city").single(), "Не удалось сохранить профиль");
      },
      async listOrders() {
        await need();
        return ok(await sb.from("orders").select("*").order("created_at", { ascending: false }), "Не удалось загрузить заказы");
      },
      async createOrder(o) {
        // номер, статус «new» и даты ставит база (на эти колонки у покупателя нет прав)
        const u = await need(), clean = checkOrder(o);
        const order = ok(await sb.from("orders").insert({ user_id: u.id, ...clean }).select().single(), "Не удалось сохранить заказ");
        // заказ — менеджерам в бота и подтверждение покупателю
        const sent = await fn({ action: "order_notify", order_id: order.id }, true).catch((e) => { console.error(e); return {}; });
        return { ...order, notified: !!(sent.ok || sent.already) };
      },
      // отмена — через функцию бота: она проверит статус и сообщит менеджерам
      async cancelOrder(id) { await need(); return (await fn({ action: "order_cancel", order_id: id }, true)).order; },
      async listMyReviews() {
        const u = await need();
        const rows = ok(await sb.from("reviews").select("*").eq("user_id", u.id).order("created_at", { ascending: false }), "Не удалось загрузить отзывы");
        return rows.map(withUrls);
      },
      async createReview(r) {
        const u = await need(), text = checkReview(r);
        const uploaded = [];
        try {
          for (const f of r.files || []) {
            const path = `${u.id}/${crypto.randomUUID()}.jpg`;
            ok(await sb.storage.from(BUCKET).upload(path, f, { contentType: "image/jpeg", upsert: false }), "Не удалось загрузить фото");
            uploaded.push(path);
          }
          const profile = await this.getProfile().catch(() => ({}));
          // в базу пишем пути, статус «pending» и дату ставит база
          const res = await sb.from("reviews").insert({ user_id: u.id, product_id: r.product_id, rating: r.rating, text, photos: uploaded, author_name: (profile.name || u.user_metadata?.name || "").trim() || null }).select().single();
          if (res.error?.code === "23505") fail("Вы уже оставили отзыв на этот товар");
          if (res.error?.code === "42501") fail(NOT_BOUGHT); // правило базы: товара нет в доставленных заказах
          const rev = withUrls(ok(res, "Не удалось сохранить отзыв"));
          // отзыв — менеджерам в бота на модерацию (не мешает сохранению, если бот недоступен)
          fn({ action: "review_notify", review_id: rev.id, product_name: r.product_name }, true).catch((e) => console.error(e));
          return rev;
        } catch (e) {
          // не оставляем «сиротские» фото, если отзыв не сохранился
          if (uploaded.length) await sb.storage.from(BUCKET).remove(uploaded).catch((er) => console.error(er));
          throw e;
        }
      },
      async deleteReview(id) {
        const u = await need();
        const rev = ok(await sb.from("reviews").select("photos, status").eq("id", id).eq("user_id", u.id).maybeSingle(), "Отзыв не найден") || fail("Отзыв не найден");
        if (rev.status !== "pending") fail("Опубликованный отзыв удалить нельзя — напишите магазину");
        ok(await sb.from("reviews").delete().eq("id", id), "Не удалось удалить отзыв");
        if (rev.photos?.length) await sb.storage.from(BUCKET).remove(rev.photos).catch((er) => console.error(er));
      },
      async listPublicReviews() {
        const rows = ok(await sb.from("public_reviews").select("*").order("created_at", { ascending: false }).limit(300), "Не удалось загрузить отзывы");
        return rows.map(withUrls);
      },
      // наличие: { id товара: true/false } — менеджер переключает его в боте (/stock)
      async listStock() {
        const rows = ok(await sb.from("stock").select("product_id, in_stock"), "") || [];
        return Object.fromEntries(rows.map((r) => [r.product_id, r.in_stock]));
      },
      // промокод проверяет функция: таблица кодов покупателю не видна
      checkPromo: (code, goods) => fn({ action: "promo_check", code: cleanPromo(code), goods }),
      async stockSubscribe(productId, productName) { await need(); await fn({ action: "stock_subscribe", product_id: productId, product_name: productName }, true); },
      async myStockAlerts() {
        const { data } = await sb.auth.getSession();
        if (!data.session) return [];
        return (ok(await sb.from("stock_alerts").select("product_id").is("notified_at", null), "") || []).map((r) => r.product_id);
      },
      async askQuestion(q) {
        await need();
        const text = checkQuestion(q);
        await fn({ action: "question_ask", product_id: q.product_id, product_name: q.product_name, text }, true);
      },
      async listPublicQuestions() {
        return ok(await sb.from("public_questions").select("*").order("answered_at", { ascending: false }).limit(500), "Не удалось загрузить вопросы");
      },
      async helpfulCounts() {
        const rows = ok(await sb.from("review_helpful").select("review_key, n").limit(2000), "") || [];
        return Object.fromEntries(rows.map((r) => [r.review_key, r.n]));
      },
      async myVotes() {
        const { data } = await sb.auth.getSession();
        if (!data.session) return [];
        return (ok(await sb.from("review_votes").select("review_key"), "") || []).map((r) => r.review_key);
      },
      async setHelpful(key, on) {
        const u = await need();
        if (!REVIEW_KEY.test(key)) fail("Отзыв не найден");
        if (on) {
          const res = await sb.from("review_votes").insert({ review_key: key });
          if (res.error && res.error.code !== "23505") ok(res, "Не удалось отметить отзыв");
        } else ok(await sb.from("review_votes").delete().eq("review_key", key).eq("user_id", u.id), "Не удалось снять отметку");
      },
    };
  }

  let ready;
  window.NSS_API = {
    ORDER_STATUSES, CANCELLABLE, DELIVERY, PAYMENT, FREE_DELIVERY_FROM, shipPrice,
    init() {
      ready ||= (cfg.supabaseUrl && cfg.supabaseAnonKey ? supabaseAdapter() : Promise.resolve(demoAdapter()))
        // если Supabase настроен, но не загрузился — НЕ подменяем демо-режимом,
        // иначе заказы тихо сохранятся только в браузере; ошибку показывает интерфейс
        .catch((e) => { console.error(e); ready = null; throw new Error("Профиль временно недоступен. Проверьте интернет и обновите страницу"); });
      return ready;
    },
  };
})();

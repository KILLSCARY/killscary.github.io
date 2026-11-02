// Профиль покупателя: вход через бота @nssauth_bot, данные, заказы, история покупок, отзывы с фото.
// Заказы и отзывы уходят менеджерам в бота (api.js → функция tg-bot).
// Данные — через window.NSS_API (api.js), общие функции сайта — через window.NSS (app.js).
(() => {
  const N = window.NSS;
  const cfg = window.NSS_CONFIG || {};
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const { esc, rub, icon, plural, byId } = N;
  const item = N.item, canonId = N.canonId; // товар или набор (id вида set-amm; старые заказы — set-0)

  const STATUS = {
    new: { label: "Оформлен", tone: "info", step: 0 },
    confirmed: { label: "Подтверждён", tone: "info", step: 1 },
    shipped: { label: "В пути", tone: "info", step: 2 },
    delivered: { label: "Доставлен", tone: "ok", step: 3 },
    cancelled: { label: "Отменён", tone: "muted", step: -1 },
  };
  const STEPS = ["Оформлен", "Подтверждён", "В пути", "Доставлен"];
  const RSTATUS = { pending: ["На модерации", "info"], approved: ["Опубликован", "ok"], rejected: ["Отклонён", "muted"] };
  const ACTIVE = new Set(["new", "confirmed", "shipped"]);

  const st = {
    api: null, apiError: null, user: null,
    profile: null, orders: [], reviews: [], loaded: false, loading: false,
    tab: "active", editing: false, busy: false,
    cancelAsk: null, // id заказа, для которого показан вопрос «Отменить?»
    afterLogin: null, // что сделать сразу после входа (оформить заказ / открыть форму отзыва)
  };

  const fmtDateTime = (iso) => new Date(iso).toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
  const safeUrl = (u) => (/^(https:\/\/|data:image\/|img\/)/.test(String(u)) ? String(u) : "");
  const prodImg = (id) => (item(id)?.img ? `img/${item(id).img}` : "");
  const showErr = (e) => N.toast(e?.message || "Что-то пошло не так. Попробуйте ещё раз");

  // ================= Загрузка =================
  async function boot() {
    try { st.api = await window.NSS_API.init(); }
    catch (e) { st.apiError = e.message; updateHeader(); if (isOpen()) render(); return; }
    st.user = await st.api.getUser().catch(() => null);
    // профиль могли открыть, пока грузился Supabase — перерисовываем
    if (isOpen()) openProfile();
    st.api.onAuth((u) => {
      const was = st.user?.id;
      st.user = u;
      if (was === u?.id) return;
      if (!u) { try { localStorage.removeItem(CACHE_KEY); } catch {} }
      st.loaded = false; st.fresh = 0; st.loadError = null; st.loadingP = null; st.profile = null; st.orders = []; st.reviews = []; st.editing = false;
      updateHeader();
      st.communityP = loadCommunity(); // свои голоса «Полезно» и подписки — у нового пользователя свои
      if (!isOpen()) return;
      if (u) useCache();
      render();
      // вошли (в т.ч. через бота) — сразу грузим заказы, иначе профиль так и висит на «Загружаем…»
      if (u) loadMine(true).then(() => { if (isOpen() && !st.editing) render(); });
    });
    updateHeader();
    loadPublicReviews();
    st.communityP = loadCommunity();
    // кнопка «Вернуться на сайт» в боте ведёт на #login=<код>: входим в этом окне, даже если оно новое
    const fromBot = /^#login=([0-9a-f]{32})$/.exec(location.hash);
    if (fromBot || location.hash === "#profile") history.replaceState(null, "", location.pathname + location.search);
    if (fromBot && !st.user) {
      Object.assign(login, { code: fromBot[1], link: `https://t.me/${cfg.telegramBot}?start=l_${fromBot[1]}`, exp: Date.now() + 9 * 60 * 1000 });
      openProfile();
      const el = $("#loginErr"); if (el) el.textContent = "Входим…";
      pollLogin();
    }
    // ссылка из бота «Мои заказы» ведёт на #profile
    else if (fromBot || location.hash === "#profile") openProfile();
    // покупатель ушёл в Telegram подтверждать вход, а браузер перезагрузил страницу — продолжаем ждать
    else if (!st.user && savedLogin()) pollLogin();
  }

  async function loadPublicReviews() {
    try {
      const list = await st.api.listPublicReviews();
      N.setUserReviews(list.map((r) => ({ ...r, photos: (r.photos || []).map(safeUrl).filter(Boolean) })));
    } catch (e) { console.error(e); }
  }

  // вопросы с ответами и счётчики «Полезно» — для всех; свои голоса и подписки на поступление — после входа
  async function loadCommunity() {
    // каждая часть сама по себе: ошибка в одной не мешает остальным
    const soft = (f, d) => Promise.resolve().then(f).catch((e) => { console.error(e); return d; });
    const [qs, counts, mine, alerts, stock] = await Promise.all([
      soft(() => st.api.listPublicQuestions(), []), soft(() => st.api.helpfulCounts(), {}),
      soft(() => st.api.myVotes(), []), soft(() => st.api.myStockAlerts(), []), soft(() => st.api.listStock(), null),
    ]);
    if (stock) N.setStock(stock); // наличие из бота — раньше остального, от него зависят кнопки
    N.setQuestions(qs); N.setHelpful(counts, mine); N.setAlerts(alerts);
  }

  // окно входа — страница под карточкой товара: перед входом карточку закрываем, после — открываем снова
  function withLogin(reason, id, run) {
    if (!st.api) return N.toast(st.apiError || "Профиль загружается, попробуйте через секунду");
    if (st.user) return run();
    const reopen = N.isProductOpen();
    N.closeProduct();
    // сначала дожидаемся голосов и подписок нового пользователя, иначе они затрут только что сделанное
    requireLogin(reason, async () => { await st.communityP; await run(); if (reopen) N.openProduct(id); });
  }

  // «Сообщить о поступлении»: подписка уходит менеджеру в бота, сообщение о поступлении придёт покупателю туда же
  N.notifyStock = (id) => {
    const p = byId[id];
    if (!p) return;
    withLogin(`Войдите через Telegram — бот напишет, когда «${p.name}» появится в наличии.`, id, async () => {
      try { await st.api.stockSubscribe(id, p.name); N.markAlert(id); N.toast(`Сообщим в Telegram, когда «${p.name}» появится`); }
      catch (e) { showErr(e); }
    });
  };

  // «Полезно»: кнопка меняется сразу, при ошибке — откатываем
  N.voteHelpful = (key, on) => {
    withLogin("Войдите через Telegram, чтобы отмечать полезные отзывы.", N.isProductOpen() ? currentItem() : null, async () => {
      N.applyVote(key, on);
      try { await st.api.setHelpful(key, on); } catch (e) { N.applyVote(key, !on); showErr(e); }
    });
  };
  const currentItem = () => (/^#p\/([a-z0-9-]+)$/.exec(location.hash) || [])[1] || null;

  // вопрос о товаре: true — отправлен сразу; false — сначала вход, вопрос уйдёт после него
  N.askQuestion = async (id, text) => {
    const it = N.item(id);
    const send = () => st.api.askQuestion({ product_id: it.id, product_name: it.name, text });
    if (st.user) { await send(); return true; }
    withLogin("Войдите через Telegram — ответ на вопрос придёт вам в бота.", it.id, async () => {
      try { await send(); N.toast("Вопрос отправлен — ответ придёт вам в Telegram"); } catch (e) { showErr(e); }
    });
    return false;
  };

  // последние загруженные заказы храним в браузере: при следующем открытии профиль виден сразу, а свежие данные догружаются
  const CACHE_KEY = "nss-acc-cache";
  function readCache(uid) {
    try { const c = JSON.parse(localStorage.getItem(CACHE_KEY)); return c && c.uid === uid ? c : null; } catch { return null; }
  }
  function writeCache() {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ uid: st.user.id, profile: st.profile, orders: st.orders, reviews: st.reviews })); } catch {}
  }
  function useCache() {
    const c = st.user && !st.loaded && readCache(st.user.id);
    if (!c) return false;
    st.profile = c.profile || {}; st.orders = c.orders || []; st.reviews = c.reviews || []; st.loaded = true;
    return true;
  }

  function loadMine(force) {
    if (!st.user) return Promise.resolve();
    if (st.loadingP) return st.loadingP;
    if (st.loaded && !force) return Promise.resolve();
    const uid = st.user.id;
    st.loadError = null;
    const p = (async () => {
      try {
        const slow = new Promise((_, rej) => setTimeout(() => rej(new Error("Сервер долго не отвечает. Проверьте интернет и попробуйте ещё раз")), 15000));
        const [profile, orders, reviews] = await Promise.race([Promise.all([st.api.getProfile(), st.api.listOrders(), st.api.listMyReviews()]), slow]);
        if (st.user?.id !== uid) return; // пока грузили, вошли под другим аккаунтом
        st.profile = profile || {}; st.orders = orders || []; st.reviews = reviews || []; st.loaded = true; st.fresh = Date.now();
        writeCache(); updateHeader();
      } catch (e) { if (st.user?.id === uid) st.loadError = e?.message || "Не удалось загрузить профиль"; }
      finally { if (st.loadingP === p) st.loadingP = null; }
    })();
    st.loadingP = p;
    return p;
  }

  function updateHeader() {
    const name = st.user ? (st.profile?.name || st.user.name || "Профиль").split(" ")[0] : "Войти";
    $$("[data-profile-label]").forEach((el) => (el.textContent = name));
  }

  // ================= Страница профиля =================
  const isOpen = () => !$("#profilePage").hidden;
  async function openProfile(tab) {
    if (tab) st.tab = tab;
    N.openPage("profilePage");
    if (st.user) useCache();
    render();
    // данные старше 30 с обновляем в фоне (статусы заказов меняют менеджеры в боте)
    if (st.user && (!st.loaded || Date.now() - (st.fresh || 0) > 30000)) {
      await loadMine(true);
      if (isOpen() && !st.editing) render();
    }
  }

  function render() {
    const root = $("#acc");
    if (st.apiError) { root.innerHTML = `<div class="acc-card acc-empty"><b>Профиль временно недоступен</b><p>${esc(st.apiError)}</p></div>`; return; }
    if (!st.api) { root.innerHTML = `<div class="acc-card acc-empty"><p>Загрузка…</p></div>`; return; }
    if (!st.user) { root.innerHTML = loginHtml(); prepareLogin(); return; }
    if (!st.loaded && st.loadError) { root.innerHTML = `<div class="acc-card acc-empty"><b>Не получилось загрузить профиль</b><p>${esc(st.loadError)}</p><button class="btn btn--dark" data-acc-retry>Повторить</button></div>`; return; }
    if (!st.loaded) { root.innerHTML = skeletonHtml(); return; }
    root.innerHTML = headHtml() + (st.editing ? editHtml() : "") + tabsHtml() + `<div class="acc-pane">${paneHtml()}</div>`;
    updateHeader();
  }

  const skeletonHtml = () => `<div class="acc-skel" aria-busy="true" aria-label="Загружаем профиль">
      <div class="acc-card acc-skel__head"><i class="sk sk--ava"></i><div><i class="sk sk--line"></i><i class="sk sk--line sk--short"></i></div></div>
      <i class="sk sk--tabs"></i><div class="acc-card"><i class="sk sk--block"></i></div></div>`;

  // ---------- Вход через бота ----------
  // Сайт берёт у функции одноразовый код и ссылку t.me/<бот>?start=l_<код>, покупатель жмёт
  // «Подтвердить вход» в боте, сайт каждые 2 с спрашивает функцию, подтверждён ли код.
  const LOGIN_KEY = "nss-bot-login";
  const login = { code: null, link: null, exp: 0, timer: null, busy: false };
  const isDesktop = () => matchMedia("(min-width: 900px) and (hover: hover)").matches;
  function savedLogin() {
    try { const s = JSON.parse(sessionStorage.getItem(LOGIN_KEY)); if (s && s.exp > Date.now() + 20000) { Object.assign(login, s); return true; } } catch {}
    return false;
  }

  function loginHtml() {
    const demo = st.api.mode === "demo";
    const reason = st.afterLogin?.reason;
    const intro = `<span class="acc-login__ico">${icon("tg")}</span>
      <h3>Вход через Telegram</h3>
      <p>${reason ? esc(reason) : "Заказы, их статусы, история покупок и отзывы — всё в одном месте."} Без паролей и номера телефона.</p>`;
    if (demo) return `<div class="acc-login acc-card">${intro}
        <form class="acc-demo" id="demoLogin">
          <p class="acc-note">Демо-режим: данные хранятся только в этом браузере.</p>
          <input name="name" placeholder="Имя" maxlength="80" autocomplete="given-name" required>
          <input name="username" placeholder="@username в Telegram (необязательно)" maxlength="33" autocomplete="off">
          <button class="btn btn--dark btn--wide btn--lg" type="submit">${icon("tg")}Войти (демо)</button>
          <p class="acc-err" id="loginErr" role="alert"></p>
        </form></div>`;
    return `<div class="acc-login acc-card">${intro}
      <a class="btn btn--tg btn--wide btn--lg" id="botLink" href="#" target="_blank" rel="noopener" aria-disabled="true">${icon("tg")}Войти через Telegram</a>
      <ol class="acc-steps"><li>Откроется бот магазина <b>@${esc(cfg.telegramBot || "")}</b></li><li>Нажмите в нём «Подтвердить вход»</li><li>Вернитесь сюда — вы уже вошли</li></ol>
      <div class="acc-qr" id="botQr" hidden><div id="botQrImg"></div><span>Или наведите камеру телефона</span></div>
      <p class="acc-wait" id="loginErr" role="status"></p>
    </div>`;
  }

  // подготовить ссылку заранее: тогда клик сразу открывает Telegram (без ожидания сервера — iOS не блокирует)
  async function prepareLogin() {
    if (st.api.mode === "demo" || st.user) return;
    if (!(login.code && login.exp > Date.now() + 20000) && !savedLogin()) {
      try {
        const r = await st.api.botLoginStart();
        Object.assign(login, { code: r.code, link: r.link, exp: Date.now() + r.ttl });
        try { sessionStorage.setItem(LOGIN_KEY, JSON.stringify({ code: login.code, link: login.link, exp: login.exp })); } catch {}
      } catch (e) { const el = $("#loginErr"); if (el) el.textContent = e.message; return; }
    }
    const a = $("#botLink");
    if (!a) return;
    a.href = login.link; a.removeAttribute("aria-disabled");
    if (isDesktop()) drawQr(login.link);
    pollLogin();
  }

  function drawQr(link) {
    const box = $("#botQr"), img = $("#botQrImg");
    if (!box) return;
    const draw = () => { const q = window.qrcode(0, "M"); q.addData(link); q.make(); img.innerHTML = q.createSvgTag({ cellSize: 4, margin: 2, scalable: true }); box.hidden = false; };
    if (window.qrcode) return draw();
    const s = document.createElement("script");
    s.src = "vendor/qrcode.js";
    s.onload = draw;
    document.head.appendChild(s);
  }

  function stopLogin() { clearTimeout(login.timer); login.timer = null; }
  function forgetLogin() { stopLogin(); Object.assign(login, { code: null, link: null, exp: 0 }); try { sessionStorage.removeItem(LOGIN_KEY); } catch {} }

  async function pollLogin() {
    stopLogin();
    if (!login.code || st.user || login.busy) return;
    login.busy = true;
    let r;
    try { r = await st.api.botLoginPoll(login.code); }
    catch (e) { r = { status: "pending" }; console.error(e); }
    finally { login.busy = false; }
    // «ok» проверяем до st.user: вход сам выставляет st.user (через onAuth) раньше, чем сюда вернётся ответ
    if (r.status === "ok") { forgetLogin(); N.toast("Вы вошли через Telegram"); return afterLoginDone(); }
    if (st.user) return;
    if (r.status === "expired" || Date.now() > login.exp) {
      forgetLogin();
      if (isOpen() && !st.user) prepareLogin(); // новая ссылка
      return;
    }
    // ждём дальше; в фоне вкладки опрашиваем реже, при возвращении — сразу
    login.timer = setTimeout(pollLogin, document.hidden ? 5000 : 2000);
  }
  document.addEventListener("visibilitychange", () => { if (!document.hidden && login.code && !st.user) pollLogin(); });

  async function afterLoginDone() {
    await loadMine(true);
    const next = st.afterLogin; st.afterLogin = null;
    // отложенное действие выполняем, только если покупатель всё ещё в профиле (не закрыл его)
    const run = next && isOpen();
    render();
    if (run) next.run();
  }

  // ---------- Шапка профиля ----------
  function headHtml() {
    const p = st.profile || {}, u = st.user;
    const name = p.name || u.name || "Покупатель";
    const ava = u.photo && safeUrl(u.photo) ? `<img src="${esc(safeUrl(u.photo))}" alt="">` : esc(name.charAt(0).toUpperCase());
    const delivered = st.orders.filter((o) => o.status === "delivered");
    const spent = delivered.reduce((s, o) => s + (o.total || 0), 0);
    return `<section class="acc-head acc-card">
      <span class="acc-ava">${ava}</span>
      <div class="acc-who">
        <b>${esc(name)}</b>
        <span>${esc([p.telegram || (u.username ? "@" + u.username : ""), p.phone, p.city].filter(Boolean).join(" · ") || "Добавьте телефон и город для доставки")}</span>
      </div>
      <div class="acc-head__acts">
        <button class="btn btn--light btn--sm" data-acc-edit>${st.editing ? "Отмена" : "Изменить данные"}</button>
        <button class="btn btn--light btn--sm" data-acc-logout>Выйти</button>
      </div>
      <dl class="acc-stats">
        <div><dt>Заказов</dt><dd>${st.orders.length}</dd></div>
        <div><dt>Получено</dt><dd>${delivered.length}</dd></div>
        <div><dt>Покупок на</dt><dd>${rub(spent)}</dd></div>
        <div><dt>Отзывов</dt><dd>${st.reviews.length}</dd></div>
      </dl>
      ${st.api.mode === "demo" ? `<p class="acc-note acc-note--demo">Демо-режим: данные хранятся только в этом браузере.</p>` : ""}
    </section>`;
  }

  function editHtml() {
    const p = st.profile || {};
    const f = (name, label, ph, val, type = "text", ac = "off") =>
      `<label><span>${label}</span><input name="${name}" type="${type}" value="${esc(val || "")}" placeholder="${ph}" autocomplete="${ac}" maxlength="80"></label>`;
    return `<form class="acc-edit acc-card" id="accEdit">
      ${f("name", "Имя", "Как к вам обращаться", p.name, "text", "name")}
      ${f("phone", "Телефон", "+7 900 000-00-00", p.phone, "tel", "tel")}
      ${f("telegram", "Telegram", "@username", p.telegram)}
      ${f("city", "Город", "Для доставки", p.city, "text", "address-level2")}
      <div class="acc-edit__bar"><button class="btn btn--dark" type="submit">Сохранить</button><span class="acc-err" id="editErr" role="alert"></span></div>
    </form>`;
  }

  // ---------- Вкладки ----------
  function tabsHtml() {
    const active = st.orders.filter((o) => ACTIVE.has(o.status)).length;
    const hist = st.orders.length - active;
    const t = (k, label, n) => { const [full, short] = label.split("|"); return `<button role="tab" data-acc-tab="${k}" aria-selected="${st.tab === k}"><span class="l">${full}</span><span class="s">${short}</span>${n ? ` <i>${n}</i>` : ""}</button>`; };
    return `<nav class="acc-tabs" role="tablist">${t("active", "Текущие заказы|Заказы", active)}${t("history", "История покупок|История", hist)}${t("reviews", "Мои отзывы|Отзывы", st.reviews.length)}</nav>`;
  }

  function paneHtml() {
    if (st.tab === "reviews") return reviewsPane();
    const list = st.orders.filter((o) => (st.tab === "active" ? ACTIVE.has(o.status) : !ACTIVE.has(o.status)));
    if (st.tab === "history") return historyPane(list);
    return list.length ? list.map(orderHtml).join("")
      : emptyHtml("box", "Текущих заказов нет", "Оформленные заказы появятся здесь — со статусом и составом.", `<button class="btn btn--dark" data-close-page>Перейти в каталог</button>`);
  }

  const emptyHtml = (ico, title, text, action = "") =>
    `<div class="acc-card acc-empty"><span class="acc-empty__ico">${icon(ico)}</span><b>${title}</b><p>${text}</p>${action}</div>`;

  function shipHtml(o) {
    const d = o.delivery, c = o.contact;
    if (!d) return "";
    const where = [d.zip, d.city, d.address].filter(Boolean).join(", ");
    // стоимость доставки и скидка есть только у заказов из новой анкеты
    const money = [typeof d.price === "number" ? `доставка ${d.price ? rub(d.price) : "бесплатно"}` : "", o.discount ? `скидка ${rub(o.discount)}${o.promo ? ` по промокоду ${o.promo}` : ""}` : ""].filter(Boolean).join(" · ");
    return `<div class="order__ship"><b>${esc(window.NSS_API.DELIVERY[d.method]?.label || "Доставка")}</b>${where ? `<span>${esc(where)}</span>` : ""}${money ? `<span>${esc(money[0].toUpperCase() + money.slice(1))}</span>` : ""}${c ? `<span>Получатель: ${esc([c.name, c.phone].filter(Boolean).join(", "))}</span>` : ""}</div>`;
  }

  function orderHtml(o) {
    const s = STATUS[o.status] || STATUS.new;
    const reviewed = new Set(st.reviews.map((r) => r.product_id));
    const items = (o.items || []).map((it) => {
      const p = item(it.id), id = canonId(it.id);
      const canReview = o.status === "delivered" && p && !reviewed.has(id);
      return `<li class="oitem">
        <button class="oitem__img" ${p ? `data-open="${esc(it.id)}"` : "disabled"}>${prodImg(it.id) ? `<img src="${prodImg(it.id)}" alt="">` : ""}</button>
        <div class="oitem__info"><b>${esc(it.name || p?.name || "Товар")}</b><span>${esc(it.pack || "")}</span></div>
        <div class="oitem__qty">${Number(it.qty) || 0} × ${it.free ? "бесплатно" : it.price ? rub(it.price) : "по запросу"}</div>
        ${canReview ? `<button class="btn btn--light btn--sm oitem__rv" data-write-review="${esc(id)}">${icon("camera")}Отзыв</button>` : ""}
        ${o.status === "delivered" && reviewed.has(id) ? `<span class="oitem__done">Отзыв оставлен</span>` : ""}
      </li>`;
    }).join("");
    const steps = s.step >= 0
      ? `<ol class="osteps">${STEPS.map((l, i) => `<li class="${i < s.step ? "done" : i === s.step ? "now" : ""}"><i></i><span>${l}</span></li>`).join("")}</ol>` : "";
    const demo = st.api.mode === "demo" && ACTIVE.has(o.status)
      ? `<div class="odemo"><span>Демо (в реальной версии статус меняет магазин):</span><button data-demo-next="${esc(o.id)}">Следующий статус →</button></div>` : "";
    const canCancel = window.NSS_API.CANCELLABLE.includes(o.status);
    const ask = canCancel && st.cancelAsk === o.id
      ? `<div class="ocancel" role="alertdialog" aria-label="Отмена заказа">
          <p><b>Отменить заказ №${esc(String(o.number))}?</b>Менеджер получит уведомление в боте. Вернуть заказ не получится — только оформить заново.</p>
          <div><button class="btn btn--light btn--sm" data-cancel-no>Не отменять</button><button class="btn btn--red btn--sm" data-cancel-yes="${esc(o.id)}">Да, отменить</button></div>
        </div>` : "";
    return `<article class="order acc-card">
      <header class="order__head">
        <div><b>Заказ №${esc(String(o.number))}</b><span>${fmtDateTime(o.created_at)}</span></div>
        <span class="pill pill--${s.tone}">${s.label}</span>
      </header>
      ${steps}
      <ul class="order__items">${items}</ul>
      ${shipHtml(o)}
      ${o.comment ? `<p class="order__comment">Комментарий: ${esc(o.comment)}</p>` : ""}
      <footer class="order__foot">
        <div class="order__total"><span>Итого</span><b>${rub(o.total || 0)}</b></div>
        <div class="order__acts">
          ${ACTIVE.has(o.status) ? `<a class="btn btn--light btn--sm" href="https://t.me/${esc(cfg.telegramBot || "")}" target="_blank" rel="noopener">${icon("tg")}Вопрос по заказу</a>` : ""}
          ${canCancel && !ask ? `<button class="btn btn--light btn--sm ocancel__btn" data-cancel-ask="${esc(o.id)}">Отменить заказ</button>` : ""}
          <button class="btn btn--dark btn--sm" data-reorder="${esc(o.id)}">Повторить заказ</button>
        </div>
      </footer>
      ${ask}
      ${demo}
    </article>`;
  }

  function historyPane(list) {
    if (!list.length) return emptyHtml("box", "История пока пустая", "Здесь будут доставленные и отменённые заказы и всё, что вы покупали.");
    // сводка «что покупали»: каждый товар один раз, с количеством и датой последней покупки
    const bought = new Map();
    for (const o of list.filter((x) => x.status === "delivered")) for (const it of o.items || []) {
      const id = canonId(it.id);
      const b = bought.get(id) || { id, name: it.name, qty: 0, last: o.created_at };
      b.qty += Number(it.qty) || 0; if (o.created_at > b.last) b.last = o.created_at;
      bought.set(id, b);
    }
    const reviewed = new Set(st.reviews.map((r) => r.product_id));
    const grid = bought.size ? `<section class="acc-card bought">
      <h3>Вы покупали</h3>
      <div class="bought__grid">${[...bought.values()].map((b) => {
        const p = item(b.id);
        return `<div class="bought__item">
          <button class="bought__img" ${p ? `data-open="${esc(b.id)}"` : "disabled"}>${prodImg(b.id) ? `<img src="${prodImg(b.id)}" alt="">` : ""}</button>
          <b>${esc(b.name || p?.name || "Товар")}</b>
          <span>${b.qty} шт. · последний раз ${new Date(b.last).toLocaleDateString("ru-RU", { day: "numeric", month: "short" })}</span>
          <div class="bought__acts">
            ${p && p.set ? `<button class="btn btn--dark btn--sm" data-order-bundle="${esc(b.id)}">Заказать снова</button>` : ""}
            ${p && !p.set && !p.out ? `<button class="btn btn--dark btn--sm" data-buy-again="${esc(b.id)}">Купить снова</button>` : ""}
            ${p && !reviewed.has(b.id) ? `<button class="btn btn--light btn--sm" data-write-review="${esc(b.id)}">${icon("camera")}Отзыв</button>` : ""}
          </div>
        </div>`;
      }).join("")}</div>
    </section>` : "";
    return grid + list.map(orderHtml).join("");
  }

  function reviewsPane() {
    const add = `<button class="btn btn--dark" data-write-review>${icon("camera")}Написать отзыв с фото</button>`;
    if (!st.reviews.length) return emptyHtml("camera", "Отзывов пока нет", "Расскажите, как подействовали добавки, и приложите фото — после проверки отзыв появится на сайте.", add);
    const demo = st.api.mode === "demo" && st.reviews.some((r) => r.status === "pending")
      ? `<div class="odemo"><span>Демо (в реальной версии модерирует магазин):</span><button data-demo-approve>Одобрить на модерации</button><button data-demo-reject>Отклонить</button></div>` : "";
    return `<div class="acc-pane__bar">${add}</div>${demo}` + st.reviews.map((r) => {
      const p = item(r.product_id);
      const [label, tone] = RSTATUS[r.status] || RSTATUS.pending;
      const photos = (r.photos || []).map(safeUrl).filter(Boolean);
      return `<article class="myrv acc-card">
        <header class="myrv__head">
          <button class="myrv__prod" ${p ? `data-open="${esc(r.product_id)}"` : "disabled"}>${prodImg(r.product_id) ? `<img src="${prodImg(r.product_id)}" alt="">` : ""}<b>${esc(p?.name || "Товар")}</b></button>
          <span class="pill pill--${tone}">${label}</span>
        </header>
        ${N.stars(r.rating)}
        <p class="myrv__text">${esc(r.text)}</p>
        ${photos.length ? `<div class="myrv__photos">${photos.map((u) => `<button data-zoom="${esc(u)}"><img src="${esc(u)}" alt=""></button>`).join("")}</div>` : ""}
        <footer class="myrv__foot"><span>${fmtDateTime(r.created_at)}</span>${r.status === "pending" ? `<button class="link-btn" data-del-review="${esc(r.id)}">Удалить</button>` : ""}</footer>
      </article>`;
    }).join("");
  }

  // ================= Оформление заказа =================
  // Корзина (или «Купить в 1 клик», набор) → вход через бота → анкета: получатель, доставка, оплата →
  // заказ сохраняется в профиле и сразу уходит менеджеру в бота @nssauth_bot.
  // Онлайн-оплата появится в разделе «Оплата»: пока заказ оплачивается после подтверждения менеджером.
  const CO_KEY = "nss-checkout"; // последние получатель и доставка — чтобы не вводить заново
  const DELIVERY = window.NSS_API.DELIVERY;
  const coForm = $("#coForm");
  const co = { items: [], direct: false, promo: null }; // promo — { code, discount, label } после проверки
  const coGoods = () => co.items.reduce((s, i) => s + (i.price || 0) * i.qty, 0);
  const CO_REASON = "Войдите через Telegram — затем укажете получателя и доставку, а заказ сразу получит менеджер.";

  N.checkout = () => {
    if (!N.cartItems().length || st.busy) return;
    requireLogin(CO_REASON, () => openCheckout());
  };
  // «Купить в 1 клик» и наборы — без корзины, но через ту же анкету
  N.orderNow = (items) => { N.closeProduct(); requireLogin(CO_REASON, () => openCheckout(items)); };

  const cartOrderItems = () => N.cartItems().filter(({ id }) => byId[id]).map(({ id, qty }) => {
    const p = byId[id];
    return { id, name: p.name, pack: p.pack, price: p.free ? 0 : p.price || null, qty, ...(p.free ? { free: true } : {}) };
  });

  function savedCheckout() {
    try { const s = JSON.parse(localStorage.getItem(CO_KEY)); return s && s.uid === st.user?.id ? s : {}; } catch { return {}; }
  }

  function openCheckout(direct) {
    const items = direct || cartOrderItems();
    if (!items.length) return;
    Object.assign(co, { items, direct: !!direct });
    const f = coForm.elements, saved = savedCheckout(), p = st.profile || {}, u = st.user || {};
    const c = saved.contact || {}, d = saved.delivery || {};
    f.name.value = c.name || p.name || (u.name && u.name !== "Покупатель" ? u.name : "");
    f.phone.value = c.phone || p.phone || "";
    f.telegram.value = c.telegram || p.telegram || (u.username ? "@" + u.username : "");
    f.city.value = d.method === "spb_courier" ? p.city || "" : d.city || p.city || "";
    f.address.value = d.address || "";
    f.zip.value = d.zip || "";
    if (direct) f.comment.value = "";
    co.promo = null; Object.assign($("#coPromo"), { value: "", disabled: false }); $("#coPromoBtn").textContent = "Применить";
    $("#coPromoMsg").textContent = ""; $("#coPromoMsg").className = "co-promo__msg";
    const checked = DELIVERY[d.method] ? d.method : "cdek_pvz";
    $("#coMethods").innerHTML = Object.keys(DELIVERY).map((k) =>
      `<label class="co-opt"><input type="radio" name="method" value="${k}"${k === checked ? " checked" : ""}><span><b>${esc(DELIVERY[k].label)}</b><small data-ship="${k}"></small></span></label>`).join("");
    syncMethod();
    $$("[aria-invalid]", coForm).forEach((el) => el.removeAttribute("aria-invalid"));
    $("#coErr").textContent = "";
    renderCoSummary();
    N.openPage("checkoutPage");
    $("#checkoutPage").scrollTop = 0;
  }

  // поля адреса зависят от способа доставки
  function syncMethod() {
    const m = DELIVERY[coForm.elements.method.value] || DELIVERY.cdek_pvz;
    $("#coCityF").hidden = !!m.city;
    $("#coZipF").hidden = coForm.elements.method.value !== "post";
    $("#coAddrL").textContent = m.address;
    coForm.elements.address.placeholder = coForm.elements.method.value === "cdek_pvz" ? "Например, ул. Ленина, 10 — пункт СДЭК" : "Например, ул. Ленина, 10, кв. 5";
  }

  // итог: товары − скидка по промокоду + доставка (бесплатно от FREE_DELIVERY_FROM)
  function renderCoSummary() {
    const n = co.items.reduce((s, i) => s + i.qty, 0);
    const goods = coGoods(), discount = co.promo?.discount || 0;
    const ask = co.items.some((i) => !i.price && !i.free);
    const method = coForm.elements.method?.value || "cdek_pvz";
    const ship = window.NSS_API.shipPrice(method, goods - discount);
    $("#coItems").innerHTML = co.items.map((i) =>
      `<li>${prodImg(i.id) ? `<img src="${prodImg(i.id)}" alt="">` : "<span></span>"}<div><b>${esc(i.name)}</b><span>${i.qty} шт.${i.pack ? " · " + esc(i.pack) : ""}</span></div><em>${i.free ? "бесплатно" : i.price ? rub(i.price * i.qty) : "по запросу"}</em></li>`).join("");
    $("#coCount").textContent = `${n} ${plural(n, ["товар", "товара", "товаров"])}`;
    $("#coGoods").textContent = rub(goods);
    $("#coDiscRow").hidden = !discount;
    $("#coDiscL").textContent = co.promo ? `Промокод ${co.promo.code}` : "Скидка";
    $("#coDisc").textContent = "−" + rub(discount);
    $("#coShip").textContent = ship ? rub(ship) : "бесплатно";
    $("#coFree").innerHTML = N.shipBar(goods - discount);
    // цена и срок у каждого способа — с учётом бесплатной доставки
    $$("[data-ship]", coForm).forEach((el) => {
      const k = el.dataset.ship, p = window.NSS_API.shipPrice(k, goods - discount);
      el.textContent = `${p ? rub(p) : "Бесплатно"} · ${DELIVERY[k].days}`;
    });
    $("#coTotal").textContent = rub(goods - discount + ship) + (ask ? " + по запросу" : "");
  }

  // промокод: проверяет сервер (в демо — DEMO10 и DEMO500), скидка — от суммы товаров
  async function applyPromo() {
    const input = $("#coPromo"), msg = $("#coPromoMsg"), btn = $("#coPromoBtn");
    if (co.promo) { co.promo = null; input.value = ""; input.disabled = false; btn.textContent = "Применить"; msg.textContent = ""; return renderCoSummary(); }
    const code = input.value.trim();
    if (!code) { msg.className = "co-promo__msg err"; msg.textContent = "Введите промокод"; return input.focus(); }
    btn.disabled = true; msg.className = "co-promo__msg"; msg.textContent = "Проверяем…";
    try {
      const r = await st.api.checkPromo(code, coGoods());
      co.promo = { code: r.code, discount: r.discount, label: r.label };
      input.value = r.code; input.disabled = true; btn.textContent = "Убрать";
      msg.className = "co-promo__msg ok"; msg.textContent = `Промокод применён: ${r.label}, скидка ${rub(r.discount)}`;
    } catch (e) { msg.className = "co-promo__msg err"; msg.textContent = e.message; }
    finally { btn.disabled = false; renderCoSummary(); }
  }
  $("#coPromoBtn").addEventListener("click", applyPromo);
  $("#coPromo").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); applyPromo(); } });

  coForm.addEventListener("change", (e) => { if (e.target.name === "method") { syncMethod(); renderCoSummary(); } });
  coForm.addEventListener("input", (e) => { e.target.removeAttribute("aria-invalid"); $("#coErr").textContent = ""; });

  coForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (st.busy) return;
    const f = coForm.elements, method = f.method.value;
    // сначала подсвечиваем пустые обязательные поля, подробную проверку делает api.js
    const required = [["name", 2], ["phone", 10], ...(DELIVERY[method]?.city ? [] : [["city", 1]]), ["address", 5], ...(method === "post" ? [["zip", 6]] : [])];
    let first = null;
    for (const [name, min] of required) {
      const bad = f[name].value.trim().length < min;
      f[name].setAttribute("aria-invalid", bad);
      if (bad && !first) first = f[name];
    }
    if (first) { $("#coErr").textContent = "Заполните выделенные поля"; return first.focus(); }
    await placeOrder({
      contact: { name: f.name.value, phone: f.phone.value, telegram: f.telegram.value },
      delivery: { method, city: f.city.value, address: f.address.value, zip: f.zip.value },
      payment: f.payment.value,
      comment: f.comment.value,
      promo: co.promo?.code || null,
      discount: co.promo?.discount || 0,
    });
  });

  async function placeOrder(data) {
    if (st.busy || !co.items.length) return;
    st.busy = true;
    const btn = $("#coSubmit"); btn.disabled = true; btn.textContent = "Отправляем…";
    try {
      // итог с доставкой и скидкой считает api.js (checkOrder)
      const order = await st.api.createOrder({ items: co.items, ...data });
      try { localStorage.setItem(CO_KEY, JSON.stringify({ uid: st.user.id, contact: order.contact || data.contact, delivery: order.delivery || data.delivery })); } catch {}
      if (!co.direct) N.clearCart();
      coForm.elements.comment.value = "";
      co.items = [];
      fillProfile(order.contact, order.delivery);
      st.orders.unshift(order);
      openProfile("active");
      $("#odNum").textContent = order.number;
      $("#odText").textContent = order.notified
        ? "Менеджер уже получил заказ. Подтверждение, стоимость доставки и статусы придут вам в Telegram от бота @" + (cfg.telegramBot || "") + "."
        : "Заказ сохранён, но менеджер пока не получил уведомление. Напишите боту — мы всё проверим.";
      $("#odBot").href = "https://t.me/" + (cfg.telegramBot || "");
      $("#orderDone").hidden = false; N.lock();
    } catch (e) { $("#coErr").textContent = e?.message || "Не удалось оформить заказ. Попробуйте ещё раз"; }
    finally { st.busy = false; btn.disabled = false; btn.textContent = "Подтвердить заказ"; }
  }

  // пустые имя, телефон и город в профиле заполняем данными из заказа
  function fillProfile(contact, delivery) {
    const p = st.profile || {};
    if (!contact || (p.name && p.phone && p.city)) return;
    const next = { ...p, name: p.name || contact.name, phone: p.phone || contact.phone, city: p.city || delivery?.city || "" };
    st.api.saveProfile(next).then((saved) => { st.profile = { ...p, ...saved }; writeCache(); updateHeader(); }).catch((e) => console.error(e));
  }

  // ================= Отзыв с фото =================
  const form = { rating: 0, photos: [], gen: 0, queue: Promise.resolve() }; // photos: [{ blob, url }]
  const MAX_PHOTOS = 5;

  function openReview(productId) {
    const delivered = new Set(st.orders.filter((o) => o.status === "delivered").flatMap((o) => (o.items || []).map((i) => canonId(i.id))));
    const reviewed = new Set(st.reviews.map((r) => r.product_id));
    const opt = (p) => `<option value="${esc(p.id)}"${reviewed.has(p.id) ? " disabled" : ""}>${esc(p.name)}${reviewed.has(p.id) ? " — отзыв уже есть" : ""}</option>`;
    const all = [...PRODUCTS, ...N.bundles];
    const mine = all.filter((p) => delivered.has(p.id));
    const group = (label, list) => (list.length ? `<optgroup label="${label}">${list.map(opt).join("")}</optgroup>` : "");
    $("#rProduct").innerHTML = `<option value="">Выберите товар или набор</option>` + group("Вы покупали", mine) +
      group("Товары", PRODUCTS.filter((p) => !delivered.has(p.id))) + group("Наборы", N.bundles.filter((b) => !delivered.has(b.id)));
    $("#rProduct").value = productId && item(productId) && !reviewed.has(productId) ? productId : "";
    form.rating = 0; setStars(0);
    $("#rText").value = ""; updateCount();
    clearPhotos();
    $("#rErr").textContent = "";
    $("#reviewSheet").hidden = false; N.lock();
    setTimeout(() => ($("#rProduct").value ? $("#rText") : $("#rProduct")).focus(), 50);
  }
  function closeReview() { $("#reviewSheet").hidden = true; clearPhotos(); N.unlock(); }
  // Escape закрывает шторки в app.js — здесь только чистим фото формы
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#reviewSheet").hidden) setTimeout(clearPhotos); });

  function setStars(n) {
    form.rating = n;
    $$("#rStars [data-star]").forEach((b) => { b.classList.toggle("on", +b.dataset.star <= n); b.setAttribute("aria-checked", +b.dataset.star === n); });
  }
  function updateCount() { $("#rCount").textContent = `${$("#rText").value.length} / 2000`; }

  function clearPhotos() { form.gen++; form.queue = Promise.resolve(); form.photos.forEach((p) => URL.revokeObjectURL(p.url)); form.photos = []; renderPhotos(); }
  function renderPhotos() {
    $$("#rPhotos .rphoto").forEach((el) => el.remove());
    $("#rAdd").insertAdjacentHTML("beforebegin", form.photos.map((p, i) =>
      `<div class="rphoto"><img src="${p.url}" alt=""><button type="button" data-rm-photo="${i}" aria-label="Убрать фото">${icon("close")}</button></div>`).join(""));
    $("#rAdd").hidden = form.photos.length >= MAX_PHOTOS;
  }

  // сжатие: длинная сторона до 1600px (в демо 1000px — место в браузере ограничено), JPEG
  async function compress(file) {
    const max = st.api.mode === "demo" ? 1000 : 1600, q = st.api.mode === "demo" ? 0.72 : 0.82;
    let src;
    try { src = await createImageBitmap(file, { imageOrientation: "from-image" }); }
    catch {
      const tmp = URL.createObjectURL(file);
      src = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = tmp; })
        .catch(() => { throw new Error(`Не удалось открыть «${file.name}». Сохраните фото как JPG и попробуйте снова`); })
        .finally(() => setTimeout(() => URL.revokeObjectURL(tmp), 0));
    }
    const w = src.width || src.naturalWidth, h = src.height || src.naturalHeight;
    const k = Math.min(1, max / Math.max(w, h));
    const c = document.createElement("canvas");
    c.width = Math.round(w * k); c.height = Math.round(h * k);
    c.getContext("2d").drawImage(src, 0, 0, c.width, c.height);
    if (src.close) src.close();
    const blob = await new Promise((res) => c.toBlob(res, "image/jpeg", q));
    if (!blob) throw new Error("Не удалось обработать фото");
    return blob;
  }

  function addFiles(files) {
    const list = [...files], gen = form.gen;
    $("#rErr").textContent = "";
    // очередь: выборы файлов обрабатываются строго по порядку, лимит считается на момент добавления
    form.queue = form.queue.then(async () => {
      for (const f of list) {
        if (gen !== form.gen) return; // форму закрыли или открыли заново
        if (form.photos.length >= MAX_PHOTOS) { $("#rErr").textContent = `Можно прикрепить до ${MAX_PHOTOS} фото — лишние не добавлены`; return; }
        if (!/^image\//.test(f.type) && !/\.(heic|heif)$/i.test(f.name)) { $("#rErr").textContent = `«${f.name}» — не фото`; continue; }
        if (f.size > 25 * 1024 * 1024) { $("#rErr").textContent = `«${f.name}» больше 25 МБ`; continue; }
        try {
          const blob = await compress(f);
          if (gen !== form.gen) return;
          form.photos.push({ blob, url: URL.createObjectURL(blob) }); renderPhotos();
        } catch (e) { $("#rErr").textContent = e.message; }
      }
    });
    return form.queue;
  }

  async function submitReview(e) {
    e.preventDefault();
    if (st.busy) return;
    const btn = $("#rSubmit"), err = $("#rErr");
    err.textContent = "";
    st.busy = true; btn.disabled = true; btn.textContent = "Отправляем…";
    try {
      await form.queue; // дожидаемся фото, которые ещё сжимаются
      if (form.photos.length) btn.textContent = "Загружаем фото…";
      const rev = await st.api.createReview({ product_id: $("#rProduct").value, product_name: item($("#rProduct").value)?.name, rating: form.rating, text: $("#rText").value, files: form.photos.map((p) => p.blob) });
      st.reviews.unshift(rev);
      closeReview();
      N.toast("Спасибо! Отзыв отправлен на модерацию");
      if (isOpen()) { st.tab = "reviews"; render(); }
    } catch (e2) { err.textContent = e2.message; }
    finally { st.busy = false; btn.disabled = false; btn.textContent = "Отправить на модерацию"; }
  }

  // ================= Требует входа =================
  async function cancelOrder(id, btn) {
    if (st.busy) return;
    st.busy = true; btn.disabled = true; btn.textContent = "Отменяем…";
    try {
      const o = await st.api.cancelOrder(id);
      const num = o?.number ?? st.orders.find((x) => x.id === id)?.number;
      N.toast(`Заказ №${num} отменён`);
    } catch (e) { showErr(e); }
    finally { st.busy = false; st.cancelAsk = null; }
    // в любом случае перечитываем заказы: статус мог поменять менеджер
    await loadMine(true);
    if (isOpen()) render();
  }

  function requireLogin(reason, run) {
    if (!st.api) return N.toast(st.apiError || "Профиль загружается, попробуйте через секунду");
    if (st.user) return run();
    st.afterLogin = { reason, run };
    openProfile();
  }

  // ================= События =================
  $("#rForm").addEventListener("submit", submitReview);
  $("#rText").addEventListener("input", updateCount);
  $("#rFiles").addEventListener("change", (e) => { addFiles(e.target.files); e.target.value = ""; });

  document.addEventListener("submit", async (e) => {
    if (e.target.id === "demoLogin") {
      e.preventDefault();
      const fd = new FormData(e.target);
      try { await st.api.loginDemo({ name: fd.get("name"), username: fd.get("username") }); await afterLoginDone(); }
      catch (err) { $("#loginErr").textContent = err.message; }
    }
    if (e.target.id === "accEdit") {
      e.preventDefault();
      const fd = new FormData(e.target);
      try { st.profile = await st.api.saveProfile(Object.fromEntries(fd)); st.editing = false; render(); N.toast("Данные сохранены"); }
      catch (err) { $("#editErr").textContent = err.message; }
    }
  });

  document.addEventListener("click", async (e) => {
    const t = e.target;
    if (t.closest("[data-open-profile]")) { st.afterLogin = null; return openProfile(); }
    if (t.closest("#profilePage [data-close-page]") && !st.user) stopLogin();
    if (t.closest("#botLink")) { const el = $("#loginErr"); if (el) el.textContent = "Ждём, когда вы нажмёте «Подтвердить вход» в боте…"; return; }
    if (t.closest("[data-close-orderdone]")) { $("#orderDone").hidden = true; return N.unlock(); }
    const wr = t.closest("[data-write-review]");
    // окно входа — страница под карточкой товара, поэтому карточку закрываем
    if (wr && !st.user) N.closeProduct();
    if (wr) return requireLogin("Войдите, чтобы оставить отзыв с фото.", async () => { await loadMine(); openReview(wr.dataset.writeReview); });
    if (t.closest("[data-close-review]")) return closeReview();
    const star = t.closest("[data-star]");
    if (star) return setStars(+star.dataset.star);
    const rm = t.closest("[data-rm-photo]");
    if (rm) { const [p] = form.photos.splice(+rm.dataset.rmPhoto, 1); URL.revokeObjectURL(p.url); return renderPhotos(); }


    if (!t.closest("#profilePage")) return;
    if (t.closest("[data-acc-retry]")) { render(); await loadMine(true); return render(); }
    const tab = t.closest("[data-acc-tab]");
    if (tab) { st.tab = tab.dataset.accTab; st.cancelAsk = null; return render(); }
    if (t.closest("[data-acc-edit]")) { st.editing = !st.editing; return render(); }
    if (t.closest("[data-acc-logout]")) { forgetLogin(); await st.api.signOut(); st.afterLogin = null; return; }
    const ro = t.closest("[data-reorder]");
    if (ro) {
      const o = st.orders.find((x) => x.id === ro.dataset.reorder);
      let added = 0;
      for (const it of o?.items || []) if (byId[it.id] && !byId[it.id].out) { N.addToCart(it.id, it.qty); added++; }
      return N.toast(added ? "Товары добавлены в корзину" : "Этих товаров сейчас нет в наличии", !!added);
    }
    // набор в корзину не кладётся — сразу на оформление
    const ob = t.closest("[data-order-bundle]");
    if (ob) return N.orderBundle(ob.dataset.orderBundle);
    const ba = t.closest("[data-buy-again]");
    if (ba) { N.addToCart(ba.dataset.buyAgain, 1); return N.toast(`${byId[ba.dataset.buyAgain].name} — в корзине`, true); }
    const del = t.closest("[data-del-review]");
    if (del) {
      if (!confirm("Удалить отзыв?")) return;
      try { await st.api.deleteReview(del.dataset.delReview); st.reviews = st.reviews.filter((r) => r.id !== del.dataset.delReview); render(); }
      catch (err) { showErr(err); }
      return;
    }
    // демо-инструменты
    const ca = t.closest("[data-cancel-ask]");
    if (ca) { st.cancelAsk = ca.dataset.cancelAsk; return render(); }
    if (t.closest("[data-cancel-no]")) { st.cancelAsk = null; return render(); }
    const cy = t.closest("[data-cancel-yes]");
    if (cy) return cancelOrder(cy.dataset.cancelYes, cy);
    const dn = t.closest("[data-demo-next]");
    if (dn) {
      try { await st.api.demoAdvanceOrder(dn.dataset.demoNext); await loadMine(true); render(); }
      catch (err) { showErr(err); }
      return;
    }
    const da = t.closest("[data-demo-approve]"), dr = t.closest("[data-demo-reject]");
    if (da || dr) { await st.api.demoModerate(!!da); await loadMine(true); render(); loadPublicReviews(); }
  });

  // перетаскивание фото в форму
  const drop = $("#rPhotos");
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("drag"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("drag"));
  drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("drag"); addFiles(e.dataTransfer.files); });

  boot();
})();

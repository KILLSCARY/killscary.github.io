// Чат поддержки на сайте: кнопка в углу → окно чата.
// Писать можно без входа. Сообщение уходит менеджерам в бота @nssauth_bot (функция tg-bot, chat_send),
// ответ (reply) менеджера сайт забирает опросом (chat_poll): раз в 3 с, пока окно открыто, и раз в 30 с — пока закрыто.
// Переписку узнаём по случайному токену в localStorage этого браузера.
(() => {
  const N = window.NSS || {};
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const KEY = "nss-chat"; // { token, name, msgs: [...], seen: id последнего прочитанного ответа }
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
  const st = { ...{ token: null, name: "", msgs: [], seen: 0 }, ...load(), open: false, timer: null, sending: false };
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ token: st.token, name: st.name, msgs: st.msgs.slice(-200), seen: st.seen })); } catch {} };
  const newToken = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
  const api = () => window.NSS_API.init();

  const ico = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" d="${d}"/></svg>`;
  const I_CHAT = ico("M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5H10l-4.5 4v-4A1.5 1.5 0 0 1 4 14.5z");
  const GREETING = "Здравствуйте! Помогу подобрать добавки под задачу — или позову менеджера, если есть вопрос. Менеджер отвечает за 5–15 минут.";
  const HELPER = "Помощник магазина";
  const QUICK = ["Как оформить заказ?", "Сроки доставки", "Помогите подобрать", "Где мой заказ?"];

  document.body.insertAdjacentHTML("beforeend", `
    <button class="sc-fab" id="scFab" aria-label="Чат с менеджером">${I_CHAT}<span>Чат с менеджером</span><i class="sc-fab__dot"></i><b id="scBadge" hidden></b></button>
    <section class="sc" id="sc" role="dialog" aria-label="Чат с менеджером" aria-hidden="true" inert>
      <header class="sc__head"><span class="sc__ava"><img src="img/logo-128.png" alt=""></span><div class="sc__who"><b>Поддержка НЕ СУЩИЙ STORE</b><span>Онлайн · ответ за 5–15 минут</span></div>
        <button class="sc__x" id="scClose" aria-label="Закрыть чат">${ico("M6 6l12 12M18 6 6 18")}</button></header>
      <div class="sc__body" id="scBody" aria-live="polite"></div>
      <form class="sc__foot" id="scForm">
        <input class="sc__name" id="scName" maxlength="80" placeholder="Как к вам обращаться? (необязательно)" autocomplete="name">
        <div class="sc__row"><textarea id="scText" rows="1" maxlength="2000" placeholder="Напишите сообщение…" aria-label="Сообщение"></textarea><button class="sc__send" id="scSend" type="submit" aria-label="Отправить">${ico("M4 12 20 4l-6 16-3-7z")}</button></div>
        <p class="sc__err" id="scErr" role="alert" hidden></p>
        <p class="sc__note" id="scNote">Без регистрации. Переписка сохранится в этом браузере.</p>
      </form>
    </section>`);
  // на телефоне чат — кнопкой в шапке рядом с поиском, а не кругом над товарами
  document.querySelector(".header__main").insertAdjacentHTML("beforeend", `<button class="sc-head" id="scHead" type="button" aria-label="Чат с менеджером">${I_CHAT}<i></i><b id="scHeadBadge" hidden></b></button>`);
  $("#scHead").addEventListener("click", () => open());
  const fab = $("#scFab"), box = $("#sc"), body = $("#scBody"), form = $("#scForm"), text = $("#scText"), err = $("#scErr");
  $("#scName").value = st.name || "";

  const time = (iso) => new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  const day = (iso) => { const d = new Date(iso), t = new Date(); return d.toDateString() === t.toDateString() ? "Сегодня" : d.toLocaleDateString("ru-RU", { day: "numeric", month: "long" }); };
  const lastShopId = () => st.msgs.reduce((m, x) => (x.from_shop && x.id > m ? x.id : m), 0);
  const unread = () => st.msgs.filter((m) => m.from_shop && m.id > st.seen).length;

  // ---------- подбор по задаче: помощник показывает товары из каталога (app.js), вопросы — менеджеру ----------
  const local = (text) => ({ local: true, from_shop: false, text, created_at: new Date().toISOString() });
  const bot = (kind, extra = {}) => ({ bot: true, kind, created_at: new Date().toISOString(), ...extra });
  function pickHtml(m) {
    if (m.kind === "text") return `<div class="sc__msg sc__msg--in"><em>${HELPER}</em>${esc(m.text)}<time>${time(m.created_at)}</time></div>`;
    if (m.kind === "note") return `<div class="sc-note">${esc(m.text)}</div>`;
    if (m.kind === "goals") return `<div class="sc-pick"><div class="sc-pick__goals">${(N.goals || []).map((g, i) => `<button type="button" data-sc-goal="${i}">${esc(g)}</button>`).join("")}</div></div>`;
    if (m.kind !== "pick" || !N.pickFor) return "";
    const r = N.pickFor(m.goal), ids = r.items.map((p) => p.id);
    const it = (p) => `<div class="sc-pick__it"><img src="img/${N.small(p.img)}" alt="" data-sc-open="${p.id}"><b data-sc-open="${p.id}">${esc(p.name)}</b><span class="pr">${N.rub(p.price)}</span>
      ${p.pick ? `<p class="sc-pick__why"><em>Почему он:</em> ${esc(p.pick.why)}.</p><p class="sc-pick__why"><em>Что даст:</em> ${esc(p.pick.gives)}.</p>` : `<p class="sc-pick__why">${esc(p.tagline || "")}</p>`}
      <button type="button" data-sc-cart="${p.id}">В корзину</button></div>`;
    const s = r.set, same = s && s.ids.length === ids.length && ids.every((id) => s.ids.includes(id));
    const set = s ? `<div class="sc-pick__set"><img src="img/${N.small(s.img)}" alt=""><div><b>${same ? `${ids.length === 3 ? "Все три" : "Все"} — набор «${esc(s.name)}»` : `Готовый набор «${esc(s.name)}»`}</b><em>${N.rub(s.price)}</em>${s.old ? ` вместо ${N.rub(s.old)}` : ""}</div><button type="button" data-sc-open="${s.id}">Смотреть</button></div>` : "";
    return `<div class="sc-pick"><div class="sc-pick__list">${r.items.map(it).join("")}</div>${set}
      <div class="sc-pick__goals">${ids.length > 1 ? `<button type="button" data-sc-cmp="${ids.join(",")}">Сравнить ${ids.length === 3 ? "эти три" : "их"}</button>` : ""}<button type="button" data-sc-again>Другая задача</button><button type="button" data-sc-manager>Позвать менеджера</button></div></div>`;
  }
  function pickPush(...items) { st.msgs.push(...items); save(); render(); }
  function pickStart(label) {
    pickPush(local(label), bot("text", { text: "Что для вас сейчас важнее всего?" }), bot("goals"));
    body.scrollTop = body.scrollHeight;
  }
  function pickGoal(i) {
    const r = N.pickFor(i);
    pickPush(local(r.name), bot("text", { text: r.items.length
      ? `Для задачи «${r.name}» подойдут эти товары. Коротко — почему каждый и что он даст (по описаниям товаров):`
      : "Сейчас под эту задачу нет товаров в наличии — напишите менеджеру, он подскажет замену." }), bot("pick", { goal: i }));
    // показываем начало ответа, а не самый низ — иначе первые товары уезжают вверх
    const t = [...body.querySelectorAll(".sc__msg--in")].pop();
    if (t) body.scrollTop = t.offsetTop - 12;
  }

  function render() {
    const msgs = st.msgs;
    // настоящие сообщения переписки (уходят менеджеру); подсказки помощника и выбор задачи — только в браузере
    const real = msgs.filter((m) => !m.bot && !m.local);
    let html = msgs.length ? `<span class="sc__day">${day(msgs[0].created_at)}</span>` : "";
    html += `<div class="sc__msg sc__msg--in"><em>${HELPER}</em>${GREETING}<time>${time(msgs[0]?.created_at || new Date().toISOString())}</time></div>`;
    if (!msgs.length) html += `<div class="sc-pick"><div class="sc-pick__goals"><button type="button" class="is-main" data-sc-pick>🎯 Подобрать под задачу</button>${QUICK.map((q) => `<button type="button" data-sc-quick>${esc(q)}</button>`).join("")}</div></div>`;
    let prevDay = msgs.length ? day(msgs[0].created_at) : "";
    for (const m of msgs) {
      const d = day(m.created_at);
      if (d !== prevDay) { html += `<span class="sc__day">${d}</span>`; prevDay = d; }
      if (m.bot) { html += pickHtml(m); continue; }
      html += m.from_shop
        ? `<div class="sc__msg sc__msg--in"><em>${esc(m.author || "Менеджер")}</em>${esc(m.text)}<time>${time(m.created_at)}</time></div>`
        : `<div class="sc__msg sc__msg--out${m.pending ? " sc__msg--pending" : ""}${m.failed ? " sc__msg--err" : ""}">${esc(m.text)}<time>${m.failed ? "не отправлено" : time(m.created_at)}</time></div>`;
    }
    // последнее сообщение переписки — покупателя и свежее: показываем, что ответ готовится
    const last = real[real.length - 1];
    if (last && !last.from_shop && !last.failed && Date.now() - Date.parse(last.created_at) < 30 * 60_000) html += `<div class="sc__typing" aria-label="Ждём ответа менеджера"><i></i><i></i><i></i></div>`;
    body.innerHTML = html;
    body.scrollTop = body.scrollHeight;
    // имя и подсказка — пока покупатель ещё ничего не написал
    const first = !real.some((m) => !m.from_shop);
    $("#scName").hidden = !first; $("#scNote").hidden = !first;
  }
  function badge() {
    const n = st.open ? 0 : unread();
    $("#scBadge").hidden = !n; $("#scBadge").textContent = n;
    $("#scHeadBadge").hidden = !n; $("#scHeadBadge").textContent = n;
  }

  // ---------- опрос новых сообщений ----------
  async function poll() {
    if (!st.token) return;
    try {
      const after = st.msgs.reduce((m, x) => (x.id > m ? x.id : m), 0);
      const fresh = await (await api()).chatPoll({ token: st.token, after });
      if (fresh.length) {
        const known = new Set(st.msgs.map((m) => m.id));
        st.msgs = st.msgs.concat(fresh.filter((m) => !known.has(m.id))).sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || (a.id || 1e12) - (b.id || 1e12));
        if (st.open) st.seen = lastShopId();
        save(); if (st.open) render();
      }
    } catch (e) { console.warn(e); }
    badge();
  }
  function schedule() {
    clearTimeout(st.timer);
    if (!st.token) return;
    st.timer = setTimeout(async () => { if (!document.hidden) await poll(); schedule(); }, st.open ? 3000 : 30000);
  }

  // ---------- окно ----------
  function open() {
    st.open = true; box.classList.add("is-open"); box.removeAttribute("aria-hidden"); box.inert = false; fab.classList.add("is-away");
    st.seen = lastShopId(); save(); render(); badge();
    if (matchMedia("(max-width: 900px)").matches) N.lock?.();
    setTimeout(() => text.focus({ preventScroll: true }), 200);
    poll(); schedule();
  }
  function close() {
    st.open = false; box.classList.remove("is-open"); box.setAttribute("aria-hidden", "true"); box.inert = true; fab.classList.remove("is-away");
    if (matchMedia("(max-width: 900px)").matches) N.unlock?.();
    badge(); schedule();
  }

  async function sendText(value) {
    const t = String(value || "").trim();
    if (!t || st.sending) return;
    err.hidden = true;
    st.token ||= newToken();
    st.name = $("#scName").value.trim().slice(0, 80);
    const tmp = { id: null, from_shop: false, text: t, created_at: new Date().toISOString(), pending: true };
    const afterHelper = st.msgs[st.msgs.length - 1]?.bot && st.msgs[st.msgs.length - 1].kind !== "note";
    st.msgs.push(tmp); render();
    st.sending = true; $("#scSend").disabled = true;
    try {
      const msg = await (await api()).chatSend({ token: st.token, name: st.name, text: t });
      // опрос мог принести это же сообщение раньше ответа на отправку — тогда черновик убираем, иначе оно задвоится
      if (msg?.id && st.msgs.some((m) => m !== tmp && m.id === msg.id)) st.msgs.splice(st.msgs.indexOf(tmp), 1);
      else Object.assign(tmp, msg, { pending: false });
      if (afterHelper) st.msgs.push(bot("note", { text: "Вопрос передан менеджеру — ответ придёт сюда" }));
      text.value = ""; autosize();
    } catch (e) {
      st.msgs.splice(st.msgs.indexOf(tmp), 1);
      err.textContent = e.message || "Не удалось отправить. Попробуйте ещё раз"; err.hidden = false;
      text.value = t;
    } finally {
      st.sending = false; $("#scSend").disabled = false;
      save(); render(); schedule();
    }
  }

  function autosize() { text.style.height = "auto"; text.style.height = Math.min(text.scrollHeight, 120) + "px"; }
  text.addEventListener("input", autosize);
  // Enter — отправить, Shift+Enter — новая строка
  text.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); } });
  form.addEventListener("submit", (e) => { e.preventDefault(); sendText(text.value); });
  fab.addEventListener("click", open);
  $("#scClose").addEventListener("click", close);
  body.addEventListener("click", (e) => {
    const t = e.target;
    const q = t.closest("[data-sc-quick]");
    if (q) return sendText(q.textContent);
    if (t.closest("[data-sc-pick]")) return pickStart("🎯 Подобрать под задачу");
    const g = t.closest("[data-sc-goal]");
    if (g) return pickGoal(+g.dataset.scGoal);
    const c = t.closest("[data-sc-cart]");
    if (c) { N.addToCart(c.dataset.scCart, 1); c.textContent = "В корзине ✓"; return N.toast(`${N.byId[c.dataset.scCart].name} — в корзине`, true); }
    const o = t.closest("[data-sc-open]");
    if (o) { close(); return N.open(o.dataset.scOpen); }
    const cm = t.closest("[data-sc-cmp]");
    if (cm) { close(); return N.compareIds(cm.dataset.scCmp.split(",")); }
    if (t.closest("[data-sc-again]")) return pickStart("Другая задача");
    if (t.closest("[data-sc-manager]")) {
      pickPush(local("Позвать менеджера"), bot("text", { text: "Напишите вопрос своими словами — менеджер ответит здесь за 5–15 минут." }));
      body.scrollTop = body.scrollHeight;
      return text.focus();
    }
  });
  // раньше обработчика app.js (фаза перехвата): Esc закрывает только чат, а не всё под ним
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && st.open) { e.preventDefault(); close(); } }, true);
  document.addEventListener("visibilitychange", () => { if (!document.hidden && st.token) poll(); });
  // открыть чат можно и ссылкой …/#chat (например, из бота)
  if (location.hash === "#chat") { history.replaceState(null, "", location.pathname + location.search); open(); }

  badge();
  if (st.token) { poll(); schedule(); }
  N.openChat = open;
})();

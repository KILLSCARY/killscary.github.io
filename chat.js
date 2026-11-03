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
  const GREETING = "Здравствуйте! Подскажем с выбором, составом, доставкой и заказом. Обычно отвечаем за 5–15 минут.";
  const QUICK = ["Как оформить заказ?", "Сроки доставки", "Помогите подобрать", "Где мой заказ?"];

  document.body.insertAdjacentHTML("beforeend", `
    <button class="sc-fab" id="scFab" aria-label="Чат с менеджером">${I_CHAT}<span>Чат с менеджером</span><i class="sc-fab__dot"></i><b id="scBadge" hidden></b></button>
    <section class="sc" id="sc" role="dialog" aria-label="Чат с менеджером" hidden>
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
  const fab = $("#scFab"), box = $("#sc"), body = $("#scBody"), form = $("#scForm"), text = $("#scText"), err = $("#scErr");
  $("#scName").value = st.name || "";

  const time = (iso) => new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  const day = (iso) => { const d = new Date(iso), t = new Date(); return d.toDateString() === t.toDateString() ? "Сегодня" : d.toLocaleDateString("ru-RU", { day: "numeric", month: "long" }); };
  const lastShopId = () => st.msgs.reduce((m, x) => (x.from_shop && x.id > m ? x.id : m), 0);
  const unread = () => st.msgs.filter((m) => m.from_shop && m.id > st.seen).length;

  function render() {
    const msgs = st.msgs;
    let html = msgs.length ? `<span class="sc__day">${day(msgs[0].created_at)}</span>` : "";
    html += `<div class="sc__msg sc__msg--in"><em>Менеджер магазина</em>${GREETING}<time>${time(msgs[0]?.created_at || new Date().toISOString())}</time></div>`;
    if (!msgs.length) html += `<div class="sc__quick">${QUICK.map((q) => `<button type="button" data-sc-quick>${esc(q)}</button>`).join("")}</div>`;
    let prevDay = msgs.length ? day(msgs[0].created_at) : "";
    for (const m of msgs) {
      const d = day(m.created_at);
      if (d !== prevDay) { html += `<span class="sc__day">${d}</span>`; prevDay = d; }
      html += m.from_shop
        ? `<div class="sc__msg sc__msg--in"><em>${esc(m.author || "Менеджер")}</em>${esc(m.text)}<time>${time(m.created_at)}</time></div>`
        : `<div class="sc__msg sc__msg--out${m.pending ? " sc__msg--pending" : ""}${m.failed ? " sc__msg--err" : ""}">${esc(m.text)}<time>${m.failed ? "не отправлено" : time(m.created_at)}</time></div>`;
    }
    // последнее сообщение — покупателя и свежее: показываем, что ответ готовится
    const last = msgs[msgs.length - 1];
    if (last && !last.from_shop && !last.failed && Date.now() - Date.parse(last.created_at) < 30 * 60_000) html += `<div class="sc__typing" aria-label="Ждём ответа менеджера"><i></i><i></i><i></i></div>`;
    body.innerHTML = html;
    body.scrollTop = body.scrollHeight;
    // имя и подсказка — пока покупатель ещё ничего не написал
    const first = !msgs.some((m) => !m.from_shop);
    $("#scName").hidden = !first; $("#scNote").hidden = !first;
  }
  function badge() {
    const n = st.open ? 0 : unread();
    $("#scBadge").hidden = !n; $("#scBadge").textContent = n;
  }

  // ---------- опрос новых сообщений ----------
  async function poll() {
    if (!st.token) return;
    try {
      const after = st.msgs.reduce((m, x) => (x.id > m ? x.id : m), 0);
      const fresh = await (await api()).chatPoll({ token: st.token, after });
      if (fresh.length) {
        const known = new Set(st.msgs.map((m) => m.id));
        st.msgs = st.msgs.concat(fresh.filter((m) => !known.has(m.id))).sort((a, b) => (a.id || 1e12) - (b.id || 1e12));
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
    st.open = true; box.hidden = false; fab.hidden = true;
    st.seen = lastShopId(); save(); render(); badge();
    if (matchMedia("(max-width: 900px)").matches) N.lock?.();
    setTimeout(() => text.focus(), 50);
    poll(); schedule();
  }
  function close() {
    st.open = false; box.hidden = true; fab.hidden = false;
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
    st.msgs.push(tmp); render();
    st.sending = true; $("#scSend").disabled = true;
    try {
      const msg = await (await api()).chatSend({ token: st.token, name: st.name, text: t });
      Object.assign(tmp, msg, { pending: false });
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
  body.addEventListener("click", (e) => { const q = e.target.closest("[data-sc-quick]"); if (q) sendText(q.textContent); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && st.open) close(); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden && st.token) poll(); });
  // открыть чат можно и ссылкой …/#chat (например, из бота)
  if (location.hash === "#chat") { history.replaceState(null, "", location.pathname + location.search); open(); }

  badge();
  if (st.token) { poll(); schedule(); }
  N.openChat = open;
})();

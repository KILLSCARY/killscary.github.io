(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const byId = Object.fromEntries(PRODUCTS.map((p) => [p.id, p]));
  // наборы для отзывов и заказов — такие же позиции, как товары: id вида «set-amm»
  BUNDLES.forEach((b, i) => Object.assign(b, { index: i, set: true, pack: b.items }));
  const bundleById = Object.fromEntries(BUNDLES.map((b) => [b.id, b]));
  // в старых заказах набор записан как «set-<номер>» (set-0 = BUNDLES[0]) — такие id тоже находим
  const legacyBundle = (id) => { const m = /^set-(\d+)$/.exec(id); return m ? BUNDLES[+m[1]] : undefined; };
  const item = (id) => byId[id] || bundleById[id] || legacyBundle(id);
  // постоянный id позиции: для старого «set-0» — «set-amm»
  const canonId = (id) => item(id)?.id ?? id;
  const catById = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));
  const rub = (n) => n.toLocaleString("ru-RU") + " ₽";
  // бесплатные пробники (free) — «Бесплатно», в заказе по одному; иначе цена или null («по запросу»)
  const priceLabel = (p, n = 1) => (p?.free ? "Бесплатно" : p?.price ? rub(p.price * n) : null);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  function plural(n, f) { return f[(n % 10 === 1 && n % 100 !== 11) ? 0 : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) ? 1 : 2]; }
  const icon = (id) => `<svg><use href="#i-${id}"/></svg>`;
  const productsCount = () => `${PRODUCTS.length} ${plural(PRODUCTS.length, ["позиция", "позиции", "позиций"])}`;
  document.querySelectorAll("[data-products-count]").forEach((el) => (el.textContent = productsCount()));

  // отзывы по товарам и наборам (id → список); пересобирается, когда приходят отзывы с сайта
  let rvIndex = new Map();
  function indexReviews(list) {
    rvIndex = new Map();
    for (const r of list) for (const id of r.products) { if (!rvIndex.has(id)) rvIndex.set(id, []); rvIndex.get(id).push(r); }
  }
  indexReviews(REVIEWS);
  const reviewsOf = (id) => rvIndex.get(id) || [];
  const avgRating = (list) => { const rated = list.filter((r) => r.rating); return rated.length ? rated.reduce((s, r) => s + r.rating, 0) / rated.length : 0; };
  const fmtAvg = (n) => n.toFixed(1).replace(".", ",");
  // строка «★ 4,8 · 12 отзывов» на карточке каталога
  function rateHtml(id) {
    const list = reviewsOf(id);
    if (!list.length) return "";
    const avg = avgRating(list);
    return (avg ? `<b>★ ${fmtAvg(avg)}</b>` : "") + `<span>${list.length} ${plural(list.length, ["отзыв", "отзыва", "отзывов"])}</span>`;
  }
  const CAT_IMG = { samples: "p/samples.webp", sex: "p/maca.webp", vit: "p/omega3.webp", life: "p/garlic.webp", brain: "p/hericium.webp", sport: "p/creatine.webp", calm: "p/ashwagandha.webp", tea: "p/da-hong-pao.webp", perfume: "p/capital.webp" };

  // ---------- Хранилище (корзина, избранное) ----------
  const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) || d; } catch { return d; } };
  const store = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
  const cart = load("nss-cart", {});
  const favs = new Set(load("nss-favs", []));
  // наличие: в products.js — отметка out по умолчанию, поверх — отметки менеджера из бота (таблица stock).
  // Последние отметки храним в браузере, чтобы при открытии сайта они были сразу, без мигания.
  PRODUCTS.forEach((p) => (p.baseOut = !!p.out));
  const applyStock = (marks) => PRODUCTS.forEach((p) => (p.out = p.id in marks ? !marks[p.id] : p.baseOut));
  applyStock(load("nss-stock", {}));
  for (const id in cart) if (!byId[id]) delete cart[id];
  for (const id of favs) if (!byId[id]) favs.delete(id);
  let recent = load("nss-recent", []).filter((id) => byId[id]); // «Вы недавно смотрели», последние 12
  const alerts = new Set(); // товары, о поступлении которых покупатель просил сообщить (приходят из account.js)

  // ---------- Общие куски ----------
  const media = (p) =>
    p.img
      ? `<img src="img/${p.img}" alt="${esc(p.name)}" loading="lazy" decoding="async">` + (p.gallery?.[1] ? `<img class="alt" src="img/${p.gallery[1]}" alt="" loading="lazy" decoding="async">` : "")
      : `<div class="jar"><div class="jar__body"><div class="jar__label">
           <span class="jar__brand">НЕ СУЩИЙ</span><span class="jar__name">${esc(p.name)}</span></div></div></div>`;

  const buyHtml = (p) => {
    if (p.out) return alerts.has(p.id)
      ? `<button class="btn btn--light btn--notify" disabled>${icon("bell")}Сообщим в Telegram</button>`
      : `<button class="btn btn--light btn--notify" data-notify="${p.id}">${icon("bell")}Сообщить о поступлении</button>`;
    const q = cart[p.id];
    return q
      ? `<div class="stepper"><button data-dec="${p.id}" aria-label="Меньше">−</button><span>${q}</span><button data-inc="${p.id}" aria-label="Больше">+</button></div>`
      : `<button class="btn btn--dark" data-inc="${p.id}">${icon("cart")}В корзину</button>`;
  };

  const cardHtml = (p) => `
    <article class="card${p.out ? " card--out" : ""}" data-card="${p.id}">
      <div class="card__media" data-open="${p.id}">
        ${media(p)}
        <button class="card__fav${favs.has(p.id) ? " on" : ""}" data-fav="${p.id}" aria-label="В избранное">${icon(favs.has(p.id) ? "heart-fill" : "heart")}</button>
        <div class="card__labels">
          ${p.hit ? `<span class="label label--red">Хит</span>` : ""}
          ${p.out ? `<span class="label label--grey">Нет в наличии</span>` : ""}
        </div>
      </div>
      <div class="card__body">
        ${priceLabel(p) ? `<div class="card__price${p.free ? " card__price--free" : ""}">${priceLabel(p)}</div>` : `<div class="card__price card__price--ask">Цена по запросу</div>`}
        <div class="card__name" data-open="${p.id}">${esc(p.name)} <span>/ ${esc(p.pack)}</span></div>
        <div class="card__rate" data-rate="${p.id}">${rateHtml(p.id)}</div>
        <div class="card__meta">${esc(catById[p.cat].name)}</div>
        <div class="card__buy">${buyHtml(p)}</div>
      </div>
    </article>`;

  // перерисовать только кнопки покупки/избранного у всех карточек товара
  function refreshCards(id) {
    $$(`[data-card="${id}"]`).forEach((c) => {
      c.querySelector(".card__buy").innerHTML = buyHtml(byId[id]);
      const f = c.querySelector(".card__fav");
      f.classList.toggle("on", favs.has(id));
      f.innerHTML = icon(favs.has(id) ? "heart-fill" : "heart");
    });
    if (openId === id) renderProduct();
  }

  // ---------- Шапка: категории ----------
  $("#headerCats").innerHTML = `<button class="hot" data-hits>Хиты</button>` +
    CATEGORIES.map((c) => `<button data-cat="${c.id}">${esc(c.name)}</button>`).join("") + `<button data-goto="bundles">Наборы</button>`;

  // ---------- Мега-меню каталога ----------
  // разделы: подборки (хиты, наборы, всё) + 8 категорий; справа — товары раздела
  const SECTIONS = [
    { group: "Подборки" },
    { key: "hits", name: "Хиты продаж", ico: `<span class="mnav__ico" style="background:var(--red);color:#fff">★</span>`, list: () => PRODUCTS.filter((p) => p.hit) },
    { key: "sets", name: "Наборы со скидкой", ico: `<span class="mnav__ico"><img src="img/p/bundle-amm.webp" alt=""></span>`, sets: true },
    { key: "all", name: "Все товары", ico: `<span class="mnav__ico" style="background:var(--ink);color:#fff">∞</span>`, all: true },
    { group: "Категории" },
    ...CATEGORIES.map((c) => ({ key: c.id, name: c.name, note: c.note, cat: c.id,
      ico: `<span class="mnav__ico"><img src="img/${CAT_IMG[c.id]}" alt=""></span>`, list: () => PRODUCTS.filter((p) => p.cat === c.id) })),
  ];
  const secByKey = Object.fromEntries(SECTIONS.filter((s) => s.key).map((s) => [s.key, s]));
  const countOf = (s) => (s.sets ? BUNDLES.length : s.all ? PRODUCTS.length : s.list().length);
  let megaKey = "hits", navI = 0;

  $("#megaNav").innerHTML = SECTIONS.map((s) => s.group
    ? `<div class="mega__group">${s.group}</div>`
    : `<button class="mnav" data-mnav="${s.key}" style="--i:${navI++}">${s.ico}<span>${esc(s.name)}</span><span class="mnav__count">${countOf(s)}</span>${icon("chevron")}</button>`).join("");

  const miniHtml = (p, i) => `
    <button class="mini${p.out ? " mini--out" : ""}" data-open="${p.id}" style="--i:${Math.min(i, 24)}">
      <span class="mini__img"><img src="img/${p.img}" alt="" loading="lazy" decoding="async">${p.hit ? `<span class="label label--red">Хит</span>` : ""}</span>
      <span class="mini__name">${esc(p.name)}</span>
      <span class="mini__price">${p.out ? "Нет в наличии" : priceLabel(p) || "по запросу"}</span>
    </button>`;
  const setMiniHtml = (b, i) => `
    <button class="mini" data-set="${i}" style="--i:${i}">
      <span class="mini__img"><img src="img/${b.img}" alt="" loading="lazy" decoding="async">${b.old ? `<span class="label label--red">−${Math.round((1 - b.price / b.old) * 100)}%</span>` : ""}</span>
      <span class="mini__name">${esc(b.name)}</span>
      <span class="mini__price">${rub(b.price)}</span>
    </button>`;

  function renderPane(key) {
    megaKey = key;
    const s = secByKey[key];
    $$("#megaNav .mnav").forEach((b) => b.setAttribute("aria-current", b.dataset.mnav === key));
    let body;
    if (s.sets) body = `<div class="pane__grid">${BUNDLES.map(setMiniHtml).join("")}</div>`;
    else if (s.all) {
      // «Все товары» — разбито на сегменты по категориям
      let k = 0;
      body = CATEGORIES.map((c) => `<div class="pane__seg"><h4>${esc(c.name)} <span>${PRODUCTS.filter((p) => p.cat === c.id).length}</span><button data-mnav="${c.id}">Открыть →</button></h4>
        <div class="pane__grid">${PRODUCTS.filter((p) => p.cat === c.id).slice(0, 6).map((p) => miniHtml(p, k++)).join("")}</div></div>`).join("");
    } else {
      // категория: сначала в наличии, затем нет в наличии — отдельными сегментами
      const list = s.list(), inStock = list.filter((p) => !p.out), out = list.filter((p) => p.out);
      body = `<div class="pane__grid">${inStock.map(miniHtml).join("")}</div>` +
        (out.length ? `<div class="pane__seg" style="margin-top:22px"><h4>Нет в наличии <span>${out.length}</span></h4><div class="pane__grid">${out.map((p, i) => miniHtml(p, inStock.length + i)).join("")}</div></div>` : "");
    }
    const pane = $("#megaPane");
    pane.innerHTML = `
      <div class="pane__head">
        <button class="pane__back" data-pane-back aria-label="Назад">${icon("chevron")}</button>
        <h3 class="pane__title">${esc(s.name)}</h3>
        <span class="pane__note">${s.note ? esc(s.note) : `${countOf(s)} ${s.sets ? "наборов" : plural(countOf(s), ["позиция", "позиции", "позиций"])}`}</span>
        <button class="pane__all" data-pane-all="${key}">Смотреть все ${icon("chevron")}</button>
      </div>
      <div class="pane-swap">${body}</div>`;
    pane.scrollTop = 0;
  }

  const mobile = () => matchMedia("(max-width: 900px)").matches;
  function measureHeader() { document.documentElement.style.setProperty("--hh", $(".header").getBoundingClientRect().bottom + "px"); }
  function mega(open) {
    const m = $("#mega");
    if (open === m.classList.contains("open")) return;
    if (open) { measureHeader(); suggest.hidden = true; if (!mobile()) renderPane(megaKey); m.classList.remove("pane-open"); }
    m.classList.toggle("open", open);
    m.setAttribute("aria-hidden", !open);
    $$("[data-toggle-mega]").forEach((b) => b.setAttribute("aria-expanded", open));
    open ? lock() : unlock();
  }
  addEventListener("resize", () => { if ($("#mega").classList.contains("open")) measureHeader(); });
  // телефон: шторка каталога закрывается свайпом влево
  (() => {
    const panel = $("#megaPanel");
    let x0 = null, y0 = 0, dx = 0;
    panel.addEventListener("touchstart", (e) => { if (!mobile()) return; x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; dx = 0; }, { passive: true });
    panel.addEventListener("touchmove", (e) => {
      if (x0 === null) return;
      dx = e.touches[0].clientX - x0;
      const dy = Math.abs(e.touches[0].clientY - y0);
      if (dx < 0 && Math.abs(dx) > dy) { panel.style.transition = "none"; panel.style.transform = `translateX(${dx}px)`; }
    }, { passive: true });
    panel.addEventListener("touchend", () => {
      if (x0 === null) return;
      panel.style.transition = ""; panel.style.transform = "";
      if (dx < -70) mega(false);
      x0 = null;
    });
  })();

  // на десктопе раздел меняется при наведении (с небольшой задержкой, чтобы не мигало при проходе мышью)
  let hoverT;
  $("#megaNav").addEventListener("pointerover", (e) => {
    const b = e.target.closest("[data-mnav]");
    if (!b || mobile() || b.dataset.mnav === megaKey) return;
    clearTimeout(hoverT);
    hoverT = setTimeout(() => renderPane(b.dataset.mnav), 90);
  });

  function goSection(key) {
    mega(false);
    if (key === "sets") return $("#bundles").scrollIntoView({ behavior: "smooth" });
    if (key === "hits") { state.hits = true; state.cat = "all"; renderGrid(); return goAll(); }
    if (key === "all") { state.hits = false; state.cat = "all"; renderGrid(); return goAll(); }
    setCat(key);
  }

  // ---------- Баннеры ----------
  const BANNERS = [
    { bundle: 0, parts: ["ashwagandha", "mg-glycinate", "amanita-extract"], lead: "Быстро засыпать, глубоко спать, просыпаться свежим." },
    { product: "ashwagandha", tag: "Хит продаж", text: "Сон, спокойствие и самый любимый товар в отзывах." },
    { bundle: 1, parts: ["d3", "omega3", "mg-taurate", "zinc", "vitamin-c"], gift: "da-hong-pao", lead: "Иммунитет, энергия и гормоны на весь холодный сезон." },
    { product: "omega3", tag: "База", text: "Сердце, мозг и сосуды. 200 капсул — на 2–6 месяцев." },
  ];
  $("#banners").innerHTML = BANNERS.map((b) => {
    if (b.bundle !== undefined) {
      // набор: размытая обложка на фоне + сама обложка «постером» справа
      const s = BUNDLES[b.bundle];
      // в центре — банки из состава набора, подарок отдельной меткой
      const short = (n) => n.replace(/\s*Экстракт\s*|\s*экстракт\s*/g, " ").replace(/ 10%$/, "").trim();
      // плитка — кнопка своего товара: клик открывает этот товар, а не весь набор (data-open проверяется раньше data-set)
      const tile = (p, i, gift) => `<button type="button" class="hb__part" style="--i:${i}" data-open="${p.id}" aria-label="${esc(p.name)}${gift ? " — подарок" : ""}">
          <span class="hb__part-img"><img src="img/${p.img}" alt="">${gift ? "<em>Подарок</em>" : ""}</span>
          <span class="hb__part-name">${esc(short(p.name))}</span>
          <span class="hb__part-price">${gift ? "бесплатно" : rub(p.price)}</span></button>`;
      const tiles = (b.parts || []).map((id, i) => tile(byId[id], i));
      if (b.gift) tiles.push(tile(byId[b.gift], tiles.length, true));
      return `<div class="hb hb--set" data-set="${b.bundle}">
        <div class="hb__bg"><img src="img/${s.img}" alt="" decoding="async"></div>
        <div class="hb__text">
          <span class="hb__tags"><span class="hb__tag">Набор${s.old ? ` · −${Math.round((1 - s.price / s.old) * 100)}%` : ""}</span>${s.old ? `<span class="hb__save">Выгода ${rub(s.old - s.price)}</span>` : ""}</span>
          <h2>${esc(s.name)}</h2>
          <p class="hb__lead">${esc(b.lead || s.desc)}</p>
          <div class="hb__buy"><span class="hb__price">${rub(s.price)}${s.old ? `<s>${rub(s.old)}</s>` : ""}</span><span class="hb__btn">Смотреть набор</span></div>
        </div>
        ${tiles.length ? `<div class="hb__parts${tiles.length > 4 ? " hb__parts--grid" : ""}">${tiles.join('<span class="hb__plus" aria-hidden="true">+</span>')}</div>` : ""}
        <div class="hb__poster"><img src="img/${s.img}" alt="${esc(s.name)}"></div>
      </div>`;
    }
    const p = byId[b.product];
    return `<div class="hb hb--prod" data-open="${p.id}">
      <div class="hb__text">
        <span class="hb__tag">${esc(b.tag)}</span>
        <h2>${esc(p.name)}</h2>
        <p>${esc(b.text)}</p>
        <div class="hb__buy"><span class="hb__price">${rub(p.price)}</span><span class="hb__btn">Подробнее</span></div>
      </div>
      <div class="hb__product"><img src="img/${p.img}" alt="${esc(p.name)}"></div>
    </div>`;
  }).join("");
  $("#bannerDots").innerHTML = BANNERS.map((_, i) => `<button data-dot="${i}" aria-label="Баннер ${i + 1}"></button>`).join("");
  let bi = 0, bTimer;
  function showBanner(i) {
    bi = (i + BANNERS.length) % BANNERS.length;
    $("#banners").style.transform = `translateX(-${bi * 100}%)`;
    $$("#bannerDots button").forEach((d, k) => d.setAttribute("aria-current", k === bi));
    $$("#banners > *").forEach((s, k) => s.classList.toggle("on", k === bi));
    clearTimeout(bTimer);
    bTimer = setTimeout(() => showBanner(bi + 1), 5000);
  }

  // ---------- Плитки разделов ----------
  // jars — студийные банки раздела (веер), photo — фото на всю плитку для разделов без студийных банок
  const TILES = [
    { hits: true, name: "Хиты продаж", jars: ["tongkat", "hericium", "prostate"], n: PRODUCTS.filter((p) => p.hit).length },
    { cat: "sex", jars: ["tongkat", "maca", "testobooster"] },
    { cat: "vit", jars: ["d3", "omega3", "biotin"] },
    { cat: "life", jars: ["garlic", "prostate", "minoxidil"] },
    { cat: "brain", jars: ["alpha-gpc", "hericium", "theanine"] },
    { cat: "sport", jars: ["eaa", "creatine"] },
    { cat: "calm", jars: ["mg-glycinate", "ashwagandha", "amanita-extract"] },
    { cat: "tea", photo: "p/da-hong-pao.webp" },
    { cat: "perfume", photo: "p/capital.webp" },
    { sets: true, name: "Наборы", photo: "p/bundle-amm.webp", n: BUNDLES.length },
  ];
  $("#cats").innerHTML = TILES.map((t, i) => {
    const name = t.name || catById[t.cat].name;
    const n = t.n ?? PRODUCTS.filter((p) => p.cat === t.cat).length;
    const attr = t.hits ? "data-hits" : t.sets ? 'data-goto="bundles"' : `data-cat="${t.cat}"`;
    // вместо картинки — размытое цветовое пятно от фото раздела
    const art = `<span class="tile__blur" aria-hidden="true"><img src="img/${t.photo || byId[t.jars[1] || t.jars[0]].img}" alt="" loading="lazy" decoding="async"></span>`;
    return `<button class="tile${t.hits ? " tile--hits" : ""}" ${attr} style="--i:${i}">
      ${art}
      <span class="tile__text"><b>${esc(name)}</b><small>${n} ${t.sets ? plural(n, ["набор", "набора", "наборов"]) : plural(n, ["товар", "товара", "товаров"])}</small></span>
    </button>`;
  }).join("");

  // ---------- Хиты ----------
  const renderHits = () => ($("#hitsRow").innerHTML = PRODUCTS.filter((p) => p.hit && !p.out).map(cardHtml).join(""));
  renderHits();

  // ---------- Наборы ----------
  const discount = (b) => (b.old ? `<span class="label label--red">−${Math.round((1 - b.price / b.old) * 100)}%</span>` : "");
  const setHtml = (b) => `
    <div class="set" data-set="${b.index}">
      <div class="set__img"><img src="img/${b.img}" alt="" loading="lazy" decoding="async">${discount(b)}</div>
      <div class="set__body">
        <b>${esc(b.name)}</b>
        <span>${esc(b.items)}</span>
        <div class="card__rate set__rate" data-rate="${b.id}">${rateHtml(b.id)}</div>
        <div class="set__price">${b.price ? rub(b.price) : "Цена по запросу"}${b.old ? `<s>${rub(b.old)}</s>` : ""}</div>
      </div>
    </div>`;
  $("#sets").innerHTML = BUNDLES.map(setHtml).join("");

  // ---------- Вы недавно смотрели ----------
  function remember(id) {
    recent = [id, ...recent.filter((x) => x !== id)].slice(0, 12);
    store("nss-recent", recent);
    renderRecent();
  }
  function renderRecent() {
    $("#recent").hidden = !recent.length;
    $("#recentRow").innerHTML = recent.map((id) => cardHtml(byId[id])).join("");
  }

  // ---------- «Покупают вместе» и «Похожие» ----------
  // вместе: товары из одних наборов (вес 3) и те, что подписчики называют вместе в отзывах (вес 1)
  const pairs = new Map();
  const addPair = (a, b, w) => {
    if (a === b || !byId[a] || !byId[b]) return;
    if (!pairs.has(a)) pairs.set(a, new Map());
    pairs.get(a).set(b, (pairs.get(a).get(b) || 0) + w);
  };
  for (const b of BUNDLES) for (const x of b.ids || []) for (const y of b.ids || []) addPair(x, y, 3);
  for (const r of REVIEWS) for (const x of r.products) for (const y of r.products) addPair(x, y, 1);
  const togetherOf = (id) => [...(pairs.get(id) || [])].sort((a, b) => b[1] - a[1]).map(([k]) => byId[k]).filter((p) => !p.out).slice(0, 10);
  // похожие: тот же раздел каталога — сначала в наличии, хиты и с отзывами
  const similarOf = (p, skip) => PRODUCTS.filter((x) => x.cat === p.cat && x.id !== p.id && !skip.has(x.id))
    .sort((a, b) => (a.out - b.out) || (!!b.hit - !!a.hit) || (reviewsOf(b.id).length - reviewsOf(a.id).length)).slice(0, 10);
  const prow = (title, cards) => (cards.length ? `<div class="pmore"><h3>${title}</h3><div class="prow">${cards.join("")}</div></div>` : "");
  function renderMore(it) {
    if (it.set) {
      const parts = (it.ids || []).map((id) => byId[id]).filter(Boolean);
      $("#pMore").innerHTML = prow("Товары из набора", parts.map(cardHtml)) + prow("Другие наборы", BUNDLES.filter((b) => b !== it).map(setHtml));
      return;
    }
    const tog = togetherOf(it.id), skip = new Set(tog.map((p) => p.id));
    $("#pMore").innerHTML = prow("Выгоднее в наборе", BUNDLES.filter((b) => (b.ids || []).includes(it.id)).map(setHtml)) +
      prow("Покупают вместе", tog.map(cardHtml)) + prow("Похожие товары", similarOf(it, skip).map(cardHtml));
  }

  // ---------- Отзывы ----------
  // Отзывы из канала (REVIEWS, фото в img/) + одобренные отзывы покупателей с сайта
  // (приходят из account.js через NSS.setUserReviews, фото — абсолютные URL).
  const RV_PAGE = 12;
  const isMobile = () => matchMedia("(max-width: 700px)").matches;
  // на телефоне отзывы — горизонтальная лента, туда сразу кладём больше
  const rvState = { filter: "all", shown: isMobile() ? 40 : RV_PAGE };
  let userReviews = [];
  const allReviews = () => [...userReviews, ...REVIEWS];
  const photosOf = (r) => (r.photos?.length ? r.photos : r.img ? ["img/" + r.img] : []);
  const withPhoto = () => allReviews().filter((r) => photosOf(r).length);
  const rvCount = (id) => reviewsOf(id).length;
  const stars = (n) => `<span class="stars" aria-label="Оценка ${n} из 5">${"★".repeat(n)}<i>${"★".repeat(5 - n)}</i></span>`;
  const fmtDate = (iso) => new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long" });

  // шапка раздела: статистика, лента фото, фильтры — пересобираются при появлении отзывов с сайта
  function renderReviewsHead() {
    const all = allReviews(), wp = withPhoto();
    const top = Object.entries(all.reduce((m, r) => (r.products.forEach((p) => (m[p] = (m[p] || 0) + 1)), m), {}))
      .sort((a, b) => b[1] - a[1]).slice(0, 7).map(([id]) => id).filter((id) => item(id));
    const fromSite = userReviews.length ? ` · ${userReviews.length} с сайта` : "";
    $("#rvSub").textContent = `${all.length} ${plural(all.length, ["отзыв", "отзыва", "отзывов"])}${fromSite} · ${wp.length} с фото покупателей`;
    $("#rvPhotos").innerHTML = wp.slice(0, 40).map((r, i) =>
      `<button class="rv-photo" data-rv="${esc(r.id)}" style="--i:${i}"><img src="${esc(photosOf(r)[0])}" alt="Фото покупателя" loading="lazy" decoding="async"></button>`).join("");
    $("#rvFilters").innerHTML = [["all", "Все", all.length], ["photo", "С фото", wp.length], ...top.map((id) => [id, item(id).name.replace(/ 10%$/, ""), rvCount(id)])]
      .map(([k, n, c]) => `<button class="chip" data-rvf="${k}" aria-pressed="${k === rvState.filter}">${esc(n)} <span class="chip__n">${c}</span></button>`).join("");
  }

  const rvName = (n) => n.replace(/ 10%$/, "");
  // «Полезно»: общие счётчики и свои голоса приходят из account.js
  let helpful = {}, myVotes = new Set();
  const helpKey = (r) => String(r.id); // отзыв канала — «5304», с сайта — «u-<uuid>»
  const helpHtml = (k) => `<button class="rv__help${myVotes.has(k) ? " on" : ""}" data-helpful="${esc(k)}" aria-pressed="${myVotes.has(k)}">${icon("like")}Полезно${helpful[k] ? ` <b>${helpful[k]}</b>` : ""}</button>`;
  const refreshHelp = (k) => $$(`[data-helpful="${CSS.escape(k)}"]`).forEach((b) => (b.outerHTML = helpHtml(k)));
  // дата для сортировки: у отзывов канала — «2 ноября» (март–ноябрь 2026), у отзывов с сайта — created_at
  const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
  const tsOf = (r) => {
    if (r.ts === undefined) { const m = /^(\d{1,2})\s+(\S+)/.exec(r.date || ""); r.ts = m && MONTHS.includes(m[2]) ? Date.UTC(2026, MONTHS.indexOf(m[2]), +m[1]) : 0; }
    return r.ts;
  };
  const rvCard = (r, i, opts = {}) => {
    const long = r.text.length > 260;
    const prods = r.products.filter((id) => item(id) && (!opts.except || id !== opts.except)).slice(0, 3);
    const ph = photosOf(r);
    const head = r.user
      ? `<span class="rv__ava rv__ava--user">${esc((r.author || "П").trim().charAt(0).toUpperCase())}</span><div><b>${esc(r.author || "Покупатель")}</b><span>${esc(r.date)}${r.verified ? ' · <em class="rv__ok">✓ Покупка подтверждена</em>' : ""}</span></div>`
      : `<span class="rv__ava">${icon("tg")}</span><div><b>Подписчик канала</b><span>${esc(r.date)}</span></div>`;
    return `<article class="rv${long ? " rv--long" : ""}${r.user ? " rv--user" : ""}" id="rv-${esc(r.id)}" style="--i:${i % RV_PAGE}">
      ${ph.length === 1 ? `<button class="rv__img" data-zoom="${esc(ph[0])}"><img src="${esc(ph[0])}" alt="Фото покупателя" loading="lazy" decoding="async"></button>` : ""}
      ${ph.length > 1 ? `<div class="rv__gallery rv__gallery--${Math.min(ph.length, 3)}">${ph.slice(0, 3).map((u, k) =>
        `<button data-zoom="${esc(u)}"><img src="${esc(u)}" alt="Фото покупателя" loading="lazy" decoding="async">${k === 2 && ph.length > 3 ? `<b>+${ph.length - 3}</b>` : ""}</button>`).join("")}</div>` : ""}
      <div class="rv__body">
        <div class="rv__meta">${head}</div>
        ${r.rating ? stars(r.rating) : ""}
        <p class="rv__text">${esc(r.text)}</p>
        ${long ? `<button class="rv__expand" data-expand="${esc(r.id)}">Читать полностью</button>` : ""}
        ${prods.length ? `<div class="rv__prods">${prods.map((id) => {
          const p = item(id);
          return `<button class="rv__prod" data-open="${id}"><img src="img/${p.img}" alt="">${esc(rvName(p.name))}<b>${priceLabel(p) || ""}</b></button>`;
        }).join("")}</div>` : ""}
        <div class="rv__foot">${helpHtml(helpKey(r))}</div>
      </div>
    </article>`;
  };
  // ---------- Отзывы внутри карточки товара или набора ----------
  const PRV_PAGE = 12; // делится на 2, 3 и 4 колонки — сетка заполняется ровными рядами
  let prv = { id: null, shown: PRV_PAGE, f: "all", sort: "useful" };
  const PRV_SORT = { useful: "Сначала полезные", new: "Сначала новые", high: "Сначала с высокой оценкой", low: "Сначала с низкой оценкой" };
  const prvFilter = (f) => (f === "photo" ? (r) => photosOf(r).length > 0 : /^[1-5]$/.test(f) ? (r) => r.rating === +f : () => true);
  const prvCompare = {
    useful: (a, b) => (helpful[helpKey(b)] || 0) - (helpful[helpKey(a)] || 0) || tsOf(b) - tsOf(a),
    new: (a, b) => tsOf(b) - tsOf(a),
    high: (a, b) => (b.rating || 0) - (a.rating || 0) || tsOf(b) - tsOf(a),
    low: (a, b) => (a.rating || 6) - (b.rating || 6) || tsOf(b) - tsOf(a), // без оценки (отзывы канала) — в конце
  };
  function renderItemReviews(id, more) {
    if (prv.id !== id) prv = { id, shown: PRV_PAGE, f: "all", sort: "useful" };
    if (more) prv.shown += PRV_PAGE;
    const all = reviewsOf(id);
    const write = `<button class="btn btn--light btn--sm" data-write-review="${esc(id)}">${icon("camera")}Написать отзыв</button>`;
    if (!all.length) {
      $("#pReviews").innerHTML = `<h3>Отзывы</h3><div class="prv-empty"><b>Отзывов пока нет</b><p>Купили и попробовали? Расскажите, как подействовало, — ваш отзыв будет первым.</p>${write}</div>`;
      return;
    }
    const avg = avgRating(all), rated = all.filter((r) => r.rating).length;
    const photos = all.flatMap((r) => photosOf(r));
    // фильтры: все, с фото, по звёздам (показываем только те, где есть отзывы)
    const chips = [["all", "Все", all.length], ["photo", "С фото", all.filter(prvFilter("photo")).length],
      ...[5, 4, 3, 2, 1].map((n) => [String(n), `${n} ★`, all.filter(prvFilter(String(n))).length])].filter(([k, , c]) => k === "all" || c);
    if (!chips.some(([k]) => k === prv.f)) prv.f = "all";
    const list = all.filter(prvFilter(prv.f)).sort(prvCompare[prv.sort]);
    $("#pReviews").innerHTML = `<h3>Отзывы <span>${all.length}</span></h3>
      <div class="prv-sum">
        ${avg ? `<div class="prv-avg"><b>${fmtAvg(avg)}</b><div>${stars(Math.round(avg))}<span>${rated} ${plural(rated, ["оценка", "оценки", "оценок"])}</span></div></div>` : ""}
        <div class="prv-meta"><span>${all.length} ${plural(all.length, ["отзыв", "отзыва", "отзывов"])}</span>${photos.length ? `<span>${photos.length} фото покупателей</span>` : ""}</div>
        ${write}
      </div>
      ${photos.length ? `<div class="prv-photos">${photos.slice(0, 12).map((u) => `<button data-zoom="${esc(u)}"><img src="${esc(u)}" alt="Фото покупателя" loading="lazy" decoding="async"></button>`).join("")}</div>` : ""}
      <div class="prv-bar">
        <div class="prv-chips">${chips.map(([k, n, c]) => `<button class="chip" data-prvf="${k}" aria-pressed="${k === prv.f}">${n} <span class="chip__n">${c}</span></button>`).join("")}</div>
        <select class="select prv-sort" data-prv-sort aria-label="Сортировка отзывов">${Object.entries(PRV_SORT).map(([k, n]) => `<option value="${k}"${k === prv.sort ? " selected" : ""}>${n}</option>`).join("")}</select>
      </div>
      <div class="pcard__rv">${list.slice(0, prv.shown).map((r, i) => rvCard(r, i, { except: id })).join("")}</div>
      ${list.length > prv.shown ? `<button class="btn btn--light btn--wide prv-more" data-prv-more>Показать ещё ${Math.min(PRV_PAGE, list.length - prv.shown)} из ${list.length - prv.shown}</button>` : ""}`;
  }

  // ---------- Вопросы о товаре ----------
  // опубликованные вопросы с ответами магазина приходят из account.js; задать вопрос — через NSS.askQuestion
  let questions = new Map(); // id товара → [вопрос]
  const qa = { id: null, all: false, open: false };
  function renderQa(id) {
    if (qa.id !== id) Object.assign(qa, { id, all: false, open: false });
    const list = questions.get(id) || [];
    const shown = qa.all ? list : list.slice(0, 4);
    const ask = qa.open
      ? `<form class="qa-form" data-qa-form>
          <textarea name="q" rows="3" maxlength="1000" placeholder="Например: как принимать вместе с магнием? Подойдёт ли при…" required></textarea>
          <div class="qa-form__bar"><button class="btn btn--dark btn--sm" type="submit">Отправить вопрос</button><button class="btn btn--light btn--sm" type="button" data-qa-cancel>Отмена</button></div>
          <p class="qa-err" role="alert"></p>
        </form>`
      : `<div class="qa-ask"><p>${list.length ? "Не нашли ответа?" : "Вопросов пока нет."} Спросите — менеджер ответит, ответ придёт вам в Telegram и появится здесь.</p><button class="btn btn--light btn--sm" data-qa-open>Задать вопрос</button></div>`;
    $("#pQa").innerHTML = `<h3>Вопросы о товаре${list.length ? ` <span>${list.length}</span>` : ""}</h3>${ask}
      ${shown.map((q) => `<article class="qa">
        <div class="qa__q"><b>${esc(q.text)}</b><span>${esc(q.author)} · ${fmtDate(q.created_at)}</span></div>
        <div class="qa__a"><em>Ответ магазина</em><p>${esc(q.answer)}</p></div>
      </article>`).join("")}
      ${list.length > shown.length ? `<button class="btn btn--light prv-more" data-qa-all>Все вопросы (${list.length})</button>` : ""}`;
  }

  function rvList() {
    const f = rvState.filter;
    return f === "all" ? allReviews() : f === "photo" ? withPhoto() : reviewsOf(f);
  }
  function renderReviews() {
    const list = rvList();
    $("#rvGrid").innerHTML = list.slice(0, rvState.shown).map((r, i) => rvCard(r, i)).join("");
    $("#rvMore").hidden = rvState.shown >= list.length;
    $("#rvMore").textContent = `Показать ещё ${Math.min(RV_PAGE, list.length - rvState.shown)} из ${list.length - rvState.shown}`;
    $$("#rvFilters .chip").forEach((c) => c.setAttribute("aria-pressed", c.dataset.rvf === rvState.filter));
  }
  $("#rvMore").addEventListener("click", () => { rvState.shown += RV_PAGE; renderReviews(); });

  // клик по фото покупателя — фильтр «С фото» и подсветка нужного отзыва
  function focusReview(id) {
    if (!document.getElementById("rv-" + id)) { rvState.filter = "photo"; rvState.shown = withPhoto().length; renderReviews(); }
    const el = document.getElementById("rv-" + id);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.remove("rv--flash"); void el.offsetWidth; el.classList.add("rv--flash");
  }

  // просмотр фото на весь экран
  function zoom(url) {
    $("#zoomImg").src = url;
    $("#zoom").hidden = false;
    lock();
  }

  // ---------- Каталог: фильтры, сортировка, поиск ----------
  const state = { cat: "all", hits: false, q: "", sort: "pop", stock: true, priced: false, pmin: 0, pmax: 0 };
  $("#chips").innerHTML = [{ id: "all", name: "Все" }, ...CATEGORIES]
    .map((c) => `<button class="chip" data-chip="${c.id}" aria-pressed="${c.id === "all"}">${esc(c.name)}</button>`).join("");

  function filtered() {
    const q = state.q.toLowerCase();
    const list = PRODUCTS.filter((p) =>
      (state.cat === "all" || p.cat === state.cat) &&
      (!state.hits || p.hit) &&
      (!state.stock || !p.out) &&
      (!state.priced || p.price || p.free) &&
      // фильтр по цене: товары «цена по запросу» в него не попадают
      (!(state.pmin || state.pmax) || (p.price && p.price >= state.pmin && (!state.pmax || p.price <= state.pmax))) &&
      (!q || (p.name + " " + p.pack + " " + p.desc + " " + (p.tagline || "") + " " + catById[p.cat].name).toLowerCase().includes(q)));
    const pk = (p) => p.price ?? (state.sort === "asc" ? Infinity : -Infinity);
    return list.sort((a, b) =>
      state.sort === "asc" ? pk(a) - pk(b) :
      state.sort === "desc" ? pk(b) - pk(a) :
      state.sort === "name" ? a.name.localeCompare(b.name, "ru") :
      (a.out - b.out) || (!!b.hit - !!a.hit) || (!!b.img - !!a.img) || (!!b.price - !!a.price));
  }

  // товары порциями: на телефоне по 12, на компьютере по 24; при смене фильтра — заново
  const gridPage = () => (matchMedia("(max-width: 700px)").matches ? 12 : 24);
  let gridLimit = gridPage(), gridKey = "";
  function renderGrid() {
    const list = filtered();
    const key = JSON.stringify([state.cat, state.hits, state.q, state.sort, state.stock, state.priced, state.pmin, state.pmax]);
    if (key !== gridKey) { gridKey = key; gridLimit = gridPage(); }
    $("#allTitle").textContent = state.q ? `Поиск: «${state.q}»` : state.hits ? "Хиты продаж" : state.cat === "all" ? "Все товары" : catById[state.cat].name;
    $("#allCount").textContent = `${list.length} ${plural(list.length, ["товар", "товара", "товаров"])}`;
    $("#grid").innerHTML = list.slice(0, gridLimit).map(cardHtml).join("");
    const rest = list.length - gridLimit;
    $("#gridMore").hidden = rest <= 0;
    $("#gridMore").textContent = `Показать ещё ${Math.min(gridPage(), rest)} из ${rest}`;
    $("#empty").hidden = list.length > 0;
    $$("#chips .chip").forEach((c) => c.setAttribute("aria-pressed", !state.hits && c.dataset.chip === state.cat));
    $$("#cats .cat").forEach((c) => c.setAttribute("aria-current", c.dataset.cat === state.cat));
  }

  $("#gridMore").addEventListener("click", () => { gridLimit += gridPage(); renderGrid(); });

  function goAll() { $("#all").scrollIntoView({ behavior: "smooth" }); }
  function setCat(id) { state.cat = id; state.hits = false; renderGrid(); goAll(); }

  $("#sort").addEventListener("change", (e) => { state.sort = e.target.value; renderGrid(); });
  $("#onlyStock").addEventListener("change", (e) => { state.stock = e.target.checked; renderGrid(); });
  $("#onlyPrice").addEventListener("change", (e) => { state.priced = e.target.checked; renderGrid(); });
  // цена «от — до»: пересчитываем после паузы в наборе, «до» меньше «от» — меняем местами
  let priceT;
  const readPrice = () => {
    let a = Math.max(0, Math.round(+$("#priceMin").value || 0)), b = Math.max(0, Math.round(+$("#priceMax").value || 0));
    if (a && b && b < a) [a, b] = [b, a];
    Object.assign(state, { pmin: a, pmax: b });
    renderGrid();
  };
  for (const id of ["#priceMin", "#priceMax"]) $(id).addEventListener("input", () => { clearTimeout(priceT); priceT = setTimeout(readPrice, 350); });
  $("#resetFilters").addEventListener("click", () => {
    Object.assign(state, { cat: "all", hits: false, q: "", stock: true, priced: false, pmin: 0, pmax: 0 });
    $("#search").value = ""; $("#onlyStock").checked = true; $("#onlyPrice").checked = false;
    $("#priceMin").value = $("#priceMax").value = "";
    renderGrid();
  });

  // поиск с подсказками
  const search = $("#search"), suggest = $("#suggest");
  search.addEventListener("input", () => {
    const q = search.value.trim().toLowerCase();
    if (!q) { suggest.hidden = true; if (state.q) { state.q = ""; renderGrid(); } return; }
    const found = PRODUCTS.filter((p) => (p.name + " " + catById[p.cat].name).toLowerCase().includes(q)).slice(0, 6);
    suggest.innerHTML = found.length
      ? found.map((p) => `<button type="button" data-open="${p.id}"><span class="thumb">${media(p)}</span>${esc(p.name)}<small>${priceLabel(p) || "по запросу"}</small></button>`).join("")
      : `<button type="button" disabled>Ничего не найдено</button>`;
    suggest.hidden = false;
  });
  $("#searchForm").addEventListener("submit", (e) => {
    e.preventDefault();
    state.q = search.value.trim(); state.cat = "all"; state.hits = false;
    suggest.hidden = true;
    renderGrid(); goAll();
  });
  document.addEventListener("click", (e) => { if (!e.target.closest(".search")) suggest.hidden = true; });

  // ---------- Карточка товара ----------
  // У каждого товара и набора своя ссылка: адрес страницы меняется на #p/<id>,
  // поэтому ссылкой можно поделиться, а «назад» в браузере или на телефоне закрывает окно.
  // Для превью в Telegram publish.sh делает страницы p/<id>/ — они сразу переводят сюда же.
  const SITE_URL = (window.NSS_CONFIG || {}).siteUrl || "https://killscary.github.io/";
  const productHash = (id) => "#p/" + id;
  const hashId = () => { const m = /^#p\/([a-z0-9-]{1,60})$/.exec(location.hash); return m && item(m[1]) ? item(m[1]).id : null; };
  let openId = null;
  function openProduct(id, fromHistory) {
    const it = item(id);
    if (!it) return;
    if (it.set) renderBundle(it.index);
    else { openId = it.id; renderProduct(); remember(it.id); }
    renderMore(it);
    renderQa(it.id);
    $("#product").hidden = false;
    $(".pcard").scrollTop = 0;
    suggest.hidden = true;
    lock();
    // окно уже открыто (переход к похожему товару) — заменяем адрес, чтобы «назад» сразу закрывало окно
    if (!fromHistory && location.hash !== productHash(it.id)) history[hashId() ? "replaceState" : "pushState"](null, "", productHash(it.id));
  }
  const openBundle = (i) => openProduct(BUNDLES[i].id);
  addEventListener("popstate", () => {
    const id = hashId();
    if (id) openProduct(id, true);
    else if (!$("#product").hidden) hideProduct();
  });

  // поделиться ссылкой на страницу товара (с превью в Telegram): системное меню на телефоне, иначе — копия в буфер
  async function shareItem(id) {
    const it = item(id), url = `${SITE_URL}p/${it.id}/`;
    if (navigator.share && matchMedia("(pointer: coarse)").matches) {
      try { return await navigator.share({ title: it.name, text: `${it.name} — НЕ СУЩИЙ STORE`, url }); }
      catch (e) { if (e.name === "AbortError") return; }
    }
    try { await navigator.clipboard.writeText(url); }
    catch {
      const t = document.createElement("textarea"); t.value = url; t.style.cssText = "position:fixed;opacity:0";
      document.body.appendChild(t); t.select(); document.execCommand("copy"); t.remove();
    }
    toast("Ссылка скопирована — отправьте её в Telegram");
  }
  // галерея: основное фото + миниатюры
  function renderGallery(files, fallback) {
    $("#pMedia").innerHTML = files.length ? `<img src="img/${files[0]}" alt="">` : fallback;
    $("#pThumbs").innerHTML = files.length > 1
      ? files.map((f, i) => `<button class="thumb" data-thumb="${f}" aria-current="${i === 0}"><img src="img/${f}" alt=""></button>`).join("") : "";
  }
  // описание + разделы («Эффекты приёма», «Схема приёма», «Состав»…)
  const sectionsHtml = (about, sections) =>
    `<h3>Описание</h3>${about.map((s) => `<p>${esc(s)}</p>`).join("")}` +
    sections.map((s) => `<h3>${esc(s.h)}</h3>` + (s.list
      ? `<ul class="pcard__list">${s.items.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`
      : s.items.map((x) => `<p>${esc(x)}</p>`).join(""))).join("");

  let openSet = null;
  function renderProduct() {
    const p = byId[openId];
    openSet = null;
    renderGallery(p.gallery || [], media(p));
    $("#pCat").textContent = `Каталог / ${catById[p.cat].name}`;
    $("#pCat").dataset.cat = p.cat;
    $("#pName").textContent = p.name;
    $("#pTagline").textContent = p.tagline || "";
    $("#pTags").innerHTML = (p.hit ? `<span class="label label--red">Хит продаж</span>` : "") +
      (p.out ? `<span class="label label--grey">Нет в наличии</span>` : `<span class="label">В наличии</span>`);
    const props = [["Категория", catById[p.cat].name], ["Фасовка", p.pack], ["Бренд", "НЕ СУЩИЙ STORE"]];
    $("#pPropsH").hidden = $("#pProps").hidden = false;
    $("#pProps").innerHTML = props.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join("");
    $("#pBody").innerHTML = sectionsHtml(p.about?.length ? p.about : [p.desc], p.sections || []);
    renderItemReviews(p.id);
    $("#pPrice").innerHTML = p.free ? `Бесплатно<small>оплачивается только доставка</small>`
      : p.price ? `${rub(p.price)}<small>${esc(p.pack)}</small>` : `Цена по запросу<small>менеджер назовёт актуальную</small>`;
    $("#pVariants").innerHTML = (p.variants || []).map((v) => `<div><span>${esc(v.label)}</span><b>${rub(v.price)}</b></div>`).join("");
    $("#pBuy").innerHTML = buyHtml(p);
    $("#pFav").hidden = false;
    $("#pFav").className = "fav-line" + (favs.has(p.id) ? " on" : "");
    $("#pFav").innerHTML = `${icon(favs.has(p.id) ? "heart-fill" : "heart")}${favs.has(p.id) ? "В избранном" : "В избранное"}`;
    $("#pFav").dataset.fav = p.id;
    $("#pShare").dataset.share = p.id;
    $("#pOneClick").hidden = !!p.out;
    $("#pDelivery").textContent = DELIVERY;
  }

  // набор открывается в том же окне
  function renderBundle(i) {
    const b = BUNDLES[i];
    openId = null; openSet = i;
    renderGallery([b.img], "");
    $("#pCat").textContent = "Каталог / Наборы";
    $("#pCat").dataset.cat = "";
    $("#pName").textContent = b.name;
    $("#pTagline").textContent = b.items;
    $("#pTags").innerHTML = `<span class="label">Набор</span>` + (b.old ? `<span class="label label--red">−${Math.round((1 - b.price / b.old) * 100)}%</span>` : "");
    $("#pPropsH").hidden = $("#pProps").hidden = true;
    const parts = b.parts?.length
      ? `<h3>Состав набора</h3><ul class="parts">${b.parts.map((x) => `<li><b>${esc(x.name)}</b>${x.text ? `<span>${esc(x.text)}</span>` : ""}</li>`).join("")}</ul>` : "";
    $("#pBody").innerHTML = `<h3>Описание</h3><p>${esc(b.desc)}</p>` + parts + sectionsHtml([], b.sections || []).replace("<h3>Описание</h3>", "");
    renderItemReviews(b.id);
    $("#pPrice").innerHTML = b.price ? `${rub(b.price)}${b.old ? `<small><s>${rub(b.old)}</s></small>` : "<small>за набор</small>"}` : "Цена по запросу";
    $("#pVariants").innerHTML = "";
    $("#pBuy").innerHTML = `<button class="btn btn--dark" data-bundle="${i}">${icon("tg")}Заказать набор</button>`;
    $("#pOneClick").hidden = true;
    $("#pFav").hidden = true;
    $("#pShare").dataset.share = b.id;
    $("#pDelivery").textContent = DELIVERY;
  }

  function hideProduct() { $("#product").hidden = true; openId = null; openSet = null; unlock(); }
  // закрыть окно: если адрес — #p/<id>, возвращаемся по истории (popstate спрячет окно)
  function closeProduct() {
    const wasOpen = !$("#product").hidden;
    hideProduct();
    if (wasOpen && hashId()) history.back();
  }
  // «Купить в 1 клик» — заказ одного товара сразу менеджеру в бота (account.js)
  $("#pOneClick").addEventListener("click", () => {
    const p = byId[openId];
    window.NSS.orderNow([{ id: p.id, name: p.name, pack: p.pack, price: p.free ? 0 : p.price || null, qty: 1, ...(p.free ? { free: true } : {}) }]);
  });

  // ---------- Корзина ----------
  function setQty(id, q) {
    if (byId[id]?.free && q > 1) { q = 1; toast("Пробник — один на заказ"); }
    if (q > 0) cart[id] = q; else delete cart[id];
    store("nss-cart", cart);
    refreshCards(id);
    renderCart();
  }

  function totals() {
    let sum = 0, ask = 0, count = 0;
    for (const [id, q] of Object.entries(cart)) { count += q; byId[id].price ? (sum += byId[id].price * q) : byId[id].free ? 0 : (ask += q); }
    return { sum, ask, count };
  }

  function renderCart() {
    const ids = Object.keys(cart), t = totals();
    for (const el of [$("#cartCount"), $("#cartCount2")]) { el.textContent = t.count; el.hidden = !t.count; }
    $("#favCount").textContent = favs.size; $("#favCount").hidden = !favs.size;
    $("#cartPageCount").textContent = t.count ? `${t.count} ${plural(t.count, ["товар", "товара", "товаров"])}` : "";
    $("#summary").hidden = !ids.length;
    $("#cartList").innerHTML = ids.length
      ? ids.map((id) => {
          const p = byId[id];
          return `<div class="citem">
            <div class="citem__img" data-open="${id}">${media(p)}</div>
            <div>
              <div class="citem__name" data-open="${id}">${esc(p.name)}</div>
              <div class="citem__pack">${esc(p.pack)}</div>
              <div class="citem__acts">
                <button data-fav="${id}">${icon(favs.has(id) ? "heart-fill" : "heart")}${favs.has(id) ? "В избранном" : "В избранное"}</button>
                <button data-remove="${id}">${icon("trash")}Удалить</button>
              </div>
            </div>
            <div class="stepper"><button data-dec="${id}" aria-label="Меньше">−</button><span>${cart[id]}</span><button data-inc="${id}" aria-label="Больше">+</button></div>
            <div class="citem__price">${priceLabel(p, cart[id]) || "по запросу"}${p.price && cart[id] > 1 ? `<small>${rub(p.price)} / шт.</small>` : ""}</div>
          </div>`;
        }).join("")
      : `<div class="cart-empty"><b>В корзине пока пусто</b><p>Загляните в каталог — там ${productsCount()}</p><button class="btn btn--dark" data-close-page>Перейти к покупкам</button></div>`;
    $("#sumItems").textContent = `Товары, ${t.count} шт.`;
    $("#sumGoods").textContent = rub(t.sum);
    $("#sumAsk").textContent = t.ask ? `+ ${t.ask} шт. с ценой по запросу — магазин назовёт сумму` : "";
    $("#sumTotal").textContent = rub(t.sum) + (t.ask ? " +" : "");
    $("#sumShip").innerHTML = shipBar(t.sum);
  }
  // полоска «до бесплатной доставки» — в корзине и в анкете
  function shipBar(sum) {
    const free = window.NSS_API.FREE_DELIVERY_FROM;
    if (!free) return "";
    if (sum >= free) return `<b>🚚 Доставка бесплатно</b>`;
    return `<span>До бесплатной доставки — <b>${rub(free - sum)}</b></span><i style="--p:${Math.round((sum / free) * 100)}%"></i>`;
  }

  // оформление — в account.js: заказ сохраняется в профиле и уходит менеджеру в бота
  $("#checkout").addEventListener("click", () => window.NSS.checkout());
  function askBundle(i) {
    const b = BUNDLES[i];
    window.NSS.orderNow([{ id: b.id, name: `Набор «${b.name}»`, pack: b.items, price: b.price || null, qty: 1 }]);
  }

  // ---------- Избранное ----------
  function toggleFav(id) {
    favs.has(id) ? favs.delete(id) : favs.add(id);
    store("nss-favs", [...favs]);
    refreshCards(id);
    renderCart();
    if (!$("#favPage").hidden) renderFavs();
    toast(favs.has(id) ? "Добавлено в избранное" : "Удалено из избранного");
  }
  function renderFavs() {
    $("#favGrid").innerHTML = favs.size ? [...favs].map((id) => cardHtml(byId[id])).join("")
      : `<div class="cart-empty" style="grid-column:1/-1"><b>В избранном пусто</b><p>Нажмите ♡ на карточке товара, чтобы сохранить его</p></div>`;
  }

  // ---------- Окна ----------
  const lock = () => document.body.classList.add("lock");
  // прокрутку страницы возвращаем, только когда закрыты все окна (страницы, шторки, меню)
  const unlock = () => { if (!document.querySelector(".page:not([hidden]), .sheet:not([hidden])") && !$("#mega").classList.contains("open")) document.body.classList.remove("lock"); };
  // пока открыта страница (корзина/избранное/профиль), главную под ней не рисуем — меньше работы при прокрутке
  let pageTimer;
  const openPage = (id) => {
    $$(".page").forEach((p) => (p.hidden = p.id !== id)); lock();
    clearTimeout(pageTimer); pageTimer = setTimeout(() => document.body.classList.add("page-open"), 320);
  };
  const closePages = () => { clearTimeout(pageTimer); document.body.classList.remove("page-open"); $$(".page").forEach((p) => (p.hidden = true)); unlock(); };
  const openCart = () => { renderCart(); openPage("cartPage"); };
  const openFavs = () => { renderFavs(); openPage("favPage"); };

  $("#cartOpen").addEventListener("click", openCart);
  $("#favOpen").addEventListener("click", openFavs);

  // ---------- Все клики ----------
  document.addEventListener("click", (e) => {
    const t = e.target;
    const rvf = t.closest("[data-rvf]");
    if (rvf) { rvState.filter = rvf.dataset.rvf; rvState.shown = matchMedia("(max-width: 700px)").matches ? 40 : RV_PAGE; return renderReviews(); }
    const ex = t.closest("[data-expand]");
    if (ex) { const card = ex.closest(".rv"); card.classList.toggle("rv--open"); ex.textContent = card.classList.contains("rv--open") ? "Свернуть" : "Читать полностью"; return; }
    const zm = t.closest("[data-zoom]");
    if (zm) return zoom(zm.dataset.zoom);
    if (t.closest("[data-close-zoom]")) { $("#zoom").hidden = true; return unlock(); }
    const rvp = t.closest("[data-rv]");
    if (rvp && !t.closest("#product")) return focusReview(rvp.dataset.rv);
    if (t.closest("[data-toggle-mega]")) return mega(!$("#mega").classList.contains("open"));
    const mn = t.closest("[data-mnav]");
    if (mn) { renderPane(mn.dataset.mnav); return $("#mega").classList.add("pane-open"); }
    if (t.closest("[data-pane-back]")) return $("#mega").classList.remove("pane-open");
    const pa = t.closest("[data-pane-all]");
    if (pa) return goSection(pa.dataset.paneAll);
    if (t.closest("#mega [data-open], #mega [data-set]")) mega(false);
    const fav = t.closest("[data-fav]");
    if (fav) { e.stopPropagation(); return toggleFav(fav.dataset.fav); }
    const inc = t.closest("[data-inc]");
    if (inc) { const id = inc.dataset.inc; setQty(id, (cart[id] || 0) + 1); if (cart[id] === 1) toast(`${byId[id].name} — в корзине`, true); return; }
    const dec = t.closest("[data-dec]");
    if (dec) return setQty(dec.dataset.dec, (cart[dec.dataset.dec] || 0) - 1);
    const rm = t.closest("[data-remove]");
    if (rm) return setQty(rm.dataset.remove, 0);
    const open = t.closest("[data-open]");
    if (open) { closePages(); return openProduct(open.dataset.open); }
    const set = t.closest("[data-set]");
    if (set) { closePages(); return openBundle(+set.dataset.set); }
    if (t.closest("[data-prv-more]")) return renderItemReviews(prv.id, true);
    const prvf = t.closest("[data-prvf]");
    if (prvf) { Object.assign(prv, { f: prvf.dataset.prvf, shown: PRV_PAGE }); return renderItemReviews(prv.id); }
    const hp = t.closest("[data-helpful]");
    if (hp) return window.NSS.voteHelpful(hp.dataset.helpful, !myVotes.has(hp.dataset.helpful));
    const ntf = t.closest("[data-notify]");
    if (ntf) return window.NSS.notifyStock(ntf.dataset.notify);
    const sh = t.closest("[data-share]");
    if (sh) return shareItem(sh.dataset.share);
    if (t.closest("[data-qa-open]")) { qa.open = true; renderQa(qa.id); return $("#pQa textarea").focus(); }
    if (t.closest("[data-qa-cancel]")) { qa.open = false; return renderQa(qa.id); }
    if (t.closest("[data-qa-all]")) { qa.all = true; return renderQa(qa.id); }
    if (t.closest("[data-recent-clear]")) { recent = []; store("nss-recent", recent); return renderRecent(); }
    const th = t.closest("[data-thumb]");
    if (th) { $("#pMedia").innerHTML = `<img src="img/${th.dataset.thumb}" alt="">`; return $$("#pThumbs .thumb").forEach((x) => x.setAttribute("aria-current", x === th)); }
    const bundle = t.closest("[data-bundle]");
    if (bundle) return askBundle(+bundle.dataset.bundle);
    const cat = t.closest("[data-cat]");
    // ссылка «Каталог / …» в окне товара: адрес не трогаем, иначе «назад» снова откроет товар
    if (cat) e.preventDefault();
    if (cat && cat.dataset.cat) { mega(false); closeProduct(); return setCat(cat.dataset.cat); }
    if (cat) { closeProduct(); return $("#bundles").scrollIntoView({ behavior: "smooth" }); }
    const chip = t.closest("[data-chip]");
    if (chip) { state.cat = chip.dataset.chip; state.hits = false; return renderGrid(); }
    if (t.closest("[data-hits], [data-goto-hits]")) { state.hits = true; state.cat = "all"; renderGrid(); return goAll(); }
    const go = t.closest("[data-goto]");
    if (go) { mega(false); return $("#" + go.dataset.goto).scrollIntoView({ behavior: "smooth" }); }
    const dot = t.closest("[data-dot]");
    if (dot) return showBanner(+dot.dataset.dot);
    const arrow = t.closest("[data-banner]");
    if (arrow) return showBanner(bi + +arrow.dataset.banner);
    if (t.closest("[data-close-product]")) return closeProduct();
    if (t.closest("[data-close-page]")) return closePages();
    if (t.closest('.tabbar a[href="#top"]')) { closePages(); mega(false); }
    if (t.closest("[data-close-mega]")) return mega(false);
    if (t.closest("[data-close-how]")) { $("#how").hidden = true; return unlock(); }
    if (t.closest("[data-how]")) { e.preventDefault(); $("#how").hidden = false; return lock(); }
    if (t.closest("[data-open-cart]") || t.closest("[data-toast-cart]")) return openCart();
    if (t.closest("[data-open-fav]")) return openFavs();
  });
  document.addEventListener("change", (e) => {
    if (e.target.matches("[data-prv-sort]")) { Object.assign(prv, { sort: e.target.value, shown: PRV_PAGE }); renderItemReviews(prv.id); }
  });
  // вопрос о товаре: без входа account.js сначала попросит войти через Telegram
  document.addEventListener("submit", async (e) => {
    const f = e.target.closest("[data-qa-form]");
    if (!f) return;
    e.preventDefault();
    const text = f.elements.q.value.trim(), err = $(".qa-err", f), btn = $("[type=submit]", f);
    if (text.length < 5) { err.textContent = "Напишите вопрос подробнее — от 5 символов"; return f.elements.q.focus(); }
    btn.disabled = true; err.textContent = "";
    try {
      if (await window.NSS.askQuestion(qa.id, text)) { qa.open = false; renderQa(qa.id); toast("Вопрос отправлен — ответ придёт вам в Telegram"); }
    } catch (er) { err.textContent = er.message; }
    finally { btn.disabled = false; }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!$("#zoom").hidden) { $("#zoom").hidden = true; return unlock(); }
    $$(".sheet[data-esc]").forEach((s) => (s.hidden = true));
    closeProduct(); closePages(); mega(false); $("#how").hidden = true; suggest.hidden = true; unlock();
  });

  let toastTimer;
  function toast(msg, withCart) {
    const el = $("#toast");
    el.innerHTML = `<span>${esc(msg)}</span>` + (withCart ? `<button data-toast-cart>Перейти в корзину</button>` : "");
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2800);
  }

  // ---------- Мобильная навигация ----------
  // шапка уезжает при прокрутке вниз и возвращается при прокрутке вверх (только телефон)
  (() => {
    let lastY = scrollY, ticking = false;
    addEventListener("scroll", () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const y = scrollY, dy = y - lastY;
        if (!mobile() || document.body.classList.contains("lock") || y < 120) document.body.classList.remove("nav-hidden");
        else if (dy > 8) document.body.classList.add("nav-hidden");
        else if (dy < -8) document.body.classList.remove("nav-hidden");
        if (Math.abs(dy) > 8 || y < 120) lastY = y;
        ticking = false;
      });
    }, { passive: true });
  })();
  // колесо мыши листает горизонтальные ленты (хиты, подборки, фото, фильтры) вбок — полос прокрутки на сайте нет.
  // Дошли до края ленты — колесо снова прокручивает страницу. Тачпад с прокруткой вбок работает как обычно.
  const wheelBusy = new WeakMap();
  addEventListener("wheel", (e) => {
    if (e.ctrlKey || Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
    for (let el = e.target; el && el !== document.body; el = el.parentElement) {
      if (el.scrollWidth <= el.clientWidth + 2 || !/(auto|scroll)/.test(getComputedStyle(el).overflowX)) continue;
      const fwd = e.deltaY > 0;
      const can = fwd ? el.scrollLeft + el.clientWidth < el.scrollWidth - 2 : el.scrollLeft > 2;
      if (!can) return;
      e.preventDefault();
      // одна «щёлка» колеса — почти экран ленты; частые события тачпада не накапливаем
      if (performance.now() - (wheelBusy.get(el) || 0) < 320) return;
      wheelBusy.set(el, performance.now());
      el.scrollBy({ left: (fwd ? 1 : -1) * Math.max(160, el.clientWidth * 0.8), behavior: "smooth" });
      return;
    }
  }, { passive: false });

  // подсветка активной вкладки нижнего меню
  function syncTabbar() {
    const open = (id) => !document.getElementById(id)?.hidden;
    const key = $("#mega").classList.contains("open") ? "mega" : open("cartPage") ? "cart" : open("favPage") ? "fav" : open("profilePage") ? "profile" : "home";
    const sel = { home: '.tab[href="#top"]', mega: ".tab[data-toggle-mega]", cart: ".tab[data-open-cart]", fav: ".tab[data-open-fav]", profile: ".tab[data-open-profile]" }[key];
    $$(".tabbar .tab").forEach((t) => t.setAttribute("aria-current", t.matches(sel)));
  }
  // следим только за шторкой каталога и тремя страницами, а не за всем документом
  const tabObs = new MutationObserver(syncTabbar);
  tabObs.observe($("#mega"), { attributes: true, attributeFilter: ["class"] });
  ["cartPage", "checkoutPage", "favPage", "profilePage"].forEach((id) => tabObs.observe(document.getElementById(id), { attributes: true, attributeFilter: ["hidden"] }));
  syncTabbar();

  // мост для account.js: профиль, заказы, отзывы покупателей
  window.NSS = {
    byId, item, canonId, bundles: BUNDLES,
    orderBundle: (id) => askBundle(item(id).index), rub, esc, icon, plural, media, toast, lock, unlock, openPage, closePages, closeProduct, fmtDate, stars,
    openProduct: (id) => { closePages(); openProduct(id); },
    isProductOpen: () => !$("#product").hidden, shipBar,
    // отметки наличия из бота: перерисовываем всё, где видно «в наличии / нет»
    setStock(marks) {
      const before = PRODUCTS.map((p) => p.out).join();
      applyStock(marks);
      store("nss-stock", marks);
      if (PRODUCTS.map((p) => p.out).join() === before) return;
      renderHits(); renderGrid(); renderRecent(); renderCart();
      if (!$("#favPage").hidden) renderFavs();
      if (openId && !$("#product").hidden) { renderProduct(); renderMore(byId[openId]); }
    },
    // «Сообщить о поступлении»: подписки покупателя (после входа) и новая подписка
    setAlerts(ids) { alerts.clear(); ids.forEach((id) => alerts.add(id)); PRODUCTS.filter((p) => p.out).forEach((p) => refreshCards(p.id)); },
    markAlert(id) { alerts.add(id); refreshCards(id); },
    // «Полезно»: счётчики для всех, свои голоса, мгновенное обновление кнопки
    setHelpful(counts, mine) {
      helpful = counts || {}; myVotes = new Set(mine || []);
      $$("[data-helpful]").forEach((b) => (b.outerHTML = helpHtml(b.dataset.helpful)));
    },
    applyVote(key, on) {
      if (on === myVotes.has(key)) return;
      on ? myVotes.add(key) : myVotes.delete(key);
      helpful[key] = Math.max(0, (helpful[key] || 0) + (on ? 1 : -1));
      refreshHelp(key);
    },
    // опубликованные вопросы с ответами
    setQuestions(list) {
      questions = new Map();
      for (const q of list) { const id = canonId(q.product_id); if (!questions.has(id)) questions.set(id, []); questions.get(id).push(q); }
      if (!$("#product").hidden && qa.id) renderQa(qa.id);
    },
    cartItems: () => Object.entries(cart).map(([id, qty]) => ({ id, qty })),
    totals,
    clearCart() { for (const id of Object.keys(cart)) setQty(id, 0); },
    addToCart(id, qty) { if (byId[id] && !byId[id].out) setQty(id, (cart[id] || 0) + qty); },
    // одобренные отзывы с сайта → в общую ленту
    setUserReviews(list) {
      userReviews = list.filter((r) => item(r.product_id)).map((r) => ({ id: "u-" + r.id, user: true, text: r.text, rating: r.rating, photos: r.photos || [], products: [r.product_id], author: r.author, verified: r.verified, date: fmtDate(r.created_at), ts: Date.parse(r.created_at) || 0 }));
      indexReviews(allReviews());
      renderReviewsHead(); renderReviews();
      $$("[data-rate]").forEach((el) => (el.innerHTML = rateHtml(el.dataset.rate)));
      if (!$("#product").hidden && prv.id) renderItemReviews(prv.id);
    },
  };

  // видео-логотип подключаем, когда страница уже загрузилась
  addEventListener("load", () => {
    const v = $(".brandmark video");
    if (!v || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    v.src = v.dataset.src; v.play().catch(() => {});
    // ролик в видео-шапке: не грузим при экономии трафика, играет только пока шапка видна
    const hv = $(".vhero__video");
    if (!hv || navigator.connection?.saveData) return;
    hv.src = hv.dataset.src;
    new IntersectionObserver(([e]) => (e.isIntersecting ? hv.play().catch(() => {}) : hv.pause())).observe(hv);
  });

  renderGrid();
  renderReviewsHead();
  renderReviews();
  renderCart();
  renderRecent();
  showBanner(0);
  // открыли сайт по ссылке на товар (#p/<id>): под окном оставляем главную, чтобы «назад» вела на неё
  const startId = hashId();
  if (startId) { history.replaceState(null, "", location.pathname + location.search); openProduct(startId); }
})();

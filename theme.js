// Дневная и ночная тема. Первую тему ставит скрипт в <head> index.html (до показа страницы).
// Здесь — переключатель: кнопка в шапке на компьютере и на телефоне ([data-theme-toggle]).
// Выбор покупателя запоминается в localStorage ("nss-theme"); пока он ничего не выбрал — тема как на устройстве.
(() => {
  const KEY = "nss-theme";
  const root = document.documentElement;
  const sys = matchMedia("(prefers-color-scheme: dark)");
  const saved = () => { try { const t = localStorage.getItem(KEY); return t === "dark" || t === "light" ? t : null; } catch { return null; } };
  const btns = document.querySelectorAll("[data-theme-toggle]");

  function apply(theme) {
    root.dataset.theme = theme;
    const dark = theme === "dark";
    for (const b of btns) {
      b.setAttribute("aria-pressed", String(dark));
      b.setAttribute("aria-label", dark ? "Ночная тема. Включить дневную" : "Дневная тема. Включить ночную");
    }
  }

  apply(saved() || (sys.matches ? "dark" : "light"));
  for (const b of btns) b.addEventListener("click", () => {
    const next = root.dataset.theme === "dark" ? "light" : "dark";
    try { localStorage.setItem(KEY, next); } catch {}
    apply(next);
  });
  // покупатель тему не выбирал — следуем за устройством, например вечером телефон сам переходит в тёмную
  sys.addEventListener("change", (e) => { if (!saved()) apply(e.matches ? "dark" : "light"); });
})();

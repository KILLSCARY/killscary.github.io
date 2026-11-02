// Подключение профиля. Если поля пустые — сайт работает в демо-режиме:
// вход, заказы и отзывы хранятся только в этом браузере.
// Как получить значения — см. supabase/README.md.
window.NSS_CONFIG = {
  supabaseUrl: "https://rejxmbwvuiylmcgdmtjb.supabase.co",
  // публичный ключ anon (legacy JWT): его можно держать на сайте, доступ ограничен правами в базе
  supabaseAnonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJlanhtYnd2dWl5bG1jZ2RtdGpiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM2MjE1MzYsImV4cCI6MjEwOTE5NzUzNn0.HknTatP5xLFdaKEgm1TdmWxTDS0U0c1U_mD6gJ3I0hU",
  telegramBot: "nssauth_bot", // username бота для входа, без @
};

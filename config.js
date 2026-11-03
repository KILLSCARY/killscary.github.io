// Подключение профиля. Если поля пустые — сайт работает в демо-режиме:
// вход, заказы и отзывы хранятся только в этом браузере.
// Как получить значения — см. supabase/README.md.
window.NSS_CONFIG = {
  supabaseUrl: "https://tbzmyrntpethwdqdvwcj.supabase.co",
  // публичный ключ anon (legacy JWT): его можно держать на сайте, доступ ограничен правами в базе
  supabaseAnonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRiem15cm50cGV0aHdkcWR2d2NqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM3MTM3MDUsImV4cCI6MjEwOTI4OTcwNX0.f1sS3D71Gk3nqyepUesIWKrBC8iqq-Mb3sSmc9kHGzI",
  telegramBot: "nssauth_bot", // username бота для входа, без @
};

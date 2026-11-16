# VKStorm

Массовый постинг в VK-сообщества через VK ID OAuth: загрузка фото и видео, прямые посты и предложка, журнал и история публикаций.

Стек: Next.js 16 (App Router, React 19), Drizzle ORM + Postgres, Node 24.

## Почему нужен VPS со стабильным IP

VK выдаёт пользовательские access-токены, жёстко привязанные к IP-адресу выдачи. На Vercel (Fluid Compute) трафик идёт через NAT-пул с несколькими egress-IP, из-за чего VK периодически отдаёт `Error 5: access_token was given to another IP address` и требует перевыпуска токена. На VPS исходящий IP один и стабильный — проблема уходит.

Пользовательские медиафайлы тоже хранятся локально (volume `uploads_data`), а не во внешнем блоб-сторадже.

## Требования

- VPS с установленными Docker и Docker Compose
- Доменное имя с A-записью на IP сервера (для автоматических TLS-сертификатов через Caddy)
- Приложение, зарегистрированное в [id.vk.com](https://id.vk.com) (нужны `VK_APP_ID` и `VK_APP_SECRET`; в настройках приложения укажите `Redirect URI = https://ВАШ_ДОМЕН/api/auth/callback`)

## Развёртывание

```bash
git clone <url> /opt/vkstorm
cd /opt/vkstorm
cp .env.example .env
# заполните POSTGRES_PASSWORD, VK_APP_ID, VK_APP_SECRET, VK_REDIRECT_URI, DOMAIN
docker compose up -d --build
```

Caddy автоматически получит сертификат Let's Encrypt для `$DOMAIN`. Откройте `https://$DOMAIN`.

Миграции Drizzle применяются автоматически при старте контейнера `app`. Если нужно прогнать руками:

```bash
docker compose exec app ./migrate/node_modules/.bin/drizzle-kit migrate
```

## Обновление

```bash
cd /opt/vkstorm
git pull
docker compose up -d --build
```

## Логи и мониторинг

```bash
docker compose logs -f app      # приложение
docker compose logs -f caddy    # прокси и TLS
docker compose logs -f postgres # база
```

## Бэкапы

Данные живут в именованных volume `vkstorm_postgres_data` и `vkstorm_uploads_data` (префикс зависит от имени каталога, в котором запущен compose).

```bash
# Postgres
docker compose exec -T postgres pg_dump -U vkstorm vkstorm | gzip > vkstorm-$(date +%F).sql.gz

# Загруженные медиа
docker run --rm -v vkstorm_uploads_data:/src -v "$PWD":/dst alpine \
  tar czf /dst/uploads-$(date +%F).tar.gz -C /src .
```

Восстановление:

```bash
gunzip -c vkstorm-YYYY-MM-DD.sql.gz | docker compose exec -T postgres psql -U vkstorm vkstorm
docker run --rm -v vkstorm_uploads_data:/dst -v "$PWD":/src alpine \
  sh -c "cd /dst && tar xzf /src/uploads-YYYY-MM-DD.tar.gz"
```

## Развёртывание на Vercel

Укажите production-значения `DATABASE_URL` и переменных VK ID, перечисленных в
`.env.example`. Для новых вложений подключите приватное Vercel Blob хранилище с
серверным токеном `VKSTORM_BLOB_READ_WRITE_TOKEN`. Если проект уже использует
публичный Blob, оставьте его подключённым для ранее сохранённых вложений.

Браузер загружает файлы напрямую в приватный Blob. Приложение проверяет владельца
при выдаче файла по `/uploads/…` и читает его напрямую при отправке в VK.
Локальный запуск без приватного Blob продолжает использовать `UPLOADS_DIR`.

Применяйте миграции к production PostgreSQL отдельным шагом перед подключением
нового деплоя к домену. Для базы с уже созданными таблицами и пустым журналом
Drizzle сначала сверьте существующую схему с миграциями и отметьте совпавшие
миграции в журнале.

## Локальная разработка

```bash
cp .env.example .env.local
# заполните DATABASE_URL (например, postgresql://postgres:postgres@localhost:5432/vkstorm),
# VK_APP_ID, VK_APP_SECRET, VK_REDIRECT_URI=http://localhost:3000/api/auth/callback,
# NEXT_PUBLIC_VK_APP_ID, NEXT_PUBLIC_VK_REDIRECT_URI (те же значения)
npm install
npm run db:migrate
npm run dev
```

Загруженные файлы сохраняются в `./uploads` (настраивается через `UPLOADS_DIR`).

## Проверка публикаций

Соберите приложение и укажите локальный PostgreSQL для интеграционной проверки. Тест создаёт временную схему, применяет миграции, запускает standalone-сервер и подменяет ответы VK API.

```bash
npm run build
VKSTORM_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/vkstorm_test \
  node --test tests/publish.integration.test.mjs
```

## Структура

- `src/app/` — App Router страницы и API-роуты
- `src/lib/` — общие модули (`auth`, `vk-method`, `storage`, `posts`, `groups`, ...)
- `drizzle/` — сгенерированные SQL-миграции
- `Dockerfile`, `docker-compose.yml`, `Caddyfile` — инфраструктура

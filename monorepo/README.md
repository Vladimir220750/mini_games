# RPS Solana — skeleton

Монорепо: Next.js web, Fastify API (Prisma + Socket.IO), shared types.

## Быстрый старт
1) Установи pnpm 9+ и Docker Desktop.
2) Подними БД и Redis:
   ```bash
   cd infra
   docker compose up -d
   ```
3) Установи зависимости и миграции:
   ```bash
   cd ..
   cp .env.example .env
   pnpm i -w
   pnpm --filter @apps/api prisma generate
   pnpm --filter @apps/api prisma migrate dev --name init
   ```
4) Запуск дев-сервисов:
   ```bash
   pnpm dev
   ```
   Web: http://localhost:3000, API: http://localhost:4000

## Структура
- /apps/web — Next.js 14 TS (скелет страницы + Socket.IO client)
- /apps/api — Fastify TS, Prisma схема, базовые эндпоинты матчей
- /packages/shared — общие типы
- /infra/docker-compose.yml — Postgres + Redis


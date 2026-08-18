# a7smart

Дашборд керування квартирами на Tuya Cloud — клімат, світло, розетки, камери,
історія споживання. Прод: **smart.zvyazok.com**

## Швидкий старт

```bash
npm install
```

```bash
cp .env.example .env
```

Згенерувати секрети й заповнити `.env`:

```bash
npx tsx server/src/scripts/hash-password.ts 'ваш-пароль'
```

```bash
openssl rand -hex 32
```

Застосувати міграції та подивитися, що віддає ваш Tuya-акаунт:

```bash
npm run db:migrate && npm run tuya:probe
```

Запуск у режимі розробки (API :3000, фронтенд :5173 з проксі на API):

```bash
npm run dev
```

## Команди

| Команда | Що робить |
|---|---|
| `npm run dev` | Сервер і фронтенд одночасно |
| `npm run build` | Збірка web + server |
| `npm run typecheck` | Перевірка типів обох воркспейсів |
| `npm run lint` | ESLint |
| `npm run db:migrate` | Міграції в Neon |
| `npm run tuya:probe` | Список пристроїв і їхні сирі DP-коди |

## Структура

```
server/   Hono API, Tuya-клієнт, поллер, міграції
web/      React + Vite, віддається тим самим контейнером у проді
```

## Розгортання

Див. [DEPLOY.md](DEPLOY.md). Коротко: пуш у `main` → GitHub Actions збирає образ
у GHCR → на сервері `docker compose pull && up -d`.

## Документація

- [ARCHITECTURE.md](ARCHITECTURE.md) — потік даних, провайдери, обґрунтування рішень, пастки
- [STATE.md](STATE.md) — що вже працює, що налаштовано, що відкрито
- [CLAUDE.md](CLAUDE.md) — правила роботи з кодом
- [DEPLOY.md](DEPLOY.md) — розгортання з нуля

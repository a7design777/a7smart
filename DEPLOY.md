# Розгортання a7smart на smart.zvyazok.com

Сервер `159.223.224.106` (Ubuntu 22.04, 1 vCPU, 1 GB RAM) — той самий, що й у a7cms.
Уже працюють **Traefik + n8n + flowise + a7cms**. Додаємо a7smart окремим стеком,
сусідів не чіпаємо. Postgres — зовнішній (Neon).

**Образ збирається в GitHub Actions**, на сервері лише `docker pull`. Локальний
`docker build` на 1 vCPU поруч із рештою контейнерів надто дорогий.

---

## Крок 1. Tuya IoT Platform

1. [iot.tuya.com](https://iot.tuya.com) → **Cloud → Create Cloud Project**.
   Регіон — **Central Europe** (має збігатися з регіоном вашого акаунта Smart Life).
2. Підписатися на безкоштовні сервіси: **IoT Core**, **Authorization Token Management**,
   **Smart Home Basic Service**, **Device Status Notification**.
3. **Devices → Link App Account** → відсканувати QR-код додатком Smart Life.
4. Записати `Access ID`, `Access Secret` (Overview → Authorization Key) та `UID`
   (Devices → Link App Account, колонка UID).

> IoT Core видається на обмежений строк і **продовжується вручну** через
> *Cloud → My Services*. Коли він спливе, дашборд перестане отримувати дані.
> Це найчастіша причина «раптової поломки» — див. `/api/health`.

## Крок 2. Neon

1. Створити проєкт на [neon.tech](https://neon.tech), БД `a7smart`.
2. Скопіювати connection string з `?sslmode=require`.

## Крок 3. Локальна підготовка

```bash
cp .env.example .env
```

Заповнити `.env`, згенерувавши секрети:

```bash
npx tsx server/src/scripts/hash-password.ts 'ваш-пароль'
```

```bash
openssl rand -hex 32
```

Застосувати міграції (з локальної машини — сервер не навантажуємо):

```bash
npm run db:migrate
```

## Крок 4. Розвідка пристроїв

**Обов'язковий крок, не пропускати.** Tuya віддає різні datapoint-коди для різних
моделей — вгадати їх неможливо.

```bash
npm run tuya:probe
```

Скрипт надрукує всі пристрої та їхні сирі коди. Звірте з мапінгом у
`server/src/tuya/normalize.ts` і допишіть те, чого бракує. Для камер він окремо
перевірить, чи видається HLS-потік.

## Крок 5. Квартири та прив'язка пристроїв

Заповнити таблиці в Neon (SQL Editor):

```sql
INSERT INTO apartments (slug, name, sort_order) VALUES
  ('apt-a', 'Квартира А', 1),
  ('apt-b', 'Квартира Б', 2);
```

Після першого запуску сервера (він синхронізує каталог) прив'язати пристрої:

```sql
UPDATE devices SET apartment_id = 1 WHERE tuya_id IN ('bf1234…', 'bf5678…');
```

## Крок 6. GitHub

Репозиторій: [a7design777/a7smart](https://github.com/a7design777/a7smart) — приватний.
Пуш у `main` запускає `.github/workflows/deploy.yml`, який кладе образ у
`ghcr.io/a7design777/a7smart:latest`.

Приватне репо потребує **двох різних доступів** — їх легко переплутати:

| Що | Навіщо | Чим |
|---|---|---|
| Код на сервері | `docker-compose.prod.yml` + оновлення через `git pull` | Deploy key |
| Образ із GHCR | `docker pull` | Публічний пакет або PAT |

**Deploy key не автентифікує до GHCR** — це тільки git.

### 6.1. Deploy key

Генерувати на сервері, щоб приватна частина нікуди не подорожувала:

```bash
ssh-keygen -t ed25519 -C "a7smart-deploy" -f ~/.ssh/a7smart_deploy -N ""
```

Вміст `~/.ssh/a7smart_deploy.pub` додати в
[Settings → Deploy keys](https://github.com/a7design777/a7smart/settings/keys)
→ *Add deploy key*. **Write access не вмикати** — серверу потрібне лише читання.

Прив'язати ключ до хоста:

```bash
printf 'Host github-a7smart\n  HostName github.com\n  User git\n  IdentityFile ~/.ssh/a7smart_deploy\n  IdentitiesOnly yes\n' >> ~/.ssh/config
```

### 6.2. Доступ до образу

Найпростіше — зробити пакет публічним після першої збірки
(Packages → `a7smart` → Package settings → Change visibility → Public).
Образ секретів не містить: усі ключі підставляються з `.env.production`
під час запуску.

Якщо пакет має лишитися приватним — PAT зі скоупом `read:packages`:

```bash
docker login ghcr.io -u a7design777
```

## Крок 7. Сервер

```bash
git clone github-a7smart:a7design777/a7smart.git /root/a7smart && cd /root/a7smart
```

Створити `.env.production` — вміст той самий, що й у локальному `.env`,
але `NODE_ENV=production`:

```bash
nano .env.production
```

Запуск:

```bash
docker compose -f docker-compose.prod.yml pull && docker compose -f docker-compose.prod.yml up -d
```

## Крок 8. DNS

У Cloudflare (або де хоститься зона `zvyazok.com`) додати `A`-запис:
`smart` → `159.223.224.106`. Traefik випустить TLS-сертифікат при першому запиті.

## Крок 9. Перевірка

```bash
docker ps --format '{{.Names}}\t{{.Status}}'
```

```bash
docker stats --no-stream --format '{{.Name}}\t{{.MemUsage}}'
```

```bash
curl -sI https://smart.zvyazok.com | head -3
```

```bash
curl -s https://smart.zvyazok.com/api/health
```

`/api/health` має повернути `"tuyaAuthProblem": false` і свіжий `lastPollAt`.
Перевірити `free -h` — сусіди не мають бути витіснені у swap.

---

## Оновлення

Пуш у `main` → Actions збирає образ → на сервері:

```bash
cd /root/a7smart && git pull && docker compose -f docker-compose.prod.yml pull && docker compose -f docker-compose.prod.yml up -d
```

`git pull` потрібен лише коли змінювався сам `docker-compose.prod.yml`;
код застосунку приїжджає всередині образу.

## Зупинка (сусідів не зачіпає)

```bash
cd /root/a7smart && docker compose -f docker-compose.prod.yml down
```

## Діагностика

| Симптом | Найімовірніша причина |
|---|---|
| `/api/health` → `tuyaAuthProblem: true` | Скінчився IoT Core. Продовжити в *Cloud → My Services* |
| Порожній список пристроїв | Не прив'язаний акаунт Smart Life або невірний `TUYA_UID` |
| Помилка підпису (код 1004) | `TUYA_BASE_URL` не того регіону, що проєкт |
| Камера не грає | Модель не віддає HLS через хмару — перевірити `npm run tuya:probe` |
| Показник є в Tuya, але не на дашборді | Немає коду в `server/src/tuya/normalize.ts` |

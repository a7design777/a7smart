-- Схема a7smart для Cloudflare D1 (SQLite).
--
-- Консолідована відразу у фінальному вигляді — попередні 5 міграцій під
-- Postgres/Neon відповідали еволюції схеми (провайдери, перейменування
-- tuya_id → external_id, головна квартира, сценарії); тут історія не
-- потрібна, бо D1 стартує з чистого аркуша.

CREATE TABLE IF NOT EXISTS apartments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  slug       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  -- Головна квартира: та, що відкривається одразу при вході. Частковий
  -- унікальний індекс нижче гарантує, що вона лише одна.
  is_main    INTEGER NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS apartments_single_main_idx
  ON apartments (is_main) WHERE is_main;

CREATE TABLE IF NOT EXISTS devices (
  -- Ідентифікатор пристрою будь-якого провайдера (Tuya id або Remihome code).
  external_id  TEXT PRIMARY KEY,
  provider     TEXT NOT NULL DEFAULT 'tuya',
  apartment_id INTEGER REFERENCES apartments(id) ON DELETE SET NULL,
  name         TEXT NOT NULL,
  category     TEXT NOT NULL,
  kind         TEXT NOT NULL DEFAULT 'unknown',
  enabled      INTEGER NOT NULL DEFAULT 1,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  -- Зона Remihome — довідкове поле для першого розподілу по квартирах.
  source_zone  TEXT,
  synced_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS devices_apartment_idx ON devices(apartment_id);
CREATE INDEX IF NOT EXISTS devices_provider_idx ON devices(provider);

-- Часовий ряд. Пишеться поллером раз на POLL_INTERVAL_MS.
CREATE TABLE IF NOT EXISTS readings (
  device_id TEXT NOT NULL REFERENCES devices(external_id) ON DELETE CASCADE,
  key       TEXT NOT NULL,
  value     REAL NOT NULL,
  ts        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Основний патерн запиту — «показник X пристрою Y за період».
CREATE INDEX IF NOT EXISTS readings_lookup_idx ON readings(device_id, key, ts DESC);

-- Сценарії: іменований набір дій, що виконується однією кнопкою.
-- Розкладів і тригерів тут навмисно немає — це ручні сценарії.
CREATE TABLE IF NOT EXISTS scenes (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  apartment_id INTEGER REFERENCES apartments(id) ON DELETE CASCADE,
  icon         TEXT,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS scenes_apartment_idx ON scenes(apartment_id);

CREATE TABLE IF NOT EXISTS scene_actions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  scene_id   INTEGER NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
  device_id  TEXT NOT NULL REFERENCES devices(external_id) ON DELETE CASCADE,
  code       TEXT NOT NULL,
  -- Значення зберігається рядком, а його тип — окремо: Tuya приймає
  -- булеве й числа, Remihome — лише рядки. Без типу відновити потрібну
  -- форму при виконанні неможливо.
  value      TEXT NOT NULL,
  value_type TEXT NOT NULL DEFAULT 'string',
  position   INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS scene_actions_scene_idx ON scene_actions(scene_id, position);

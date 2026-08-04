-- Схема a7smart. Три таблиці: квартири, пристрої, часовий ряд показників.
-- Tuya не має поняття «квартира», тому прив'язка робиться вручну на нашому боці.

CREATE TABLE IF NOT EXISTS apartments (
  id         SERIAL PRIMARY KEY,
  slug       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  sort_order INT  NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS devices (
  tuya_id      TEXT PRIMARY KEY,
  apartment_id INT REFERENCES apartments(id) ON DELETE SET NULL,
  name         TEXT NOT NULL,
  category     TEXT NOT NULL,
  kind         TEXT NOT NULL DEFAULT 'unknown',
  enabled      BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order   INT NOT NULL DEFAULT 0,
  synced_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS devices_apartment_idx ON devices(apartment_id);

-- Часовий ряд. Пишеться поллером раз на POLL_INTERVAL_MS.
CREATE TABLE IF NOT EXISTS readings (
  device_id TEXT NOT NULL REFERENCES devices(tuya_id) ON DELETE CASCADE,
  key       TEXT NOT NULL,
  value     DOUBLE PRECISION NOT NULL,
  ts        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Основний патерн запиту — «показник X пристрою Y за період».
CREATE INDEX IF NOT EXISTS readings_lookup_idx ON readings(device_id, key, ts DESC);

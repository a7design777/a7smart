-- Домогосподарства (homes) Tuya Smart Life ↔ квартири дашборда.
--
-- Квартири створюються вручну, а в Tuya пристрої живуть у «домогосподарствах».
-- Ця таблиця пам'ятає, яке домогосподарство вже обробив автоімпорт і до якої
-- квартири воно прив'язане. Рядок лишається навіть після видалення квартири
-- (ON DELETE SET NULL): apartment_id = NULL означає «користувач видалив
-- квартиру», і імпорт не відтворює її щогодини заново.

CREATE TABLE IF NOT EXISTS tuya_homes (
  home_id      TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  apartment_id INTEGER REFERENCES apartments(id) ON DELETE SET NULL
);

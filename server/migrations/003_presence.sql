-- Присутність живлення за квартирами.
--
-- Поллер раз на цикл пише, скільки пристроїв квартири були в мережі.
-- «Світло є» рахується під час читання (online * 2 >= total), тож поріг
-- можна міняти без перезапису історії. Рядки живуть довго (роки), на
-- відміну від readings, які чистяться за 90 днів.
CREATE TABLE IF NOT EXISTS presence (
  apartment_id INTEGER NOT NULL REFERENCES apartments(id) ON DELETE CASCADE,
  ts           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  online       INTEGER NOT NULL,
  total        INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS presence_lookup_idx ON presence(apartment_id, ts);

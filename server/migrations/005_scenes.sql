-- Сценарії: іменований набір дій, що виконується однією кнопкою.
--
-- Розкладок і розкладів тут навмисно немає — це ручні сценарії.
-- Автоматизації за часом чи подією потребують окремого рушія, і мішати
-- їх у ту саму таблицю означало б закласти складність наперед.

CREATE TABLE IF NOT EXISTS scenes (
  id           SERIAL PRIMARY KEY,
  name         TEXT NOT NULL,
  apartment_id INT REFERENCES apartments(id) ON DELETE CASCADE,
  icon         TEXT,
  sort_order   INT NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS scenes_apartment_idx ON scenes(apartment_id);

CREATE TABLE IF NOT EXISTS scene_actions (
  id         SERIAL PRIMARY KEY,
  scene_id   INT NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
  device_id  TEXT NOT NULL REFERENCES devices(external_id) ON DELETE CASCADE,
  code       TEXT NOT NULL,
  -- Значення зберігається рядком, а його тип — окремо: Tuya приймає
  -- булеве й числа, Remihome — лише рядки. Без типу відновити потрібну
  -- форму при виконанні неможливо.
  value      TEXT NOT NULL,
  value_type TEXT NOT NULL DEFAULT 'string',
  position   INT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS scene_actions_scene_idx ON scene_actions(scene_id, position);

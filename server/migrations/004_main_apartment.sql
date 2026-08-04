-- Головна квартира: та, що відкривається одразу при вході.
--
-- Прапорець, а не окрема таблиця налаштувань: головна може бути лише
-- одна, і часткового унікального індексу для цього достатньо.

ALTER TABLE apartments ADD COLUMN IF NOT EXISTS is_main BOOLEAN NOT NULL DEFAULT FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS apartments_single_main_idx
  ON apartments (is_main) WHERE is_main;

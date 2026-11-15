-- Часовий пояс квартири: Travel — у Мадриді, решта — Київ. Від нього залежать
-- годинник на вкладці квартири, «графік сьогодні» термостата і межі діб у
-- графіку світла.
ALTER TABLE apartments ADD COLUMN timezone TEXT NOT NULL DEFAULT 'Europe/Kyiv';

UPDATE apartments SET timezone = 'Europe/Madrid' WHERE name = 'Travel';

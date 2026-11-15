-- Локація квартири (точка на карті): від неї залежать погода, схід і захід
-- сонця для цієї квартири. NULL — використовується погода з Home Assistant
-- (локація самого HA). Travel — Мадрид (центр міста); точніше можна
-- виставити вручну в «Квартирах».
ALTER TABLE apartments ADD COLUMN latitude REAL;
ALTER TABLE apartments ADD COLUMN longitude REAL;

UPDATE apartments SET latitude = 40.42, longitude = -3.70 WHERE name = 'Travel';

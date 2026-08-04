-- Перейменування tuya_id → external_id.
--
-- З появою Remihome назва колонки стала брехати: у ній лежить
-- ідентифікатор пристрою будь-якого провайдера. Зовнішній ключ
-- readings.device_id при перейменуванні зберігається автоматично.

ALTER TABLE devices RENAME COLUMN tuya_id TO external_id;

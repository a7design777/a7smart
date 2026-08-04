-- Підтримка кількох джерел пристроїв (Tuya, Remihome).
--
-- Раніше первинним ключем був tuya_id, і вся модель мовчки припускала
-- одного вендора. Тепер ключ складений: (provider, external_id).

ALTER TABLE devices ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'tuya';

-- Ідентифікатори різних вендорів можуть збігатися лише теоретично,
-- але покладатися на це не варто.
CREATE INDEX IF NOT EXISTS devices_provider_idx ON devices(provider);

-- Зони Remihome — власна ієрархія вендора. Зберігаємо як довідкове поле:
-- прив'язку до квартири користувач усе одно робить вручну, але зона
-- допомагає зорієнтуватися при першому розподілі 40+ пристроїв.
ALTER TABLE devices ADD COLUMN IF NOT EXISTS source_zone TEXT;

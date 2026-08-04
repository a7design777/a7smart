import { sql } from './client.js';
import type { DeviceKind } from '../tuya/normalize.js';

export interface DeviceRow {
  tuya_id: string;
  apartment_id: number | null;
  name: string;
  category: string;
  kind: string;
  enabled: boolean;
  sort_order: number;
}

export interface ApartmentRow {
  id: number;
  slug: string;
  name: string;
  sort_order: number;
}

export function listApartments(): Promise<ApartmentRow[]> {
  return sql<ApartmentRow[]>`
    SELECT id, slug, name, sort_order
    FROM apartments
    ORDER BY sort_order, name
  `;
}

export async function createApartment(name: string): Promise<ApartmentRow> {
  // slug виводимо з назви, але за унікальність відповідає лічильник:
  // назви кирилицею дали б порожній slug, а дублікати — конфлікт.
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'apt';

  const rows = await sql<ApartmentRow[]>`
    INSERT INTO apartments (slug, name, sort_order)
    VALUES (
      ${base} || '-' || (SELECT coalesce(max(id), 0) + 1 FROM apartments)::text,
      ${name},
      (SELECT coalesce(max(sort_order), 0) + 1 FROM apartments)
    )
    RETURNING id, slug, name, sort_order
  `;
  return rows[0]!;
}

export async function renameApartment(id: number, name: string): Promise<void> {
  await sql`UPDATE apartments SET name = ${name} WHERE id = ${id}`;
}

/**
 * Пристрої не видаляються разом із квартирою — вони просто лишаються
 * без прив'язки (ON DELETE SET NULL) і повертаються в «Без квартири».
 */
export async function deleteApartment(id: number): Promise<void> {
  await sql`DELETE FROM apartments WHERE id = ${id}`;
}

/** Прив'язати пристрій до квартири. null — прибрати прив'язку. */
export async function assignDevice(
  tuyaId: string,
  apartmentId: number | null,
): Promise<void> {
  await sql`
    UPDATE devices SET apartment_id = ${apartmentId} WHERE tuya_id = ${tuyaId}
  `;
}

export async function renameDevice(tuyaId: string, name: string): Promise<void> {
  await sql`UPDATE devices SET name = ${name} WHERE tuya_id = ${tuyaId}`;
}

export function listEnabledDevices(): Promise<DeviceRow[]> {
  return sql<DeviceRow[]>`
    SELECT tuya_id, apartment_id, name, category, kind, enabled, sort_order
    FROM devices
    WHERE enabled
    ORDER BY sort_order, name
  `;
}

/**
 * Синхронізація каталогу пристроїв із Tuya.
 *
 * Ім'я та прив'язку до квартири редагує користувач, тому при повторній
 * синхронізації вони НЕ перезаписуються — оновлюються лише технічні поля.
 */
export async function upsertDevices(
  devices: Array<{ id: string; name: string; category: string; kind: DeviceKind }>,
): Promise<void> {
  if (devices.length === 0) return;

  for (const d of devices) {
    await sql`
      INSERT INTO devices (tuya_id, name, category, kind, synced_at)
      VALUES (${d.id}, ${d.name}, ${d.category}, ${d.kind}, now())
      ON CONFLICT (tuya_id) DO UPDATE
        SET category  = EXCLUDED.category,
            kind      = EXCLUDED.kind,
            synced_at = now()
    `;
  }
}

export async function insertReadings(
  rows: Array<{ deviceId: string; key: string; value: number }>,
): Promise<void> {
  if (rows.length === 0) return;
  await sql`
    INSERT INTO readings ${sql(
      rows.map((r) => ({ device_id: r.deviceId, key: r.key, value: r.value })),
      'device_id',
      'key',
      'value',
    )}
  `;
}

export interface HistoryPoint {
  bucket: Date;
  avg: number;
  min: number;
  max: number;
}

/**
 * Агрегована історія. Сирі точки не віддаємо: за тиждень при поллінгу
 * раз на 5 хв їх ~2000 на показник, і графік у браузері від цього тільки
 * гірший.
 */
export function getHistory(opts: {
  deviceId: string;
  key: string;
  from: Date;
  to: Date;
  bucketMinutes: number;
}): Promise<HistoryPoint[]> {
  const interval = `${opts.bucketMinutes} minutes`;
  return sql<HistoryPoint[]>`
    SELECT
      to_timestamp(floor(extract(epoch FROM ts) / extract(epoch FROM ${interval}::interval))
        * extract(epoch FROM ${interval}::interval)) AS bucket,
      avg(value) AS avg,
      min(value) AS min,
      max(value) AS max
    FROM readings
    WHERE device_id = ${opts.deviceId}
      AND key = ${opts.key}
      AND ts >= ${opts.from}
      AND ts <= ${opts.to}
    GROUP BY bucket
    ORDER BY bucket
  `;
}

export interface EnergyBucket {
  apartment_id: number | null;
  bucket: Date;
  kwh: number;
}

/**
 * Споживання по квартирах.
 *
 * Рахується інтегруванням потужності, а не різницею лічильника `add_ele`:
 * Tuya-лічильники періодично скидаються, і різниця тоді дає від'ємні
 * значення або викиди. Потужність від цього не залежить.
 *
 * Проміжок між сусідніми замірами обмежений 15 хвилинами (3 інтервали
 * опитування). Без цього простій сервера на добу зарахувався б як доба
 * роботи приладу на останній відомій потужності.
 */
export function getEnergyByApartment(opts: {
  from: Date;
  to: Date;
  bucketHours: number;
}): Promise<EnergyBucket[]> {
  const bucket = `${opts.bucketHours} hours`;
  return sql<EnergyBucket[]>`
    WITH steps AS (
      SELECT
        d.apartment_id,
        r.ts,
        r.value AS watts,
        LEAST(
          EXTRACT(EPOCH FROM (r.ts - LAG(r.ts) OVER (PARTITION BY r.device_id ORDER BY r.ts))),
          900
        ) AS seconds
      FROM readings r
      JOIN devices d ON d.tuya_id = r.device_id
      WHERE r.key = 'power'
        AND r.ts >= ${opts.from}
        AND r.ts <= ${opts.to}
    )
    SELECT
      apartment_id,
      to_timestamp(floor(extract(epoch FROM ts) / extract(epoch FROM ${bucket}::interval))
        * extract(epoch FROM ${bucket}::interval)) AS bucket,
      COALESCE(sum(watts * seconds) / 3600.0 / 1000.0, 0) AS kwh
    FROM steps
    WHERE seconds IS NOT NULL
    GROUP BY apartment_id, bucket
    ORDER BY bucket
  `;
}

/** Прибирання старих сирих точок. Викликається поллером раз на добу. */
export function pruneReadings(olderThanDays: number): Promise<unknown> {
  return sql`
    DELETE FROM readings
    WHERE ts < now() - ${`${olderThanDays} days`}::interval
  `;
}

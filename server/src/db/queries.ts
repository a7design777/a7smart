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

/** Прибирання старих сирих точок. Викликається поллером раз на добу. */
export function pruneReadings(olderThanDays: number): Promise<unknown> {
  return sql`
    DELETE FROM readings
    WHERE ts < now() - ${`${olderThanDays} days`}::interval
  `;
}

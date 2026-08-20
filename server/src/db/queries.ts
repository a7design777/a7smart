import { sql } from './client.js';
import type { DeviceKind } from '../tuya/normalize.js';

export type Provider = 'tuya' | 'remihome';

export interface DeviceRow {
  external_id: string;
  provider: Provider;
  apartment_id: number | null;
  name: string;
  category: string;
  kind: string;
  enabled: boolean;
  sort_order: number;
  source_zone: string | null;
}

export interface ApartmentRow {
  id: number;
  slug: string;
  name: string;
  sort_order: number;
  is_main: boolean;
}

/**
 * Кеш квартир і пристроїв у пам'яті процесу.
 *
 * Фронтенд опитує /api/apartments і /api/devices раз на 15 с з кожної
 * відкритої вкладки — без кешу це стільки самих SQL-запитів до Neon
 * через інтернет, і постійний трафік не дає serverless-інстансу заснути.
 * Дані тут змінюються рідко (перейменування, перетягування, синхронізація),
 * тому кеш скидається явно при записі, а не за TTL.
 */
let apartmentsCache: ApartmentRow[] | null = null;
let devicesCache: DeviceRow[] | null = null;

function invalidateApartmentsCache(): void {
  apartmentsCache = null;
}

function invalidateDevicesCache(): void {
  devicesCache = null;
}

export async function listApartments(): Promise<ApartmentRow[]> {
  if (apartmentsCache) return apartmentsCache;
  apartmentsCache = await sql<ApartmentRow[]>`
    SELECT id, slug, name, sort_order, is_main
    FROM apartments
    ORDER BY is_main DESC, sort_order, name
  `;
  return apartmentsCache;
}

/**
 * Призначити головну квартиру. Знімається з попередньої в тій самій
 * транзакції: частковий унікальний індекс не дозволить двох головних,
 * і без цього другий UPDATE впав би.
 */
export async function setMainApartment(id: number): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`UPDATE apartments SET is_main = FALSE WHERE is_main`;
    await tx`UPDATE apartments SET is_main = TRUE WHERE id = ${id}`;
  });
  invalidateApartmentsCache();
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
    INSERT INTO apartments (slug, name, sort_order, is_main)
    VALUES (
      ${base} || '-' || (SELECT coalesce(max(id), 0) + 1 FROM apartments)::text,
      ${name},
      (SELECT coalesce(max(sort_order), 0) + 1 FROM apartments),
      -- Перша створена квартира одразу стає головною: інакше після
      -- створення однієї дашборд усе одно відкривався б на «Усі».
      (SELECT count(*) = 0 FROM apartments)
    )
    RETURNING id, slug, name, sort_order, is_main
  `;
  invalidateApartmentsCache();
  return rows[0]!;
}

export async function renameApartment(id: number, name: string): Promise<void> {
  await sql`UPDATE apartments SET name = ${name} WHERE id = ${id}`;
  invalidateApartmentsCache();
}

/**
 * Пристрої не видаляються разом із квартирою — вони просто лишаються
 * без прив'язки (ON DELETE SET NULL) і повертаються в «Без квартири».
 */
export async function deleteApartment(id: number): Promise<void> {
  await sql`DELETE FROM apartments WHERE id = ${id}`;
  invalidateApartmentsCache();
  // ON DELETE SET NULL повертає пристрої в «Без квартири».
  invalidateDevicesCache();
}

/** Прив'язати пристрій до квартири. null — прибрати прив'язку. */
export async function assignDevice(
  tuyaId: string,
  apartmentId: number | null,
): Promise<void> {
  await sql`
    UPDATE devices SET apartment_id = ${apartmentId} WHERE external_id = ${tuyaId}
  `;
  invalidateDevicesCache();
}

export async function renameDevice(tuyaId: string, name: string): Promise<void> {
  await sql`UPDATE devices SET name = ${name} WHERE external_id = ${tuyaId}`;
  invalidateDevicesCache();
}

/**
 * Порядок пристроїв на дашборді. Приймається повний список у потрібній
 * послідовності — так простіше й надійніше, ніж передавати зсуви:
 * при 54 пристроях різниця в обсязі неістотна.
 */
export async function setDeviceOrder(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await sql.begin(async (tx) => {
    for (const [index, id] of ids.entries()) {
      await tx`UPDATE devices SET sort_order = ${index} WHERE external_id = ${id}`;
    }
  });
  invalidateDevicesCache();
}

export async function listEnabledDevices(): Promise<DeviceRow[]> {
  if (devicesCache) return devicesCache;
  devicesCache = await sql<DeviceRow[]>`
    SELECT external_id, provider, apartment_id, name, category, kind,
           enabled, sort_order, source_zone
    FROM devices
    WHERE enabled
    ORDER BY sort_order, name
  `;
  return devicesCache;
}

/**
 * Синхронізація каталогу пристроїв із Tuya.
 *
 * Ім'я та прив'язку до квартири редагує користувач, тому при повторній
 * синхронізації вони НЕ перезаписуються — оновлюються лише технічні поля.
 */
export async function upsertDevices(
  devices: Array<{
    id: string;
    name: string;
    category: string;
    kind: DeviceKind;
    provider: Provider;
    sourceZone?: string | null;
  }>,
): Promise<void> {
  if (devices.length === 0) return;

  await sql`
    INSERT INTO devices ${sql(
      devices.map((d) => ({
        external_id: d.id,
        provider: d.provider,
        name: d.name,
        category: d.category,
        kind: d.kind,
        source_zone: d.sourceZone ?? null,
      })),
      'external_id',
      'provider',
      'name',
      'category',
      'kind',
      'source_zone',
    )}
    ON CONFLICT (external_id) DO UPDATE
      SET provider    = EXCLUDED.provider,
          category    = EXCLUDED.category,
          kind        = EXCLUDED.kind,
          source_zone = EXCLUDED.source_zone,
          synced_at   = now()
  `;
  invalidateDevicesCache();
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
      JOIN devices d ON d.external_id = r.device_id
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

// ── Сценарії ────────────────────────────────────────────────────────────────

export interface SceneAction {
  device_id: string;
  code: string;
  value: string;
  value_type: 'string' | 'boolean' | 'number';
  position: number;
}

export interface SceneRow {
  id: number;
  name: string;
  apartment_id: number | null;
  icon: string | null;
  sort_order: number;
  actions: SceneAction[];
}

/**
 * Сценарії разом із діями. Агрегація в SQL, а не окремим запитом на
 * кожен сценарій: їх одиниці, але N+1 запитів до Neon через інтернет
 * коштували б помітно дорожче за один JOIN.
 */
export function listScenes(): Promise<SceneRow[]> {
  return sql<SceneRow[]>`
    SELECT
      s.id, s.name, s.apartment_id, s.icon, s.sort_order,
      COALESCE(
        json_agg(
          json_build_object(
            'device_id', a.device_id,
            'code', a.code,
            'value', a.value,
            'value_type', a.value_type,
            'position', a.position
          ) ORDER BY a.position
        ) FILTER (WHERE a.id IS NOT NULL),
        '[]'
      ) AS actions
    FROM scenes s
    LEFT JOIN scene_actions a ON a.scene_id = s.id
    GROUP BY s.id
    ORDER BY s.sort_order, s.name
  `;
}

export async function createScene(opts: {
  name: string;
  apartmentId: number | null;
  actions: Array<Omit<SceneAction, 'position'>>;
}): Promise<number> {
  return sql.begin(async (tx) => {
    const rows = await tx<{ id: number }[]>`
      INSERT INTO scenes (name, apartment_id, sort_order)
      VALUES (
        ${opts.name},
        ${opts.apartmentId},
        (SELECT coalesce(max(sort_order), 0) + 1 FROM scenes)
      )
      RETURNING id
    `;
    const id = rows[0]!.id;

    for (const [position, action] of opts.actions.entries()) {
      await tx`
        INSERT INTO scene_actions (scene_id, device_id, code, value, value_type, position)
        VALUES (${id}, ${action.device_id}, ${action.code},
                ${action.value}, ${action.value_type}, ${position})
      `;
    }
    return id;
  });
}

/** Дії замінюються цілком: часткове редагування тут не потрібне. */
export async function updateScene(
  id: number,
  opts: { name: string; apartmentId: number | null; actions: Array<Omit<SceneAction, 'position'>> },
): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`
      UPDATE scenes SET name = ${opts.name}, apartment_id = ${opts.apartmentId}
      WHERE id = ${id}
    `;
    await tx`DELETE FROM scene_actions WHERE scene_id = ${id}`;
    for (const [position, action] of opts.actions.entries()) {
      await tx`
        INSERT INTO scene_actions (scene_id, device_id, code, value, value_type, position)
        VALUES (${id}, ${action.device_id}, ${action.code},
                ${action.value}, ${action.value_type}, ${position})
      `;
    }
  });
}

export async function deleteScene(id: number): Promise<void> {
  await sql`DELETE FROM scenes WHERE id = ${id}`;
}

/** Прибирання старих сирих точок. Викликається поллером раз на добу. */
export function pruneReadings(olderThanDays: number): Promise<unknown> {
  return sql`
    DELETE FROM readings
    WHERE ts < now() - ${`${olderThanDays} days`}::interval
  `;
}

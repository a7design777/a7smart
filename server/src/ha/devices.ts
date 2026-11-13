import { haGetStates, haTemplate, HaError, type HaState } from './client.js';

/**
 * Пристрій HA = один пристрій a7smart. REST API HA віддає лише сутності
 * (entities), а групування в пристрої знає тільки реєстр. Тому одним
 * запитом шаблону отримуємо пари «сутність → пристрій».
 */
export interface HaDevice {
  /** device_id з реєстру HA — стабільний між перезапусками. */
  id: string;
  name: string;
  manufacturer: string | null;
  /**
   * Id цього ж пристрою в Tuya Cloud, якщо HA підключив його через свою
   * інтеграцію Tuya. За ним знаходяться дублі з прямим Tuya-клієнтом.
   */
  tuyaId: string | null;
  entities: string[];
}

/**
 * Пристрої самого HA (Supervisor, Core, Host…) — службові: вони мають
 * звичайні сенсори, тож їх не відсіє фільтр за доменом. Тут — за виробником.
 */
const SERVICE_MANUFACTURERS = new Set(['home assistant']);

const TEMPLATE = `
{% set ns = namespace(r=[]) %}
{% for s in states %}
  {% set d = device_id(s.entity_id) %}
  {% if d %}
    {% set ns.r = ns.r + [{
      'e': s.entity_id,
      'd': d,
      'n': device_attr(d, 'name_by_user') or device_attr(d, 'name'),
      'm': device_attr(d, 'manufacturer'),
      'i': device_attr(d, 'identifiers') | list
    }] %}
  {% endif %}
{% endfor %}
{{ ns.r | tojson }}
`;

interface TemplateRow {
  e: string;
  d: string;
  n: string | null;
  m: string | null;
  /** Ідентифікатори реєстру HA: [["tuya", "<id у Tuya Cloud>"], …]. */
  i?: string[][];
}

/** Згрупувати рядки шаблону за пристроєм. Окремо — щоб було що тестувати. */
export function groupDevices(rows: TemplateRow[]): HaDevice[] {
  const byId = new Map<string, HaDevice>();
  for (const row of rows) {
    let device = byId.get(row.d);
    if (!device) {
      device = {
        id: row.d,
        name: row.n?.trim() || row.d,
        manufacturer: row.m,
        // Канали багатоклавішних вимикачів у HA мають id `<id>_channel_N` —
        // у Tuya Cloud це один пристрій, а в a7smart — його клавіші (gangs).
        tuyaId: row.i?.find((p) => p[0] === 'tuya')?.[1]?.replace(/_channel_\d+$/, '') ?? null,
        entities: [],
      };
      byId.set(row.d, device);
    }
    device.entities.push(row.e);
  }
  return [...byId.values()].filter(
    (d) => !SERVICE_MANUFACTURERS.has((d.manufacturer ?? '').toLowerCase()),
  );
}

/**
 * Домени, які варто показувати на дашборді. Решта — медіаплеєри, погода,
 * TTS, оновлення, сцени — шум для керування домом.
 */
const RELEVANT_DOMAINS = new Set([
  'sensor',
  'binary_sensor',
  'switch',
  'light',
  'climate',
  'cover',
  'lock',
  'fan',
  'camera',
  'humidifier',
  'water_heater',
]);

/** Сенсори з такими класами — це час/дата, а не показники (напр. Sun). */
const NON_MEASUREMENT_CLASSES = new Set(['timestamp', 'date', 'enum']);

function isRelevantEntity(entityId: string, state: HaState | undefined): boolean {
  const domain = entityId.slice(0, entityId.indexOf('.'));
  if (!RELEVANT_DOMAINS.has(domain)) return false;
  if (domain === 'sensor' && state) {
    return !NON_MEASUREMENT_CLASSES.has(String(state.attributes.device_class ?? ''));
  }
  return true;
}

/**
 * Лишає пристрої, у яких є хоч одна «змістовна» сутність. Так відсіюються
 * Sun (лише часові сенсори), Matter Server (лише update), Google Translate
 * (tts), Met.no (weather), телевізори (media_player) — без прив'язки до
 * виробника, який у таких пристроїв буває будь-яким або порожнім.
 */
export function keepRelevant(
  devices: HaDevice[],
  states: Map<string, HaState>,
): HaDevice[] {
  return devices
    .map((d) => ({
      ...d,
      entities: d.entities.filter((e) => isRelevantEntity(e, states.get(e))),
    }))
    .filter((d) => d.entities.length > 0);
}

/**
 * Прибирає пристрої, які a7smart уже бачить напряму через Tuya Cloud.
 * Прямий клієнт лишається основним, бо HA поки лише читає, а Tuya вміє
 * керувати (вимикачі, термостати, камери з PTZ). Коли керування через HA
 * з'явиться, пріоритет можна перевернути.
 */
export function dropTuyaDuplicates(
  devices: HaDevice[],
  directTuyaIds: ReadonlySet<string>,
): HaDevice[] {
  return devices.filter((d) => !(d.tuyaId && directTuyaIds.has(d.tuyaId)));
}

export async function listHaDevices(states: Map<string, HaState>): Promise<HaDevice[]> {
  const text = await haTemplate(TEMPLATE);
  let rows: TemplateRow[];
  try {
    rows = JSON.parse(text) as TemplateRow[];
  } catch {
    throw new HaError(`Шаблон пристроїв повернув не JSON: ${text.slice(0, 80)}…`);
  }
  return keepRelevant(groupDevices(rows), states);
}

export async function getHaStates(): Promise<Map<string, HaState>> {
  return new Map((await haGetStates()).map((s) => [s.entity_id, s]));
}

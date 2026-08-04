import type { TuyaStatusItem, TuyaDevice } from './devices.js';

/**
 * Переклад сирих Tuya-datapoint-ів у доменну модель дашборда.
 *
 * Це єдине місце, яке знає про вендорські коди. Коли додається новий
 * пристрій і на дашборді бракує показника — правити треба тут, а не в UI.
 *
 * Стартовий набір нижче покриває найпоширеніші коди. Реальні коди ваших
 * пристроїв друкує `npm run tuya:probe` — звірте й доповніть.
 */

export type DeviceKind = 'switch' | 'light' | 'climate' | 'sensor' | 'camera' | 'unknown';

export interface Metric {
  code: string;
  /** Ключ доменної моделі: temperature, humidity, power, energy, battery… */
  key: string;
  value: number;
  unit: string;
}

export interface NormalizedDevice {
  id: string;
  name: string;
  kind: DeviceKind;
  online: boolean;
  /** Головний вимикач, якщо пристрій вміє вмикатися. */
  power: { code: string; on: boolean } | null;
  /** Цільова температура для клімату. */
  target: { code: string; value: number; min: number; max: number } | null;
  metrics: Metric[];
}

/** Категорія Tuya → тип пристрою в UI. */
const KIND_BY_CATEGORY: Record<string, DeviceKind> = {
  cz: 'switch', // розетка
  pc: 'switch', // подовжувач
  kg: 'switch', // вимикач
  tdq: 'switch', // реле
  dj: 'light', // лампа
  dd: 'light', // стрічка
  dc: 'light', // гірлянда
  fwd: 'light', // світильник
  wk: 'climate', // термостат
  rs: 'climate', // водонагрівач
  kt: 'climate', // кондиціонер
  wsdcg: 'sensor', // датчик температури/вологості
  ldcg: 'sensor', // датчик освітленості
  sp: 'camera', // камера
  dghsxj: 'camera', // камера (альт. категорія)
};

/**
 * Коди вимикача живлення, у порядку пріоритету.
 * `switch_1` — типово перша клавіша; `switch_led` — лампи.
 */
const POWER_CODES = ['switch', 'switch_1', 'switch_led', 'power_switch'];

/** Коди цільової температури. */
const TARGET_TEMP_CODES = ['temp_set', 'temp_set_f', 'upper_temp', 'set_temperature'];

/**
 * Числові показники. `scale` — дільник: Tuya віддає цілі числа,
 * 235 при scale 10 означає 23.5 °C.
 */
const METRICS: Record<string, { key: string; unit: string; scale: number }> = {
  va_temperature: { key: 'temperature', unit: '°C', scale: 10 },
  temp_current: { key: 'temperature', unit: '°C', scale: 10 },
  temp_indoor: { key: 'temperature', unit: '°C', scale: 10 },
  va_humidity: { key: 'humidity', unit: '%', scale: 1 },
  humidity_value: { key: 'humidity', unit: '%', scale: 1 },
  cur_power: { key: 'power', unit: 'Вт', scale: 10 },
  cur_voltage: { key: 'voltage', unit: 'В', scale: 10 },
  cur_current: { key: 'current', unit: 'мА', scale: 1 },
  add_ele: { key: 'energy', unit: 'кВт·год', scale: 100 },
  battery_percentage: { key: 'battery', unit: '%', scale: 1 },
  bright_value: { key: 'brightness', unit: '', scale: 1 },
  bright_value_v2: { key: 'brightness', unit: '', scale: 10 },
};

function findCode(
  status: TuyaStatusItem[],
  candidates: readonly string[],
): TuyaStatusItem | undefined {
  for (const code of candidates) {
    const hit = status.find((s) => s.code === code);
    if (hit) return hit;
  }
  return undefined;
}

export function normalize(device: TuyaDevice, status: TuyaStatusItem[]): NormalizedDevice {
  const powerItem = findCode(status, POWER_CODES);
  const targetItem = findCode(status, TARGET_TEMP_CODES);

  const metrics: Metric[] = [];
  for (const item of status) {
    const spec = METRICS[item.code];
    if (!spec || typeof item.value !== 'number') continue;
    metrics.push({
      code: item.code,
      key: spec.key,
      value: item.value / spec.scale,
      unit: spec.unit,
    });
  }

  return {
    id: device.id,
    name: device.name,
    kind: KIND_BY_CATEGORY[device.category] ?? 'unknown',
    online: device.online,
    power: powerItem ? { code: powerItem.code, on: Boolean(powerItem.value) } : null,
    target:
      targetItem && typeof targetItem.value === 'number'
        ? { code: targetItem.code, value: targetItem.value / 10, min: 5, max: 35 }
        : null,
    metrics,
  };
}

/** Показники, які має сенс зберігати в історію. Решта — шум. */
export const HISTORICAL_KEYS = new Set([
  'temperature',
  'humidity',
  'power',
  'energy',
  'battery',
]);

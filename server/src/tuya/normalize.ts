import type { TuyaStatusItem, TuyaDevice } from './devices.js';

/**
 * Переклад сирих Tuya-datapoint-ів у доменну модель дашборда.
 *
 * Це єдине місце, яке знає про вендорські коди. Коли додається новий
 * пристрій і на дашборді бракує показника — правити треба тут, а не в UI.
 *
 * Набір нижче звірений із реальним акаунтом (47 пристроїв, `npm run tuya:probe`),
 * а не взятий з документації: масштаби й коди відрізняються від типових.
 */

export type DeviceKind = 'switch' | 'light' | 'climate' | 'sensor' | 'camera' | 'unknown';

export interface Metric {
  code: string;
  /** Ключ доменної моделі: temperature, humidity, power, energy, battery… */
  key: string;
  value: number;
  unit: string;
}

/** Стан-перелік: відкрито/закрито, протікання, рух. Не число. */
export interface StateFlag {
  code: string;
  key: string;
  /** Готовий до показу текст українською. */
  label: string;
  /** true — потрібна увага користувача (протікання, газ, розбито). */
  alarm: boolean;
}

/**
 * Один канал керування живленням.
 *
 * `onValue`/`offValue` потрібні тому, що вендори очікують різне: Tuya
 * приймає булеве `true`/`false`, Remihome — рядки `"on"`/`"off"`.
 * Без цього UI надсилав би `"true"`, і прилад мовчки ігнорував би команду.
 */
export interface Gang {
  code: string;
  label: string;
  on: boolean;
  onValue: boolean | string;
  offValue: boolean | string;
}

/**
 * Керування з переліком варіантів — швидкість фанкойла, режим термостата.
 * У Tuya таких поки немає, у Remihome вони описані в метаданих пристрою.
 */
export interface OptionControl {
  code: string;
  label: string;
  value: string;
  choices: Array<{ value: string; label: string }>;
}

export interface NormalizedDevice {
  id: string;
  name: string;
  kind: DeviceKind;
  online: boolean;
  /** Канали керування. Для однокнопкових — один елемент. */
  gangs: Gang[];
  /** Цільова температура для клімату. */
  target: { code: string; value: number; min: number; max: number } | null;
  metrics: Metric[];
  states: StateFlag[];
  /** Перемикачі з переліком варіантів. Порожньо для більшості пристроїв. */
  options: OptionControl[];
}

/** Категорія Tuya → тип пристрою в UI. Звірено з реальним акаунтом. */
const KIND_BY_CATEGORY: Record<string, DeviceKind> = {
  cz: 'switch', // розетка
  pc: 'switch', // подовжувач
  kg: 'switch', // вимикач (1- та 2-клавішні)
  tdq: 'switch', // реле
  dj: 'light', // лампа
  dd: 'light', // стрічка
  dc: 'light', // гірлянда
  fwd: 'light', // світильник
  wk: 'climate', // термостат
  rs: 'climate', // водонагрівач
  kt: 'climate', // кондиціонер
  wsdcg: 'sensor', // датчик температури/вологості
  qxj: 'sensor', // метеостанція
  mcs: 'sensor', // датчик відкриття
  pir: 'sensor', // датчик руху
  sj: 'sensor', // датчик протікання
  rqbj: 'sensor', // датчик газу
  zd: 'sensor', // датчик вібрації
  ldcg: 'sensor', // датчик освітленості
  sp: 'camera', // камера
  dghsxj: 'camera', // камера (альт. категорія)
};

/** Підписи каналів багатоклавішних вимикачів. */
const GANG_LABELS: Record<string, string> = {
  switch: 'Живлення',
  switch_1: '1',
  switch_2: '2',
  switch_3: '3',
  switch_4: '4',
  switch_led: 'Світло',
};

const GANG_CODES = Object.keys(GANG_LABELS);

/**
 * Цільова температура.
 *
 * ВАЖЛИВО: у термостатах цього акаунта `temp_set` не масштабований —
 * 26 означає 26 °C, а не 2.6 °C. Ділення на 10 тут було б помилкою.
 */
const TARGET_TEMP_CODES = ['temp_set', 'set_temperature'];

/**
 * Числові показники. `scale` — дільник: Tuya віддає цілі числа,
 * 2343 при scale 10 означає 234.3 В.
 */
const METRICS: Record<string, { key: string; unit: string; scale: number }> = {
  va_temperature: { key: 'temperature', unit: '°C', scale: 10 },
  temp_current: { key: 'temperature', unit: '°C', scale: 10 },
  va_humidity: { key: 'humidity', unit: '%', scale: 1 },
  humidity_value: { key: 'humidity', unit: '%', scale: 1 },
  cur_power: { key: 'power', unit: 'Вт', scale: 10 },
  cur_voltage: { key: 'voltage', unit: 'В', scale: 10 },
  cur_current: { key: 'current', unit: 'мА', scale: 1 },
  add_ele: { key: 'energy', unit: 'кВт·год', scale: 100 },
  battery_percentage: { key: 'battery', unit: '%', scale: 1 },
  gas_sensor_value: { key: 'gas', unit: '', scale: 1 },
  bright_value: { key: 'brightness', unit: '', scale: 1 },
};

/**
 * Стани-переліки. `alarm` перелічує значення, які вимагають уваги.
 * Датчики протікання та газу — питання безпеки, тому вони підсвічуються
 * окремо, а не ховаються серед решти показників.
 */
const STATES: Record<
  string,
  { key: string; labels: Record<string, string>; alarm: string[] }
> = {
  doorcontact_state: {
    key: 'contact',
    labels: { true: 'Відчинено', false: 'Зачинено' },
    alarm: ['true'],
  },
  watersensor_state: {
    key: 'leak',
    labels: { normal: 'Сухо', alarm: 'ПРОТІКАННЯ' },
    alarm: ['alarm'],
  },
  gas_sensor_state: {
    // Tuya віддає "1" як тривогу, "2" як норму.
    key: 'gas',
    labels: { '1': 'ВИТІК ГАЗУ', '2': 'Норма' },
    alarm: ['1'],
  },
  pir: {
    key: 'motion',
    labels: { pir: 'Рух', none: 'Спокійно' },
    alarm: [],
  },
  shock_state: {
    key: 'shock',
    labels: { normal: 'Спокійно', vibration: 'Вібрація', drop: 'Падіння', tilt: 'Нахил' },
    alarm: ['vibration', 'drop'],
  },
  battery_state: {
    key: 'battery_state',
    labels: { high: 'Батарея добре', middle: 'Батарея середня', low: 'БАТАРЕЯ СІДАЄ' },
    alarm: ['low'],
  },
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
  const gangs: Gang[] = [];
  const metrics: Metric[] = [];
  const states: StateFlag[] = [];

  for (const item of status) {
    // Канали керування
    if (GANG_CODES.includes(item.code) && typeof item.value === 'boolean') {
      gangs.push({
        code: item.code,
        label: GANG_LABELS[item.code] ?? item.code,
        on: item.value,
        onValue: true,
        offValue: false,
      });
      continue;
    }

    // Числові показники
    const metricSpec = METRICS[item.code];
    if (metricSpec && typeof item.value === 'number') {
      metrics.push({
        code: item.code,
        key: metricSpec.key,
        value: item.value / metricSpec.scale,
        unit: metricSpec.unit,
      });
      continue;
    }

    // Стани-переліки
    const stateSpec = STATES[item.code];
    if (stateSpec) {
      const raw = String(item.value);
      states.push({
        code: item.code,
        key: stateSpec.key,
        label: stateSpec.labels[raw] ?? raw,
        alarm: stateSpec.alarm.includes(raw),
      });
    }
  }

  const targetItem = findCode(status, TARGET_TEMP_CODES);

  return {
    id: device.id,
    name: device.name,
    kind: KIND_BY_CATEGORY[device.category] ?? 'unknown',
    online: device.online,
    // Єдиний канал підписувати номером немає сенсу.
    gangs: gangs.length === 1 ? [{ ...gangs[0]!, label: 'Живлення' }] : gangs,
    target:
      targetItem && typeof targetItem.value === 'number'
        ? { code: targetItem.code, value: targetItem.value, min: 5, max: 60 }
        : null,
    metrics,
    states,
    options: [],
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

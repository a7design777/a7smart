import type { NormalizedDevice, Metric, StateFlag } from '../tuya/normalize.js';
import type { HaState } from './client.js';
import type { HaDevice } from './devices.js';

/**
 * Нормалізація Home Assistant → доменна модель.
 *
 * Поки що HA — джерело ЛИШЕ для читання: числові сенсори стають
 * показниками, решта сутностей (binary_sensor, switch, light, climate…) —
 * текстовими станами. Керованих елементів (gangs/options/target) немає,
 * тому тип завжди `sensor`: пустий перемикач у UI був би оманливим.
 */

const OBJECT_ID = (entityId: string) => entityId.slice(entityId.indexOf('.') + 1);

/** device_class HA → ключ доменної моделі (див. HISTORICAL_KEYS). */
const KEY_BY_CLASS: Record<string, string> = {
  temperature: 'temperature',
  humidity: 'humidity',
  battery: 'battery',
  power: 'power',
  energy: 'energy',
  voltage: 'voltage',
  current: 'current',
  gas: 'gas',
};

/** binary_sensor, де `on` означає тривогу. */
const ALARM_CLASSES = new Set([
  'moisture',
  'smoke',
  'gas',
  'carbon_monoxide',
  'safety',
  'tamper',
  'problem',
]);

const STATE_LABELS: Record<string, string> = {
  on: 'Увімкнено',
  off: 'Вимкнено',
  open: 'Відкрито',
  closed: 'Закрито',
  home: 'Вдома',
  not_home: 'Не вдома',
  charging: 'Заряджається',
  discharging: 'Розряджається',
  idle: 'Очікує',
};

const UNAVAILABLE = new Set(['unavailable', 'unknown']);

/**
 * Підписи binary_sensor за device_class: «Двері: Увімкнено» нічого не
 * каже, а «Двері: Відкрито» — так. [назва, текст для on, текст для off].
 */
const BINARY_LABELS: Record<string, [string, string, string]> = {
  door: ['Двері', 'Відкрито', 'Закрито'],
  window: ['Вікно', 'Відкрито', 'Закрито'],
  garage_door: ['Гараж', 'Відкрито', 'Закрито'],
  opening: ['Отвір', 'Відкрито', 'Закрито'],
  motion: ['Рух', 'Виявлено', 'Немає'],
  occupancy: ['Присутність', 'Виявлено', 'Немає'],
  presence: ['Присутність', 'Виявлено', 'Немає'],
  moisture: ['Протікання', 'Вологість!', 'Сухо'],
  smoke: ['Дим', 'Виявлено!', 'Немає'],
  gas: ['Газ', 'Виявлено!', 'Немає'],
  carbon_monoxide: ['Чадний газ', 'Виявлено!', 'Немає'],
  vibration: ['Вібрація', 'Є', 'Немає'],
  battery: ['Батарея', 'Розряджена', 'Норма'],
  tamper: ['Саботаж', 'Виявлено!', 'Немає'],
  problem: ['Проблема', 'Є', 'Немає'],
  connectivity: ['Зв’язок', 'Є', 'Немає'],
  power: ['Живлення', 'Є', 'Немає'],
};

/** friendly_name у HA починається з імені пристрою — другий раз воно зайве. */
function flagLabel(
  device: HaDevice,
  state: HaState,
  domain: string,
  deviceClass: string,
): string {
  const binary = domain === 'binary_sensor' ? BINARY_LABELS[deviceClass] : undefined;
  if (binary && (state.state === 'on' || state.state === 'off')) {
    return `${binary[0]}: ${state.state === 'on' ? binary[1] : binary[2]}`;
  }

  const full = friendlyName(state);
  const name = full.startsWith(device.name) ? full.slice(device.name.length).trim() : full;
  return `${name || full}: ${STATE_LABELS[state.state] ?? state.state}`;
}

function friendlyName(state: HaState): string {
  const name = state.attributes.friendly_name;
  return typeof name === 'string' && name ? name : OBJECT_ID(state.entity_id);
}

export function normalizeHa(
  device: HaDevice,
  states: Map<string, HaState>,
): NormalizedDevice {
  const metrics: Metric[] = [];
  const flags: StateFlag[] = [];
  const usedKeys = new Set<string>();
  let seen = 0;
  let unavailable = 0;

  for (const entityId of device.entities) {
    const state = states.get(entityId);
    if (!state) continue;
    seen++;

    if (UNAVAILABLE.has(state.state)) {
      unavailable++;
      continue;
    }

    const domain = entityId.slice(0, entityId.indexOf('.'));
    const deviceClass = String(state.attributes.device_class ?? '');
    const numeric = Number(state.state);

    if (domain === 'sensor' && state.state.trim() !== '' && Number.isFinite(numeric)) {
      // Два сенсори одного класу на пристрої (напр. дві температури) не
      // мають ділити ключ: історія пишеться за парою (пристрій, ключ).
      const preferred = KEY_BY_CLASS[deviceClass] ?? OBJECT_ID(entityId);
      const key = usedKeys.has(preferred) ? OBJECT_ID(entityId) : preferred;
      usedKeys.add(key);

      const unit = state.attributes.unit_of_measurement;
      metrics.push({
        code: entityId,
        key,
        value: numeric,
        unit: typeof unit === 'string' ? unit : '',
      });
      continue;
    }

    flags.push({
      code: entityId,
      key: OBJECT_ID(entityId),
      label: flagLabel(device, state, domain, deviceClass),
      alarm: domain === 'binary_sensor' && ALARM_CLASSES.has(deviceClass) && state.state === 'on',
    });
  }

  return {
    id: device.id,
    name: device.name,
    kind: 'sensor',
    // Пристрій «не в мережі», лише якщо недоступні всі його сутності.
    online: seen > 0 && unavailable < seen,
    gangs: [],
    target: null,
    metrics,
    states: flags,
    options: [],
    ptz: false,
  };
}

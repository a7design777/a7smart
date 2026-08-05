import type {
  NormalizedDevice,
  Metric,
  StateFlag,
  DeviceKind,
  Gang,
  OptionControl,
} from '../tuya/normalize.js';
import type { RemihomeDevice, RemihomeProperty } from './devices.js';

/**
 * Нормалізація Remihome.
 *
 * На відміну від Tuya, тут не потрібен ручний список кодів: пристрій сам
 * описує свої властивості в `type.properties` — з форматом (`celsius`,
 * `perc`), режимом (`display` — лише читання, `exec` — керована) і
 * переліком станів. Тому мапінг будується з метаданих, і новий прилад
 * підхоплюється без правок коду.
 *
 * Значення приходять рядками, але вже в реальних одиницях: "24.67" — це
 * 24.67 °C. Ділити на 10, як у Tuya, тут не треба.
 */

/** Властивість → ключ доменної моделі. Решта лишається під власним ім'ям. */
const METRIC_KEYS: Record<string, string> = {
  temperature: 'temperature',
  temperature_floor: 'temperature_floor',
  humidity: 'humidity',
  battery: 'battery',
  setpoint: 'setpoint',
};

const UNIT_BY_FORMAT: Record<string, string> = {
  celsius: '°C',
  perc: '%',
};

/** Переклад станів. Невідомі значення показуються як є. */
const STATE_LABELS: Record<string, string> = {
  auto: 'Авто',
  manual: 'Ручний',
  on: 'Увімкнено',
  off: 'Вимкнено',
  none: 'Немає',
  summer: 'Літо',
  winter: 'Зима',
  online: 'У мережі',
  offline: 'Не в мережі',
  int_zona: 'Перерв. зоною',
  int_zona_humidity: 'Перерв. вологістю',
  true: 'Так',
  false: 'Ні',
  '0': 'Вимкнено',
  '1': 'Низька',
  '2': 'Середня',
  '3': 'Висока',
};

const PROPERTY_LABELS: Record<string, string> = {
  mode: 'Режим',
  state: 'Стан',
  running_state: 'Робота',
  output: 'Вихід',
  speed: 'Швидкість',
  climatisation_mode: 'Сезон',
  interruption_cause: 'Причина зупинки',
  interrupter: 'Переривач',
};

/**
 * Властивості, які не варто показувати: службові або дубльовані.
 * `availability` стає прапорцем online, а не окремим рядком.
 */
const HIDDEN_PROPERTIES = new Set(['availability', 'screen', 'interrupter']);

/**
 * Що дозволено змінювати.
 *
 * Метадані позначають `interaction: exec` навіть для суто діагностичних
 * властивостей — `running_state` (поточна робота) та `interruption_cause`
 * (причина зупинки). Робити з них органи керування на системі опалення
 * не можна: користувач натисне «Робота: on», а прилад це проігнорує або,
 * гірше, сприйме буквально. Тому список явний.
 */
const CONTROLLABLE = new Set(['mode', 'speed', 'state', 'setpoint']);

function kindFor(device: RemihomeDevice): DeviceKind {
  const categories = (device.type?.category ?? []).map((c) => String(c).toLowerCase());
  if (categories.some((c) => ['thermostat', 'hvac', 'fancoil'].includes(c))) {
    return 'climate';
  }
  if (categories.includes('sensor')) return 'sensor';
  return 'unknown';
}

export function normalizeRemihome(
  device: RemihomeDevice,
  status: RemihomeProperty[],
): NormalizedDevice {
  // Опис властивостей із каталогу: за ним визначаємо формат і тип.
  const spec = new Map(
    (device.type?.properties ?? []).map((p) => [String(p.name), p]),
  );

  const metrics: Metric[] = [];
  const states: StateFlag[] = [];
  const gangs: Gang[] = [];
  const options: OptionControl[] = [];
  let online = true;
  let target: NormalizedDevice['target'] = null;

  for (const prop of status) {
    if (prop.name === 'availability') {
      online = prop.value === 'online';
      continue;
    }
    if (HIDDEN_PROPERTIES.has(prop.name)) continue;

    const meta = spec.get(prop.name);
    const format = meta ? String(meta.format ?? '') : '';
    const numeric = Number(prop.value);
    const isNumeric = format in UNIT_BY_FORMAT && Number.isFinite(numeric);

    // Керована = позначена exec У метаданих І дозволена явним списком.
    const editable = meta?.interaction === 'exec' && CONTROLLABLE.has(prop.name);
    const choices = Array.isArray(meta?.states)
      ? (meta.states as Array<{ name?: string; value?: string }>)
      : [];

    if (isNumeric) {
      // Цільова температура — окреме поле моделі, а не звичайний показник.
      if (prop.name === 'setpoint') {
        target = { code: 'setpoint', value: numeric, min: 10, max: 30 };
        continue;
      }
      metrics.push({
        code: prop.name,
        key: METRIC_KEYS[prop.name] ?? prop.name,
        value: numeric,
        unit: UNIT_BY_FORMAT[format] ?? '',
      });
      continue;
    }

    // Керований вимикач on/off стає звичайним перемикачем.
    if (
      editable &&
      prop.name === 'state' &&
      choices.length === 2 &&
      choices.every((c) => c.value === 'on' || c.value === 'off')
    ) {
      gangs.push({ code: prop.name, label: 'Живлення', on: prop.value === 'on' });
      continue;
    }

    // Решта керованих переліків — швидкість, режим.
    if (editable && choices.length > 1) {
      options.push({
        code: prop.name,
        label: PROPERTY_LABELS[prop.name] ?? prop.name,
        value: prop.value,
        choices: choices
          .filter((c): c is { value: string } => typeof c.value === 'string')
          .map((c) => ({ value: c.value, label: STATE_LABELS[c.value] ?? c.value })),
      });
      continue;
    }

    const label = STATE_LABELS[prop.value] ?? prop.value;
    states.push({
      code: prop.name,
      key: prop.name,
      label: `${PROPERTY_LABELS[prop.name] ?? prop.name}: ${label}`,
      alarm: false,
    });
  }

  return {
    id: device.code,
    name: device.name.trim(),
    kind: kindFor(device),
    online,
    gangs,
    target,
    metrics,
    states,
    options,
  };
}

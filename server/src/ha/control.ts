import type { HaServiceCall, HaState } from './client.js';
import type { HaDevice } from './devices.js';

/**
 * Перетворює команду Tuya на виклик сервісу HA — лише там, де відповідність
 * однозначна. Якщо хоч щось неоднозначне (кілька керованих сутностей у
 * пристрої, невідомий код, неочікуване значення), повертає null, і команда
 * йде в Tuya напряму, як і раніше. Тому помилка тут не може вмикнути «не
 * той» канал чи пристрій.
 */

const CONTROL_DOMAINS = ['switch', 'light', 'climate'] as const;

/** Коди живлення в Tuya: switch, switch_1…, switch_led. */
const POWER_CODE = /^switch(_\d+|_led)?$/;

const domainOf = (entityId: string) => entityId.slice(0, entityId.indexOf('.'));

export function planHaCommand(
  tuyaId: string,
  code: string,
  value: string | number | boolean,
  haDevices: readonly HaDevice[],
  states: ReadonlyMap<string, HaState>,
): HaServiceCall | null {
  const device = haDevices.find((d) => d.tuyaId === tuyaId);
  if (!device) return null;

  // Недоступну сутність HA не змусить виконати команду — пускаємо через Tuya.
  const controllable = device.entities.filter((e) =>
    (CONTROL_DOMAINS as readonly string[]).includes(domainOf(e)),
  );
  // Рівно одна керована сутність: інакше невідомо, який канал мається на увазі.
  if (controllable.length !== 1) return null;

  const entityId = controllable[0]!;
  const state = states.get(entityId);
  if (!state || state.state === 'unavailable') return null;
  const domain = domainOf(entityId);

  if (POWER_CODE.test(code) && typeof value === 'boolean') {
    return { domain, service: value ? 'turn_on' : 'turn_off', entityId };
  }

  if (domain === 'climate' && code === 'temp_set' && typeof value === 'number') {
    return { domain, service: 'set_temperature', entityId, temperature: value };
  }

  return null;
}

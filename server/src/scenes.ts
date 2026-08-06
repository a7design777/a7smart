import { sendCommands } from './tuya/devices.js';
import { setRemihomeProperty } from './remihome/devices.js';
import { getProvider, refreshDevice } from './poller.js';
import type { SceneAction } from './db/queries.js';

export interface ActionResult {
  deviceId: string;
  code: string;
  ok: boolean;
  error?: string;
}

/** Відновлює з рядка ту форму значення, яку очікує вендор. */
function decode(action: SceneAction): string | number | boolean {
  switch (action.value_type) {
    case 'boolean':
      return action.value === 'true';
    case 'number':
      return Number(action.value);
    default:
      return action.value;
  }
}

/**
 * Виконати сценарій.
 *
 * Дії йдуть послідовно, а не паралельно: команди в одну хмару пачкою
 * упираються в обмеження частоти, а порядок у сценарії часто має сенс
 * (спершу увімкнути прилад, потім задати режим).
 *
 * Відмова однієї дії не зупиняє решту — краще виконати чотири кроки
 * з п'яти й сказати, який саме не пройшов, ніж скасувати все.
 */
export async function runScene(actions: SceneAction[]): Promise<ActionResult[]> {
  const results: ActionResult[] = [];
  const touched = new Set<string>();

  for (const action of actions) {
    const value = decode(action);
    try {
      if (getProvider(action.device_id) === 'remihome') {
        await setRemihomeProperty(action.device_id, action.code, String(value));
      } else {
        await sendCommands(action.device_id, [{ code: action.code, value }]);
      }
      touched.add(action.device_id);
      results.push({ deviceId: action.device_id, code: action.code, ok: true });
    } catch (err) {
      results.push({
        deviceId: action.device_id,
        code: action.code,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Оновлюємо кеш станів торкнутих пристроїв, інакше дашборд ще кілька
  // хвилин показував би, що нічого не змінилося.
  await new Promise((r) => setTimeout(r, 900));
  await Promise.allSettled([...touched].map((id) => refreshDevice(id)));

  return results;
}

import { tuyaRequest } from './client.js';
import { sendCommands } from './devices.js';
import type { Gang, OptionControl } from './normalize.js';

/**
 * Налаштування камер Tuya (рух, нічне бачення, сирена, запис…).
 *
 * Частина камер (категорія cdsxj) не віддає датапойнти через звичайний
 * `/status` («function not support»), але має їх у моделі речі: читаємо
 * `/v2.0/cloud/thing/{id}/shadow/properties`, а пишемо через `.../issue`.
 * Керується лише явний список нижче: форматування SD-картки, перезапуск,
 * ONVIF і калібрування навмисно не винесені — це не кнопки «в один дотик».
 *
 * Значення змінюються рідко, а квота Tuya скінченна, тому читання
 * кешується на 30 хв (і скидається після команди).
 */

const TOGGLES: Array<[code: string, label: string]> = [
  ['motion_switch', 'Датчик руху'],
  ['motion_tracking', 'Стеження за рухом'],
  ['humanoid_filter', 'Лише людина'],
  ['decibel_switch', 'Датчик звуку'],
  ['record_switch', 'Запис'],
  ['basic_private', 'Приватний режим'],
  ['siren_switch', 'Сирена'],
  ['ipc_auto_siren', 'Авто-сирена'],
  ['floodlight_switch', 'Прожектор'],
  ['basic_indicator', 'Індикатор'],
  ['basic_osd', 'Час на відео'],
  ['basic_flip', 'Перевернути кадр'],
];

const OPTIONS: Array<[code: string, label: string, names: Record<string, string>]> = [
  ['motion_sensitivity', 'Чутливість руху', { '0': 'Низька', '1': 'Середня', '2': 'Висока' }],
  [
    'nightvision_mode',
    'Нічне бачення',
    { auto: 'Авто', ir_mode: 'Інфрачервоне', color_mode: 'Кольорове' },
  ],
  ['record_mode', 'Режим запису', { '1': 'За подією', '2': 'Постійно' }],
];

const CONTROLLABLE = new Set([...TOGGLES.map((t) => t[0]), ...OPTIONS.map((o) => o[0])]);

export const isCameraControl = (code: string): boolean => CONTROLLABLE.has(code);

interface Property {
  code: string;
  value: unknown;
}

const TTL_MS = 30 * 60 * 1000;
const cache = new Map<string, { at: number; props: Map<string, unknown> }>();

export async function getCameraProperties(
  deviceId: string,
  force = false,
): Promise<Map<string, unknown>> {
  const hit = cache.get(deviceId);
  if (!force && hit && Date.now() - hit.at < TTL_MS) return hit.props;
  try {
    const res = await tuyaRequest<{ properties?: Property[] }>({
      path: `/v2.0/cloud/thing/${deviceId}/shadow/properties`,
      method: 'GET',
    });
    const props = new Map((res.properties ?? []).map((p) => [p.code, p.value]));
    cache.set(deviceId, { at: Date.now(), props });
    return props;
  } catch (err) {
    console.warn('[tuya] налаштування камери не прочитано:', err instanceof Error ? err.message : err);
    return hit?.props ?? new Map();
  }
}

/** Перемикачі й переліки для картки камери — лише те, що камера справді має. */
export function buildCameraControls(props: Map<string, unknown>): {
  controls: Gang[];
  options: OptionControl[];
} {
  const controls: Gang[] = TOGGLES.filter(([code]) => typeof props.get(code) === 'boolean').map(
    ([code, label]) => ({
      code,
      label,
      on: props.get(code) === true,
      onValue: true,
      offValue: false,
    }),
  );

  const options: OptionControl[] = OPTIONS.filter(([code]) => props.has(code)).map(
    ([code, label, names]) => ({
      code,
      label,
      value: String(props.get(code)),
      choices: Object.entries(names).map(([value, name]) => ({ value, label: name })),
    }),
  );

  return { controls, options };
}

/**
 * Записати налаштування камери. Спершу `issue` із рядковим `properties`
 * (так вимагає API), потім — звичайні команди v1: на одних камерах працює
 * перше, на інших друге.
 */
export async function sendCameraProperty(
  deviceId: string,
  code: string,
  value: string | number | boolean,
): Promise<void> {
  if (!CONTROLLABLE.has(code)) throw new Error(`Код ${code} не дозволено для камери`);

  try {
    await tuyaRequest<boolean>({
      path: `/v2.0/cloud/thing/${deviceId}/shadow/properties/issue`,
      method: 'POST',
      body: { properties: JSON.stringify({ [code]: value }) },
    });
  } catch (err) {
    console.warn('[tuya] issue не вдалося, пробуємо команди v1:', err instanceof Error ? err.message : err);
    await sendCommands(deviceId, [{ code, value }]);
  }
  cache.delete(deviceId);
}

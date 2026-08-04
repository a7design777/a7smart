import { remihomeGet } from './client.js';

/** Пристрій у каталозі Remihome. */
export interface RemihomeDevice {
  address: string;
  code: string;
  name: string;
  image: string | null;
  hidden: boolean;
  type: {
    /** Масив міток, напр. ['thermostat', 'hvac'] або ['sensor', 'Climatización']. */
    category?: string[];
    model?: string;
    vendor?: string;
    type?: string;
    description_en?: string;
    description_es?: string;
    /** Самоопис можливостей: name, format, interaction, states. */
    properties?: Array<Record<string, unknown>>;
  };
}

/** Один показник пристрою. Значення завжди приходить рядком. */
export interface RemihomeProperty {
  device_code: string;
  name: string;
  value: string;
  icon: string | null;
  last_set_time: number;
}

export interface RemihomeZone {
  code: string;
  name: string;
  position: number;
  devices: Array<{ code?: string } | string>;
}

export function listRemihomeDevices(): Promise<RemihomeDevice[]> {
  return remihomeGet<RemihomeDevice[]>('/devices?includeHidden=false');
}

export function listRemihomeZones(): Promise<RemihomeZone[]> {
  return remihomeGet<RemihomeZone[]>('/zones');
}

export function getRemihomeDeviceStatus(code: string): Promise<RemihomeProperty[]> {
  return remihomeGet<RemihomeProperty[]>(`/devices/${encodeURIComponent(code)}/status`);
}

/**
 * Статуси всіх пристроїв.
 *
 * Гуртового ендпоїнта знайти не вдалося: `/status` віддає 404, тому
 * читаємо поштучно. При семи пристроях це вісім запитів на цикл —
 * прийнятно, на відміну від Tuya, де таких пристроїв 47.
 *
 * Помилка окремого пристрою не зупиняє решту: недокументований API
 * може відмовити на одному приладі, і це не привід втрачати всі дані.
 */
export async function getAllRemihomeStatuses(
  codes: string[],
): Promise<Map<string, RemihomeProperty[]>> {
  const result = new Map<string, RemihomeProperty[]>();

  const settled = await Promise.allSettled(
    codes.map(async (code) => ({ code, props: await getRemihomeDeviceStatus(code) })),
  );

  for (const entry of settled) {
    if (entry.status === 'fulfilled') {
      result.set(entry.value.code, entry.value.props);
    } else {
      console.warn('[remihome] статус пристрою не отримано:', entry.reason);
    }
  }

  return result;
}

/** Карта «код пристрою → назва зони». Використовується як підказка в UI. */
export async function getZoneByDevice(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const zones = await listRemihomeZones();

  for (const zone of zones) {
    for (const device of zone.devices ?? []) {
      const code = typeof device === 'string' ? device : device.code;
      if (code) map.set(code, zone.name);
    }
  }

  return map;
}

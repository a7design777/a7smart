import { remihomeGet, remihomeRequest } from './client.js';

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

interface BulkStatusEntry {
  code: string;
  status: RemihomeProperty[];
}

/**
 * Статуси всіх пристроїв одним викликом.
 *
 * Шлях `devices/all/status` знайдений у бандлі самого порталу — саме ним
 * він і користується. Раніше тут було поштучне читання, бо очевидний
 * `/status` віддає 404 і здавалося, що гуртового варіанта немає.
 *
 * Помилка не зупиняє Tuya: викликач ловить її окремо.
 */
export async function getAllRemihomeStatuses(
  codes: string[],
): Promise<Map<string, RemihomeProperty[]>> {
  const wanted = new Set(codes);
  const entries = await remihomeGet<BulkStatusEntry[]>(
    '/devices/all/status?includeHidden=false',
  );

  const result = new Map<string, RemihomeProperty[]>();
  for (const entry of entries) {
    if (wanted.has(entry.code)) result.set(entry.code, entry.status);
  }
  return result;
}

/**
 * Змінити властивість пристрою.
 *
 * Формат узятий із бандла порталу: PUT на той самий шлях, що й читання,
 * з тілом-масивом `[{name, value}]`. Значення завжди рядок — навіть для
 * температури.
 */
export function setRemihomeProperty(
  code: string,
  name: string,
  value: string,
): Promise<void> {
  return remihomeRequest<void>(
    `/devices/${encodeURIComponent(code)}/status`,
    'PUT',
    true,
    [{ name, value }],
  );
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

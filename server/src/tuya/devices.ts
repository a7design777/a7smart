import { config } from '../config.js';
import { tuyaRequest } from './client.js';

export interface TuyaDevice {
  id: string;
  name: string;
  category: string;
  product_name?: string;
  online: boolean;
  icon?: string;
}

export interface TuyaStatusItem {
  code: string;
  value: string | number | boolean;
}

/** Список пристроїв, прив'язаних до акаунта Smart Life. */
export function listDevices(): Promise<TuyaDevice[]> {
  return tuyaRequest<TuyaDevice[]>({
    path: `/v1.0/users/${config.TUYA_UID}/devices`,
    method: 'GET',
  });
}

/** Поточні datapoint-и одного пристрою. */
export function getDeviceStatus(deviceId: string): Promise<TuyaStatusItem[]> {
  return tuyaRequest<TuyaStatusItem[]>({
    path: `/v1.0/devices/${deviceId}/status`,
    method: 'GET',
  });
}

interface BatchStatusEntry {
  id: string;
  status: TuyaStatusItem[];
}

/**
 * Статуси кількох пристроїв одним викликом — головний спосіб економити
 * квоту Tuya API у поллері.
 *
 * Батч-ендпоїнт документований неоднозначно, тому при його відмові
 * робимо відкат на послідовні запити. Це дорожче по квоті, але працює
 * гарантовано. Після першого запуску `npm run tuya:probe` варто звірити,
 * чи батч узагалі відповідає, і за потреби прибрати відкат.
 */
export async function getDevicesStatus(
  deviceIds: string[],
): Promise<Map<string, TuyaStatusItem[]>> {
  const result = new Map<string, TuyaStatusItem[]>();
  if (deviceIds.length === 0) return result;

  try {
    const batch = await tuyaRequest<BatchStatusEntry[]>({
      path: '/v1.0/devices/status',
      method: 'GET',
      query: { device_ids: deviceIds.join(',') },
    });
    for (const entry of batch) {
      result.set(entry.id, entry.status);
    }
    return result;
  } catch (err) {
    console.warn('[tuya] батч-статус недоступний, відкат на поштучні запити:', err);
  }

  for (const id of deviceIds) {
    try {
      result.set(id, await getDeviceStatus(id));
    } catch (err) {
      console.error(`[tuya] не вдалось отримати статус ${id}:`, err);
    }
  }
  return result;
}

/** Надіслати команди пристрою. */
export function sendCommands(
  deviceId: string,
  commands: Array<{ code: string; value: unknown }>,
): Promise<boolean> {
  return tuyaRequest<boolean>({
    path: `/v1.0/iot-03/devices/${deviceId}/commands`,
    method: 'POST',
    body: { commands },
  });
}

export interface StreamAllocation {
  url: string;
  /**
   * Виданий URL живе обмежений час — його не можна кешувати надовго
   * і не можна вшивати у фронтенд.
   */
  expire?: number;
}

/**
 * Отримати тимчасовий URL живого потоку камери.
 * HLS обрано замість RTSP, бо його грає браузер без транскодингу на сервері —
 * на 1 vCPU це принципово.
 */
export function allocateCameraStream(
  deviceId: string,
  type: 'hls' | 'rtsp' = 'hls',
): Promise<StreamAllocation> {
  return tuyaRequest<StreamAllocation>({
    path: `/v1.0/devices/${deviceId}/stream/actions/allocate`,
    method: 'POST',
    body: { type },
  });
}

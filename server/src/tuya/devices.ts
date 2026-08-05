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
 * Скільки пристроїв за один виклик. Tuya обмежує довжину device_ids;
 * 20 — безпечне значення, яке лишає запас.
 */
const BATCH_SIZE = 20;

/**
 * Статуси кількох пристроїв пачками — головний спосіб економити квоту
 * Tuya API. При 47 пристроях це 3 виклики замість 47.
 *
 * Використовується саме `/v1.0/iot-03/devices/status`: він віддає масив
 * `{id, status}`. Схожий `/v1.0/devices/status` повертає об'єкт, ключований
 * за id — інша структура, легко переплутати.
 *
 * Відкату на поштучні запити тут навмисно немає: він тихо перетворив би
 * 3 виклики на 47 і спалив квоту непомітно. Помилка має бути видимою.
 */
export async function getDevicesStatus(
  deviceIds: string[],
): Promise<Map<string, TuyaStatusItem[]>> {
  const result = new Map<string, TuyaStatusItem[]>();

  // Порожні id — ознака розсинхрону коду зі схемою БД (наприклад, старий
  // образ читає перейменовану колонку). Tuya на такий список відповідає
  // 1106 permission deny, і причина виглядає як проблема з доступом,
  // хоча насправді це неузгоджений деплой.
  const valid = deviceIds.filter((id) => typeof id === 'string' && id.length > 0);
  if (valid.length !== deviceIds.length) {
    throw new Error(
      `Порожні ідентифікатори пристроїв (${deviceIds.length - valid.length} з ${deviceIds.length}). ` +
        'Найімовірніше, версія образу не відповідає схемі БД — оновіть контейнер.',
    );
  }
  if (valid.length === 0) return result;

  for (let i = 0; i < valid.length; i += BATCH_SIZE) {
    const chunk = valid.slice(i, i + BATCH_SIZE);
    const batch = await tuyaRequest<BatchStatusEntry[]>({
      path: '/v1.0/iot-03/devices/status',
      method: 'GET',
      query: { device_ids: chunk.join(',') },
    });
    for (const entry of batch) {
      result.set(entry.id, entry.status);
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

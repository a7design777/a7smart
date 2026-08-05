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
 * Спосіб читання статусів.
 *
 * Набір доступних ендпоїнтів залежить від середовища: з одного IP
 * `/v1.0/iot-03/devices/status` віддає дані, з іншого — 1106 permission
 * deny, хоча ключі, проєкт і підписки ті самі. Тому стратегія
 * добирається на місці й запам'ятовується: перебирати варіанти щоцикла
 * означало б витрачати квоту на завідомо неробочі виклики.
 */
type Strategy = 'bulk-v1' | 'bulk-iot03' | 'per-device';

const STRATEGIES: Strategy[] = ['bulk-v1', 'bulk-iot03', 'per-device'];

let strategy: Strategy | null = null;

/** Гуртовий виклик, що повертає об'єкт `{ [deviceId]: status[] }`. */
async function bulkV1(chunk: string[]): Promise<Map<string, TuyaStatusItem[]>> {
  const res = await tuyaRequest<Record<string, TuyaStatusItem[]>>({
    path: '/v1.0/devices/status',
    method: 'GET',
    query: { device_ids: chunk.join(',') },
  });
  return new Map(Object.entries(res));
}

/** Гуртовий виклик, що повертає масив `{ id, status }`. */
async function bulkIot03(chunk: string[]): Promise<Map<string, TuyaStatusItem[]>> {
  const res = await tuyaRequest<BatchStatusEntry[]>({
    path: '/v1.0/iot-03/devices/status',
    method: 'GET',
    query: { device_ids: chunk.join(',') },
  });
  return new Map(res.map((e) => [e.id, e.status]));
}

/**
 * Поштучне читання — останній рубіж. Дорого по квоті (виклик на пристрій
 * замість одного на двадцять), тому про перехід сюди повідомляємо голосно.
 */
/**
 * Пристрої, яким Tuya відмовляє в читанні статусу.
 *
 * Один такий пристрій «отруює» весь гуртовий запит: замість того щоб
 * пропустити його, Tuya відхиляє пачку цілком із 1106. Тому проблемні
 * виносяться з пачок і читаються окремо — решта далі йде дешевим
 * гуртовим шляхом.
 */
const problematic = new Set<string>();

async function perDevice(chunk: string[]): Promise<Map<string, TuyaStatusItem[]>> {
  const result = new Map<string, TuyaStatusItem[]>();
  const broken: string[] = [];

  const settled = await Promise.allSettled(
    chunk.map(async (id) => ({ id, status: await getDeviceStatus(id) })),
  );

  for (const [i, entry] of settled.entries()) {
    const id = chunk[i]!;
    if (entry.status === 'fulfilled') {
      result.set(entry.value.id, entry.value.status);
      // Пристрій ожив — повертаємо його в гуртові запити.
      problematic.delete(id);
    } else {
      broken.push(id);
      if (!problematic.has(id)) {
        problematic.add(id);
        console.warn(
          `[tuya] пристрій ${id} не віддає статус — виключено з гуртових запитів`,
        );
      }
    }
  }

  if (result.size === 0 && broken.length === chunk.length && chunk.length > 1) {
    throw new Error('жоден пристрій у пачці не віддав статус');
  }
  return result;
}

const RUNNERS: Record<Strategy, (chunk: string[]) => Promise<Map<string, TuyaStatusItem[]>>> = {
  'bulk-v1': bulkV1,
  'bulk-iot03': bulkIot03,
  'per-device': perDevice,
};

/** Яка стратегія читання статусів зараз діє. Для /api/health. */
export function getStatusStrategy(): Strategy | null {
  return strategy;
}

/**
 * Статуси кількох пристроїв.
 *
 * Стратегія обирається один раз перебором і далі не змінюється, доки
 * працює. Якщо чинна стратегія відмовила — перебір повторюється: доступ
 * до ендпоїнтів може змінитися після правок підписок у Tuya.
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

  // Відомі проблемні читаємо окремо, щоб вони не ламали гуртові пачки.
  const healthy = valid.filter((id) => !problematic.has(id));
  const suspect = valid.filter((id) => problematic.has(id));

  if (suspect.length > 0) {
    for (const [id, status] of await perDevice(suspect)) {
      result.set(id, status);
    }
  }

  for (let i = 0; i < healthy.length; i += BATCH_SIZE) {
    const chunk = healthy.slice(i, i + BATCH_SIZE);

    // Порядок сталий: від найдешевшого до найдорожчого. Стратегія
    // навмисно НЕ закріплюється — інакше одна невдала пачка назавжди
    // перевела б систему на поштучне читання (46 викликів замість 3).
    // Ціна самовідновлення — до двох марних викликів на пачку, і лише
    // поки гуртові ендпоїнти недоступні.
    let chunkResult: Map<string, TuyaStatusItem[]> | null = null;
    const failures: string[] = [];

    for (const candidate of STRATEGIES) {
      try {
        chunkResult = await RUNNERS[candidate](chunk);
        if (candidate !== strategy) {
          strategy = candidate;
          const note =
            candidate === 'per-device'
              ? ' — гуртові ендпоїнти недоступні, витрата квоти зросте в рази'
              : '';
          console.warn(
            `[tuya] спосіб читання статусів: ${candidate}${note}` +
              (failures.length > 0 ? `\n  причина відкату: ${failures.join('; ')}` : ''),
          );
        }
        break;
      } catch (err) {
        failures.push(`${candidate}: ${err instanceof Error ? err.message : err}`);
      }
    }

    if (!chunkResult) {
      throw new Error(`Жоден спосіб читання статусів не спрацював.\n  ${failures.join('\n  ')}`);
    }

    for (const [id, status] of chunkResult) {
      result.set(id, status);
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

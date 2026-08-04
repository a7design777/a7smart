import { config } from './config.js';
import { listDevices, getDevicesStatus } from './tuya/devices.js';
import { normalize, HISTORICAL_KEYS } from './tuya/normalize.js';
import { TuyaApiError } from './tuya/client.js';
import { listEnabledDevices, upsertDevices, insertReadings, pruneReadings } from './db/queries.js';

/**
 * Останній відомий стан кожного пристрою. Дашборд читає звідси, а не
 * ходить у Tuya на кожен запит — інакше квота API згорить за тиждень.
 */
const stateCache = new Map<string, ReturnType<typeof normalize>>();

/**
 * Стан підписки Tuya. Виноситься в /api/health, щоб прострочений
 * IoT Core було видно одразу, а не через здогадки.
 */
export const health = {
  lastPollAt: null as Date | null,
  lastError: null as string | null,
  authProblem: false,
};

export function getCachedState(deviceId: string) {
  return stateCache.get(deviceId) ?? null;
}

export function getAllCachedStates() {
  return [...stateCache.values()];
}

/** Синхронізує каталог пристроїв із Tuya в БД. */
export async function syncDevices(): Promise<number> {
  const devices = await listDevices();
  await upsertDevices(
    devices.map((d) => ({
      id: d.id,
      name: d.name,
      category: d.category,
      kind: normalize(d, []).kind,
    })),
  );
  return devices.length;
}

async function pollOnce(): Promise<void> {
  const rows = await listEnabledDevices();
  if (rows.length === 0) return;

  const tuyaDevices = await listDevices();
  const byId = new Map(tuyaDevices.map((d) => [d.id, d]));

  const statuses = await getDevicesStatus(rows.map((r) => r.tuya_id));

  const readings: Array<{ deviceId: string; key: string; value: number }> = [];

  for (const row of rows) {
    const tuyaDevice = byId.get(row.tuya_id);
    const status = statuses.get(row.tuya_id);
    if (!tuyaDevice || !status) continue;

    // Ім'я беремо з нашої БД: користувач міг перейменувати пристрій у дашборді.
    const normalized = normalize({ ...tuyaDevice, name: row.name }, status);
    stateCache.set(row.tuya_id, normalized);

    for (const metric of normalized.metrics) {
      if (HISTORICAL_KEYS.has(metric.key)) {
        readings.push({ deviceId: row.tuya_id, key: metric.key, value: metric.value });
      }
    }
  }

  await insertReadings(readings);
  health.lastPollAt = new Date();
  health.lastError = null;
  health.authProblem = false;
}

let timer: NodeJS.Timeout | null = null;
let pruneTimer: NodeJS.Timeout | null = null;

export function startPoller(): void {
  const run = () => {
    pollOnce().catch((err) => {
      health.lastError = err instanceof Error ? err.message : String(err);
      health.authProblem = err instanceof TuyaApiError && err.isAuthProblem;
      if (health.authProblem) {
        // Найімовірніша причина зупинки всієї системи — саме цей випадок.
        console.error(
          '[poller] Tuya відмовляє в авторизації. Найчастіше це прострочений ' +
            'IoT Core: продовжити в Cloud → My Services на iot.tuya.com',
        );
      }
      console.error('[poller]', health.lastError);
    });
  };

  run();
  timer = setInterval(run, config.POLL_INTERVAL_MS);

  // Сирі точки старші за 90 днів не потрібні — графіки будуються з агрегатів.
  pruneTimer = setInterval(
    () => {
      pruneReadings(90).catch((err) => console.error('[prune]', err));
    },
    24 * 60 * 60 * 1000,
  );
}

export function stopPoller(): void {
  if (timer) clearInterval(timer);
  if (pruneTimer) clearInterval(pruneTimer);
}

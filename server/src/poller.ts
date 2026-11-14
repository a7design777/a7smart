import { config } from './config.js';
import { listDevices, getDevicesStatus, getDeviceStatus } from './tuya/devices.js';
import { normalize, HISTORICAL_KEYS, type NormalizedDevice } from './tuya/normalize.js';
import { TuyaApiError } from './tuya/client.js';
import { isRemihomeConfigured } from './remihome/client.js';
import {
  listRemihomeDevices,
  getAllRemihomeStatuses,
  getZoneByDevice,
} from './remihome/devices.js';
import { normalizeRemihome } from './remihome/normalize.js';
import { getThermostatSchedule } from './remihome/schedule.js';
import { isHaConfigured } from './ha/client.js';
import {
  listHaDevices,
  getHaStates,
  dropTuyaDuplicates,
  type HaDevice,
} from './ha/devices.js';
import { normalizeHa } from './ha/normalize.js';
import { refreshHaExtras } from './ha/extras.js';
import { syncTuyaHomes } from './tuyaHomes.js';
import {
  listEnabledDevices,
  upsertDevices,
  insertReadings,
  insertPresence,
  pruneReadings,
  prunePresence,
  type Provider,
} from './db/queries.js';

/**
 * Останній відомий стан кожного пристрою. Дашборд читає звідси, а не
 * ходить у хмари на кожен запит — інакше квота Tuya згоріла б за тиждень.
 */
const stateCache = new Map<string, NormalizedDevice>();

/**
 * Стан провайдерів. Виноситься в /api/health: прострочений IoT Core або
 * зламаний портал Remihome мають бути видно одразу, а не через здогадки.
 */
export const health = {
  lastPollAt: null as Date | null,
  lastError: null as string | null,
  authProblem: false,
  remihome: { enabled: false, lastError: null as string | null },
  ha: { enabled: false, lastError: null as string | null },
};

export function getCachedState(deviceId: string) {
  return stateCache.get(deviceId) ?? null;
}

export function getAllCachedStates() {
  return [...stateCache.values()];
}

/**
 * Якому провайдеру належить пристрій. Потрібно роутам керування:
 * відправляти UUID Remihome у Tuya API безглуздо, і помилка від цього
 * була б незрозумілою.
 */
export function getProvider(deviceId: string): Provider | null {
  if (tuyaCatalog.some((d) => d.id === deviceId)) return 'tuya';
  if (remihomeCatalog.some((d) => d.code === deviceId)) return 'remihome';
  if (haCatalog.some((d) => d.id === deviceId)) return 'ha';
  return null;
}

/**
 * Перечитати стан одного пристрою просто зараз.
 *
 * Викликається після команди. Без цього дашборд ще до п'яти хвилин
 * показував би старе значення з кешу — перемикач вмикався б і одразу
 * «відкочувався», хоча прилад уже виконав команду.
 */
export async function refreshDevice(deviceId: string): Promise<void> {
  const provider = getProvider(deviceId);

  if (provider === 'remihome') {
    const device = remihomeCatalog.find((d) => d.code === deviceId);
    if (!device) return;
    // Поштучний /devices/{code}/status віддає 404 (див. коментар у
    // getAllRemihomeStatuses) — тому статус одного пристрою читається
    // тим самим гуртовим шляхом, що й поллер, просто з одним кодом.
    const props = (await getAllRemihomeStatuses([deviceId])).get(deviceId);
    if (!props) return;
    const cached = stateCache.get(deviceId);
    stateCache.set(
      deviceId,
      normalizeRemihome({ ...device, name: cached?.name ?? device.name }, props),
    );
    return;
  }

  if (provider === 'ha') {
    const device = haCatalog.find((d) => d.id === deviceId);
    if (!device) return;
    // HA віддає всі стани одним локальним запитом — окремого шляху для
    // одного пристрою немає, та він і не потрібен.
    const cached = stateCache.get(deviceId);
    stateCache.set(
      deviceId,
      normalizeHa({ ...device, name: cached?.name ?? device.name }, await getHaStates()),
    );
    return;
  }

  const device = tuyaCatalog.find((d) => d.id === deviceId);
  if (!device) return;
  const status = await getDeviceStatus(deviceId);
  const cached = stateCache.get(deviceId);
  stateCache.set(
    deviceId,
    normalize({ ...device, name: cached?.name ?? device.name }, status),
  );
}

const CATALOG_REFRESH_EVERY = 12;
let cycle = 0;

let tuyaCatalog: Awaited<ReturnType<typeof listDevices>> = [];
let remihomeCatalog: Awaited<ReturnType<typeof listRemihomeDevices>> = [];
let haCatalog: HaDevice[] = [];

/** Каталог HA. Як і Remihome, його відмова не має заважати Tuya. */
async function refreshHaCatalog(): Promise<void> {
  try {
    haCatalog = dropTuyaDuplicates(
      await listHaDevices(await getHaStates()),
      new Set(tuyaCatalog.map((d) => d.id)),
    );
    await upsertDevices(
      haCatalog.map((d) => ({
        id: d.id,
        name: d.name,
        category: d.manufacturer ?? 'ha',
        kind: 'sensor' as const,
        provider: 'ha' as Provider,
      })),
    );
    health.ha.lastError = null;
  } catch (err) {
    health.ha.lastError = err instanceof Error ? err.message : String(err);
    console.error('[ha] каталог не оновлено:', health.ha.lastError);
  }
}

async function pollHa(
  rows: Awaited<ReturnType<typeof listEnabledDevices>>,
): Promise<Array<{ deviceId: string; key: string; value: number }>> {
  const byId = new Map(haCatalog.map((d) => [d.id, d]));
  const states = await getHaStates();
  // Погода/сонце/медіа для «Огляду» не залежать від того, чи є в a7smart
  // пристрої HA (зараз усі збігаються з Tuya і відсіяні), тому оновлюються завжди.
  await refreshHaExtras(states);
  const readings: Array<{ deviceId: string; key: string; value: number }> = [];

  for (const row of rows) {
    const device = byId.get(row.external_id);
    if (!device) continue;

    const normalized = normalizeHa({ ...device, name: row.name }, states);
    stateCache.set(row.external_id, normalized);

    for (const metric of normalized.metrics) {
      if (HISTORICAL_KEYS.has(metric.key)) {
        readings.push({ deviceId: row.external_id, key: metric.key, value: metric.value });
      }
    }
  }

  return readings;
}

async function refreshCatalog(): Promise<void> {
  tuyaCatalog = await listDevices();
  await upsertDevices(
    tuyaCatalog.map((d) => ({
      id: d.id,
      name: d.name,
      category: d.category,
      kind: normalize(d, []).kind,
      provider: 'tuya' as Provider,
    })),
  );

  // Нові домогосподарства Tuya → квартири. Допоміжний крок: його збій
  // (наприклад, ще не застосована міграція) не має зупиняти оновлення каталогу.
  await syncTuyaHomes().catch((err) => {
    console.error('[tuya-homes] синхронізація не вдалась:', err instanceof Error ? err.message : err);
  });

  // Після Tuya: каталог HA прибирає ті пристрої, що вже є напряму.
  if (isHaConfigured()) await refreshHaCatalog();

  if (!isRemihomeConfigured()) return;

  // Remihome — необов'язковий провайдер: його відмова не має заважати Tuya.
  try {
    remihomeCatalog = await listRemihomeDevices();
    const zones = await getZoneByDevice().catch(() => new Map<string, string>());

    await upsertDevices(
      remihomeCatalog.map((d) => ({
        id: d.code,
        name: d.name.trim(),
        category: (d.type?.category ?? []).join(',') || 'remihome',
        kind: normalizeRemihome(d, []).kind,
        provider: 'remihome' as Provider,
        sourceZone: zones.get(d.code) ?? null,
      })),
    );
    health.remihome.lastError = null;
  } catch (err) {
    health.remihome.lastError = err instanceof Error ? err.message : String(err);
    console.error('[remihome] каталог не оновлено:', health.remihome.lastError);
  }
}

async function pollTuya(
  rows: Awaited<ReturnType<typeof listEnabledDevices>>,
): Promise<Array<{ deviceId: string; key: string; value: number }>> {
  const ids = rows.map((r) => r.external_id);
  if (ids.length === 0) return [];

  const byId = new Map(tuyaCatalog.map((d) => [d.id, d]));
  const statuses = await getDevicesStatus(ids);
  const readings: Array<{ deviceId: string; key: string; value: number }> = [];

  for (const row of rows) {
    const device = byId.get(row.external_id);
    const status = statuses.get(row.external_id);
    if (!device || !status) continue;

    // Ім'я беремо з нашої БД: користувач міг перейменувати пристрій.
    const normalized = normalize({ ...device, name: row.name }, status);
    stateCache.set(row.external_id, normalized);

    for (const metric of normalized.metrics) {
      if (HISTORICAL_KEYS.has(metric.key)) {
        readings.push({ deviceId: row.external_id, key: metric.key, value: metric.value });
      }
    }
  }

  return readings;
}

async function pollRemihome(
  rows: Awaited<ReturnType<typeof listEnabledDevices>>,
): Promise<Array<{ deviceId: string; key: string; value: number }>> {
  const codes = rows.map((r) => r.external_id);
  if (codes.length === 0) return [];

  const byCode = new Map(remihomeCatalog.map((d) => [d.code, d]));
  const statuses = await getAllRemihomeStatuses(codes);
  const readings: Array<{ deviceId: string; key: string; value: number }> = [];

  for (const row of rows) {
    const device = byCode.get(row.external_id);
    const props = statuses.get(row.external_id);
    if (!device || !props) continue;

    const normalized = normalizeRemihome({ ...device, name: row.name }, props);
    if ((device.type?.category ?? []).some((c) => String(c).toLowerCase() === 'thermostat')) {
      normalized.schedule = await getThermostatSchedule(device.code);
    }
    stateCache.set(row.external_id, normalized);

    for (const metric of normalized.metrics) {
      if (HISTORICAL_KEYS.has(metric.key)) {
        readings.push({ deviceId: row.external_id, key: metric.key, value: metric.value });
      }
    }
  }

  return readings;
}

/**
 * Скільки пристроїв кожної квартири зараз в мережі. З цього рахується, скільки
 * годин на добу було світло: без електрики роутер і розетки зникають разом.
 * Квартира без пристроїв у кеші заміру не отримує. Збій запису не повинен
 * валити поллер.
 */
async function recordPresence(rows: Awaited<ReturnType<typeof listEnabledDevices>>): Promise<void> {
  const byApartment = new Map<number, { online: number; total: number }>();
  for (const row of rows) {
    if (row.apartment_id === null) continue;
    const state = stateCache.get(row.external_id);
    if (!state) continue;
    const entry = byApartment.get(row.apartment_id) ?? { online: 0, total: 0 };
    entry.total++;
    if (state.online) entry.online++;
    byApartment.set(row.apartment_id, entry);
  }
  try {
    await insertPresence(
      [...byApartment].map(([apartmentId, v]) => ({ apartmentId, online: v.online, total: v.total })),
    );
  } catch (err) {
    console.error('[presence]', err);
  }
}

async function pollOnce(): Promise<void> {
  if (cycle % CATALOG_REFRESH_EVERY === 0 || tuyaCatalog.length === 0) {
    await refreshCatalog();
  }
  cycle++;

  const rows = await listEnabledDevices();
  if (rows.length === 0) return;

  const tuyaRows = rows.filter((r) => r.provider === 'tuya');
  const remihomeRows = rows.filter((r) => r.provider === 'remihome');

  const readings = await pollTuya(tuyaRows);
  // Провайдери, чиї стани в цьому циклі свіжі: збій Remihome/HA — не «світла нема».
  const fresh = new Set<string>(['tuya']);

  if (isRemihomeConfigured() && remihomeRows.length > 0) {
    try {
      readings.push(...(await pollRemihome(remihomeRows)));
      health.remihome.lastError = null;
      fresh.add('remihome');
    } catch (err) {
      health.remihome.lastError = err instanceof Error ? err.message : String(err);
      console.error('[remihome] опитування не вдалося:', health.remihome.lastError);
    }
  }

  const haRows = rows.filter((r) => r.provider === 'ha');
  if (isHaConfigured()) {
    try {
      readings.push(...(await pollHa(haRows)));
      health.ha.lastError = null;
      fresh.add('ha');
    } catch (err) {
      health.ha.lastError = err instanceof Error ? err.message : String(err);
      console.error('[ha] опитування не вдалося:', health.ha.lastError);
    }
  }

  await insertReadings(readings);
  await recordPresence(rows.filter((r) => fresh.has(r.provider)));
  health.lastPollAt = new Date();
  health.lastError = null;
  health.authProblem = false;
  health.remihome.enabled = isRemihomeConfigured();
  health.ha.enabled = isHaConfigured();
}

let timer: NodeJS.Timeout | null = null;
let pruneTimer: NodeJS.Timeout | null = null;

export function startPoller(): void {
  const run = () => {
    pollOnce().catch((err) => {
      health.lastError = err instanceof Error ? err.message : String(err);
      health.authProblem = err instanceof TuyaApiError && err.isAuthProblem;
      if (health.authProblem) {
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
      prunePresence(730).catch((err: unknown) => console.error('[prune]', err));
      prunePresence(730).catch((err) => console.error('[prune]', err));
    },
    24 * 60 * 60 * 1000,
  );
}

export function stopPoller(): void {
  if (timer) clearInterval(timer);
  if (pruneTimer) clearInterval(pruneTimer);
}

/** Ручна синхронізація каталогу з UI. */
export async function syncDevices(): Promise<number> {
  await refreshCatalog();
  return tuyaCatalog.length + remihomeCatalog.length + haCatalog.length;
}

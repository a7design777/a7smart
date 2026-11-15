import { Hono } from 'hono';
import { z } from 'zod';
import { requireAuth, verifyPassword, startSession, endSession } from '../auth.js';
import { config } from '../config.js';
import { pickPowerDevice } from '../presence.js';
import { tzOffsetMinutes, isValidTimezone } from '../timezone.js';
import { isCameraControl, sendCameraProperty } from '../tuya/cameras.js';
import {
  sendCommands,
  allocateCameraStream,
  getStatusStrategy,
  ptzMove,
  PTZ_DIRECTIONS,
} from '../tuya/devices.js';
import { TuyaApiError } from '../tuya/client.js';
import { setRemihomeProperty } from '../remihome/devices.js';
import { getHaExtras } from '../ha/extras.js';
import { RemihomeError } from '../remihome/client.js';
import { runScene } from '../scenes.js';
import {
  getAllCachedStates,
  getCachedState,
  syncDevices,
  getProvider,
  refreshDevice,
  tryHaCommand,
  refreshCamera,
  health,
} from '../poller.js';
import {
  listApartments,
  setPowerDevice,
  setApartmentTimezone,
  listEnabledDevices,
  getHistory,
  getPresenceDaily,
  createApartment,
  renameApartment,
  deleteApartment,
  assignDevice,
  renameDevice,
  getEnergyByApartment,
  getTopConsumers,
  setMainApartment,
  setDeviceOrder,
  listScenes,
  createScene,
  updateScene,
  deleteScene,
} from '../db/queries.js';

export const api = new Hono();

// ── Публічні ────────────────────────────────────────────────────────────────

const loginSchema = z.object({ password: z.string().min(1) });

/**
 * Проста затримка проти перебору пароля. Повноцінний rate limiter тут
 * надлишковий: користувачів двоє-троє, ендпоїнт один.
 */
let lastFailedAttempt = 0;

api.post('/login', async (c) => {
  const parsed = loginSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad_request' }, 400);

  const sinceFail = Date.now() - lastFailedAttempt;
  if (sinceFail < 1000) {
    await new Promise((r) => setTimeout(r, 1000 - sinceFail));
  }

  if (!verifyPassword(parsed.data.password, config.APP_PASSWORD_HASH)) {
    lastFailedAttempt = Date.now();
    return c.json({ error: 'invalid_password' }, 401);
  }

  startSession(c);
  return c.json({ ok: true });
});

api.post('/logout', (c) => {
  endSession(c);
  return c.json({ ok: true });
});

/**
 * Healthcheck. `tuyaAuthProblem: true` майже завжди означає прострочений
 * IoT Core на iot.tuya.com, а не баг у коді — саме тому винесено окремо.
 */
api.get('/health', (c) =>
  c.json({
    // Комміт, з якого зібрано образ. Перше, що треба звіряти, коли
    // «оновив, але змін не видно»: docker pull мовчки віддає попередній
    // latest, якщо збірка в CI ще не завершилась.
    version: process.env.GIT_SHA ?? 'unknown',
    ok: !health.authProblem,
    lastPollAt: health.lastPollAt,
    lastError: health.lastError,
    tuyaAuthProblem: health.authProblem,
    // Який ендпоїнт статусів реально працює в цьому середовищі.
    // 'per-device' означає підвищену витрату квоти Tuya.
    statusStrategy: getStatusStrategy(),
    // Remihome читається через недокументований інтерфейс, тому його стан
    // корисно бачити окремо: він може відвалитися незалежно від Tuya.
    remihome: health.remihome,
    ha: { ...health.ha, control: config.HA_CONTROL },
  }),
);

// ── Захищені ────────────────────────────────────────────────────────────────

api.use('/apartments', requireAuth);
api.use('/apartments/*', requireAuth);
api.use('/devices', requireAuth);
api.use('/devices/*', requireAuth);
api.use('/cameras/*', requireAuth);
api.use('/history', requireAuth);
api.use('/presence', requireAuth);
api.use('/energy', requireAuth);
api.use('/sync', requireAuth);

api.get('/apartments', async (c) => c.json(await listApartments()));

const nameSchema = z.object({ name: z.string().trim().min(1).max(60) });

api.post('/apartments', async (c) => {
  const parsed = nameSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad_request' }, 400);
  return c.json(await createApartment(parsed.data.name), 201);
});

api.patch('/apartments/:id', async (c) => {
  const parsed = nameSchema.safeParse(await c.req.json().catch(() => null));
  const id = Number(c.req.param('id'));
  if (!parsed.success || !Number.isInteger(id)) return c.json({ error: 'bad_request' }, 400);
  await renameApartment(id, parsed.data.name);
  return c.json({ ok: true });
});

api.patch('/apartments/:id/main', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) return c.json({ error: 'bad_request' }, 400);
  await setMainApartment(id);
  return c.json({ ok: true });
});

const powerDeviceSchema = z.object({ deviceId: z.string().min(1).nullable() });

/** Обрати пристрій-датчик світла квартири (null — автовибір). */
api.patch('/apartments/:id/power-device', async (c) => {
  const parsed = powerDeviceSchema.safeParse(await c.req.json().catch(() => null));
  const id = Number(c.req.param('id'));
  if (!parsed.success || !Number.isInteger(id)) return c.json({ error: 'bad_request' }, 400);

  const { deviceId } = parsed.data;
  if (deviceId !== null) {
    const device = (await listEnabledDevices()).find((d) => d.external_id === deviceId);
    // Датчиком може бути лише пристрій цієї ж квартири.
    if (!device || device.apartment_id !== id) return c.json({ error: 'bad_request' }, 400);
  }
  await setPowerDevice(id, deviceId);
  return c.json({ ok: true });
});

const timezoneSchema = z.object({ timezone: z.string().min(1).max(64) });

api.patch('/apartments/:id/timezone', async (c) => {
  const parsed = timezoneSchema.safeParse(await c.req.json().catch(() => null));
  const id = Number(c.req.param('id'));
  if (!parsed.success || !Number.isInteger(id) || !isValidTimezone(parsed.data.timezone)) {
    return c.json({ error: 'bad_request' }, 400);
  }
  await setApartmentTimezone(id, parsed.data.timezone);
  return c.json({ ok: true });
});

api.delete('/apartments/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) return c.json({ error: 'bad_request' }, 400);
  await deleteApartment(id);
  return c.json({ ok: true });
});

api.get('/devices', async (c) => {
  const rows = await listEnabledDevices();
  const states = new Map(getAllCachedStates().map((s) => [s.id, s]));

  return c.json(
    rows.map((row) => ({
      id: row.external_id,
      name: row.name,
      kind: row.kind,
      apartmentId: row.apartment_id,
      state: states.get(row.external_id) ?? null,
    })),
  );
});

/** Погода, сонце, медіа з HA — із кешу поллера, у HA запит не йде. */
api.get('/overview/extras', (c) => c.json(getHaExtras()));

api.get('/devices/:id/state', (c) => {
  const state = getCachedState(c.req.param('id'));
  return state ? c.json(state) : c.json({ error: 'not_found' }, 404);
});

const commandSchema = z.object({
  code: z.string().min(1),
  value: z.union([z.string(), z.number(), z.boolean()]),
});

api.post('/devices/:id/command', async (c) => {
  const parsed = commandSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad_request' }, 400);

  const id = c.req.param('id');

  // Пристрої, що існують лише в HA, лишаються тільки для читання; керування
  // через HA стосується пристроїв Tuya (див. tryHaCommand).
  if (getProvider(id) === 'ha') return c.json({ error: 'read_only' }, 403);

  try {
    if (getProvider(id) === 'remihome') {
      // Remihome приймає значення завжди рядком — навіть температуру.
      await setRemihomeProperty(id, parsed.data.code, String(parsed.data.value));
    } else {
      // За HA_CONTROL=1 пробуємо шлях через HA; не вийшло — напряму в Tuya.
      if (getCachedState(id)?.kind === 'camera' && isCameraControl(parsed.data.code)) {
        // Налаштування камер ідуть окремим шляхом (thing model).
        await sendCameraProperty(id, parsed.data.code, parsed.data.value);
        await refreshCamera(id);
        return c.json({ ok: true, state: getCachedState(id) });
      }
      const viaHa = await tryHaCommand(id, parsed.data.code, parsed.data.value);
      if (!viaHa) await sendCommands(id, [parsed.data]);
    }

    // Перечитуємо стан одразу: дашборд читає з кешу, який інакше
    // оновиться лише за кілька хвилин, і команда виглядала б як
    // «перемкнулось і відкотилось назад».
    // Пауза — щоб прилад устиг застосувати команду.
    await new Promise((r) => setTimeout(r, 900));
    await refreshDevice(id).catch((err) => {
      console.warn('[command] не вдалося перечитати стан:', err);
    });

    return c.json({ ok: true, state: getCachedState(id) });
  } catch (err) {
    if (err instanceof TuyaApiError) {
      return c.json({ error: 'tuya_error', code: err.code, message: err.tuyaMessage }, 502);
    }
    if (err instanceof RemihomeError) {
      return c.json({ error: 'remihome_error', message: err.message }, 502);
    }
    throw err;
  }
});

/**
 * URL потоку видається на короткий час, тому фронтенд запитує його
 * щоразу при відкритті камери. Кешувати не можна.
 */
api.get('/cameras/:id/stream', async (c) => {
  try {
    const stream = await allocateCameraStream(c.req.param('id'), 'hls');
    return c.json({ url: stream.url, expire: stream.expire ?? null });
  } catch (err) {
    if (err instanceof TuyaApiError) {
      return c.json({ error: 'tuya_error', code: err.code, message: err.tuyaMessage }, 502);
    }
    throw err;
  }
});

const ptzSchema = z.object({ direction: z.enum(PTZ_DIRECTIONS) });

api.post('/cameras/:id/ptz', async (c) => {
  const parsed = ptzSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad_request' }, 400);

  try {
    await ptzMove(c.req.param('id'), parsed.data.direction);
    return c.json({ ok: true });
  } catch (err) {
    if (err instanceof TuyaApiError) {
      return c.json({ error: 'tuya_error', code: err.code, message: err.tuyaMessage }, 502);
    }
    throw err;
  }
});

const historySchema = z.object({
  device: z.string().min(1),
  key: z.string().min(1),
  hours: z.coerce.number().int().min(1).max(24 * 90).optional(),
  // Довільний діапазон — альтернатива hours для ручного вибору дат.
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

api.get('/history', async (c) => {
  const parsed = historySchema.safeParse(c.req.query());
  if (!parsed.success) return c.json({ error: 'bad_request' }, 400);

  const { device, key } = parsed.data;
  const to = parsed.data.to ?? new Date();
  const from = parsed.data.from ?? new Date(to.getTime() - (parsed.data.hours ?? 24) * 3600_000);
  const hours = (to.getTime() - from.getTime()) / 3600_000;

  if (hours <= 0 || hours > 24 * 90) return c.json({ error: 'bad_request' }, 400);

  // Ціль — близько 100–200 точок на графік незалежно від періоду.
  const bucketMinutes = Math.max(5, Math.round((hours * 60) / 150 / 5) * 5);

  return c.json(await getHistory({ deviceId: device, key, from, to, bucketMinutes }));
});

const presenceSchema = z.object({
  apartmentId: z.coerce.number().int(),
  days: z.coerce.number().int().min(1).max(366).default(7),
});

/** Годин зі світлом / без нього за добу. «Нема даних» — решта до 24 год. */
api.get('/presence', async (c) => {
  const parsed = presenceSchema.safeParse(c.req.query());
  if (!parsed.success) return c.json({ error: 'bad_request' }, 400);

  const { apartmentId, days } = parsed.data;
  const to = new Date();
  const from = new Date(to.getTime() - days * 86_400_000);
  const intervalHours = config.POLL_INTERVAL_MS / 3_600_000;

  const apartment = (await listApartments()).find((a) => a.id === apartmentId);
  // Межі діб — за часовим поясом квартири (Мадрид і Київ різняться на годину).
  const offsetMinutes = apartment ? tzOffsetMinutes(apartment.timezone, to) : 0;
  const rows = await getPresenceDaily({ apartmentId, from, to, offsetMinutes });
  const source = apartment ? pickPowerDevice(apartment, await listEnabledDevices()) : null;
  return c.json({
    apartmentId,
    // Який пристрій вважається датчиком світла і чи обрано його вручну.
    source: source ? { id: source.device.external_id, name: source.device.name, auto: source.auto } : null,
    days: rows.map((r) => {
      const on = Math.min(24, r.on_samples * intervalHours);
      const covered = Math.min(24, r.samples * intervalHours);
      return {
        day: r.day,
        onHours: Math.round(on * 10) / 10,
        offHours: Math.round((covered - on) * 10) / 10,
      };
    }),
  });
});

const assignSchema = z.object({ apartmentId: z.number().int().nullable() });

api.patch('/devices/:id/apartment', async (c) => {
  const parsed = assignSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad_request' }, 400);
  await assignDevice(c.req.param('id'), parsed.data.apartmentId);
  return c.json({ ok: true });
});

api.patch('/devices/:id/name', async (c) => {
  const parsed = nameSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad_request' }, 400);
  await renameDevice(c.req.param('id'), parsed.data.name);
  return c.json({ ok: true });
});

const energySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(7),
});

/**
 * Споживання по квартирах. Гранулярність підбирається під період:
 * за тиждень — по годинах, за місяць — по днях.
 */
api.get('/energy', async (c) => {
  const parsed = energySchema.safeParse(c.req.query());
  if (!parsed.success) return c.json({ error: 'bad_request' }, 400);

  const { days } = parsed.data;
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 3600_000);
  const bucketHours = days <= 2 ? 1 : days <= 14 ? 6 : 24;

  return c.json(await getEnergyByApartment({ from, to, bucketHours }));
});

const topConsumersSchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(7),
  apartmentId: z.coerce.number().int().optional(),
});

/** Рейтинг пристроїв за спожитою енергією — «що споживає найбільше». */
api.get('/energy/top', async (c) => {
  const parsed = topConsumersSchema.safeParse(c.req.query());
  if (!parsed.success) return c.json({ error: 'bad_request' }, 400);

  const { days, apartmentId } = parsed.data;
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 3600_000);

  return c.json(await getTopConsumers({ apartmentId: apartmentId ?? null, from, to }));
});

const orderSchema = z.object({ ids: z.array(z.string().min(1)).min(1).max(500) });

api.patch('/devices/order', async (c) => {
  const parsed = orderSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad_request' }, 400);
  await setDeviceOrder(parsed.data.ids);
  return c.json({ ok: true });
});

// ── Сценарії ────────────────────────────────────────────────────────────────

api.use('/scenes', requireAuth);
api.use('/scenes/*', requireAuth);

const sceneSchema = z.object({
  name: z.string().trim().min(1).max(60),
  apartmentId: z.number().int().nullable().default(null),
  actions: z
    .array(
      z.object({
        device_id: z.string().min(1),
        code: z.string().min(1),
        value: z.string(),
        value_type: z.enum(['string', 'boolean', 'number']),
      }),
    )
    .max(50),
});

api.get('/scenes', async (c) => c.json(await listScenes()));

api.post('/scenes', async (c) => {
  const parsed = sceneSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad_request' }, 400);
  const id = await createScene({
    name: parsed.data.name,
    apartmentId: parsed.data.apartmentId,
    actions: parsed.data.actions,
  });
  return c.json({ id }, 201);
});

api.put('/scenes/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const parsed = sceneSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success || !Number.isInteger(id)) return c.json({ error: 'bad_request' }, 400);
  await updateScene(id, {
    name: parsed.data.name,
    apartmentId: parsed.data.apartmentId,
    actions: parsed.data.actions,
  });
  return c.json({ ok: true });
});

api.delete('/scenes/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) return c.json({ error: 'bad_request' }, 400);
  await deleteScene(id);
  return c.json({ ok: true });
});

/**
 * Запуск сценарію. Часткова відмова — не помилка запиту: відповідь
 * перелічує, які дії пройшли, а які ні.
 */
api.post('/scenes/:id/run', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) return c.json({ error: 'bad_request' }, 400);

  const scene = (await listScenes()).find((s) => s.id === id);
  if (!scene) return c.json({ error: 'not_found' }, 404);

  const results = await runScene(scene.actions);
  return c.json({ ok: results.every((r) => r.ok), results });
});

api.post('/sync', async (c) => c.json({ count: await syncDevices() }));

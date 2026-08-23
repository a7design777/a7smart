import { Hono } from 'hono';
import { z } from 'zod';
import { requireAuth, verifyPassword, startSession, endSession } from '../auth.js';
import { config } from '../config.js';
import { sendCommands, allocateCameraStream, getStatusStrategy } from '../tuya/devices.js';
import { TuyaApiError } from '../tuya/client.js';
import { setRemihomeProperty } from '../remihome/devices.js';
import { RemihomeError } from '../remihome/client.js';
import { runScene } from '../scenes.js';
import {
  getAllCachedStates,
  getCachedState,
  syncDevices,
  getProvider,
  refreshDevice,
  health,
} from '../poller.js';
import {
  listApartments,
  listEnabledDevices,
  getHistory,
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
  }),
);

// ── Захищені ────────────────────────────────────────────────────────────────

api.use('/apartments', requireAuth);
api.use('/apartments/*', requireAuth);
api.use('/devices', requireAuth);
api.use('/devices/*', requireAuth);
api.use('/cameras/*', requireAuth);
api.use('/history', requireAuth);
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

  try {
    if (getProvider(id) === 'remihome') {
      // Remihome приймає значення завжди рядком — навіть температуру.
      await setRemihomeProperty(id, parsed.data.code, String(parsed.data.value));
    } else {
      await sendCommands(id, [parsed.data]);
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

const historySchema = z.object({
  device: z.string().min(1),
  key: z.string().min(1),
  hours: z.coerce.number().int().min(1).max(24 * 90).default(24),
});

api.get('/history', async (c) => {
  const parsed = historySchema.safeParse(c.req.query());
  if (!parsed.success) return c.json({ error: 'bad_request' }, 400);

  const { device, key, hours } = parsed.data;
  const to = new Date();
  const from = new Date(to.getTime() - hours * 3600_000);

  // Ціль — близько 100–200 точок на графік незалежно від періоду.
  const bucketMinutes = Math.max(5, Math.round((hours * 60) / 150 / 5) * 5);

  return c.json(await getHistory({ deviceId: device, key, from, to, bucketMinutes }));
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

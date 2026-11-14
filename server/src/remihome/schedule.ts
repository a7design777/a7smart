import { remihomeGet } from './client.js';
import type { ScheduleSlot } from '../tuya/normalize.js';

/**
 * Тижневий розклад термостата Remihome — лише читання.
 *
 * `GET /devices/thermostats/{code}/schedule` знайдено в самому порталі
 * (екран «Programar»). Час приходить секундами від півночі, дні — прапорцями.
 * Розклад змінюється рідко, тому кешується надовго: зайві запити до порталу
 * на кожен цикл поллера ні до чого.
 */

interface RawSlot {
  startHour: number;
  endHour: number;
  temperature: string;
  code: string;
  onDays: Record<string, boolean>;
}

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

const TTL_MS = 30 * 60 * 1000;
const cache = new Map<string, { at: number; slots: ScheduleSlot[] }>();

function hhmm(seconds: number): string {
  const m = Math.round(seconds / 60);
  const h = Math.min(23, Math.floor(m / 60));
  return `${String(h).padStart(2, '0')}:${String(m >= 24 * 60 ? 59 : m % 60).padStart(2, '0')}`;
}

export function parseSchedule(raw: RawSlot[]): ScheduleSlot[] {
  return raw
    .map((s) => ({
      start: hhmm(s.startHour),
      end: hhmm(s.endHour),
      days: DAY_KEYS.flatMap((k, i) => (s.onDays?.[k] ? [i] : [])),
      temperature: Number(s.temperature),
    }))
    .filter((s) => s.days.length > 0 && Number.isFinite(s.temperature))
    .sort((a, b) => a.start.localeCompare(b.start));
}

/** Розклад із кешу; при збої віддає попередній, а не обриває опитування. */
export async function getThermostatSchedule(code: string): Promise<ScheduleSlot[]> {
  const hit = cache.get(code);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.slots;
  try {
    const raw = await remihomeGet<RawSlot[]>(
      `/devices/thermostats/${encodeURIComponent(code)}/schedule`,
    );
    const slots = parseSchedule(Array.isArray(raw) ? raw : []);
    cache.set(code, { at: Date.now(), slots });
    return slots;
  } catch (err) {
    console.warn('[remihome] розклад не оновлено:', err instanceof Error ? err.message : err);
    return hit?.slots ?? [];
  }
}

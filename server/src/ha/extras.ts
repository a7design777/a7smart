import { haGetDailyForecast, type HaState } from './client.js';

/**
 * Дані HA для «Огляду», які не є пристроями: погода, сонце, медіаплеєри.
 * Лише читання. Будується з тих самих станів, що поллер уже отримав, тож
 * додаткових запитів до HA немає (крім прогнозу — він кешується надовго).
 */

export interface WeatherNow {
  condition: string;
  temperature: number | null;
  humidity: number | null;
  windSpeed: number | null;
  pressure: number | null;
  unit: string;
}

export interface ForecastDay {
  date: string;
  condition: string;
  temperature: number | null;
  templow: number | null;
  precipitation: number | null;
}

export interface SunTimes {
  /** ISO-час наступного сходу/заходу — що настане раніше, те й «наступне». */
  nextRising: string | null;
  nextSetting: string | null;
  aboveHorizon: boolean;
}

export interface MediaPlayer {
  id: string;
  name: string;
  state: string;
  title: string | null;
  artist: string | null;
  volume: number | null;
}

export interface HaExtras {
  weather: WeatherNow | null;
  forecast: ForecastDay[];
  sun: SunTimes | null;
  media: MediaPlayer[];
  updatedAt: string;
}

const EMPTY: HaExtras = { weather: null, forecast: [], sun: null, media: [], updatedAt: '' };

let extras: HaExtras = EMPTY;

export function getHaExtras(): HaExtras {
  return extras;
}

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

/** Прогноз оновлюється раз на пів години: він змінюється повільно. */
const FORECAST_TTL_MS = 30 * 60 * 1000;
let forecastCache: { entityId: string; at: number; days: ForecastDay[] } | null = null;

async function loadForecast(entityId: string): Promise<ForecastDay[]> {
  if (
    forecastCache &&
    forecastCache.entityId === entityId &&
    Date.now() - forecastCache.at < FORECAST_TTL_MS
  ) {
    return forecastCache.days;
  }
  const raw = (await haGetDailyForecast(entityId)) as Array<Record<string, unknown>>;
  const days = raw.slice(0, 5).map((d) => ({
    date: String(d.datetime ?? ''),
    condition: String(d.condition ?? ''),
    temperature: num(d.temperature),
    templow: num(d.templow),
    precipitation: num(d.precipitation),
  }));
  forecastCache = { entityId, at: Date.now(), days };
  return days;
}

/** Чиста функція від станів — окремо, щоб її можна було перевірити без HA. */
export function buildExtras(
  states: Map<string, HaState>,
): Omit<HaExtras, 'forecast' | 'updatedAt'> & { weatherEntity: string | null } {
  const weatherEntity = [...states.keys()].find((k) => k.startsWith('weather.')) ?? null;
  const w = weatherEntity ? states.get(weatherEntity) : undefined;

  const weather: WeatherNow | null = w
    ? {
        condition: w.state,
        temperature: num(w.attributes.temperature),
        humidity: num(w.attributes.humidity),
        windSpeed: num(w.attributes.wind_speed),
        pressure: num(w.attributes.pressure),
        unit: str(w.attributes.temperature_unit) ?? '°C',
      }
    : null;

  const s = states.get('sun.sun');
  const sun: SunTimes | null = s
    ? {
        nextRising: str(s.attributes.next_rising),
        nextSetting: str(s.attributes.next_setting),
        aboveHorizon: s.state === 'above_horizon',
      }
    : null;

  const media: MediaPlayer[] = [...states.values()]
    .filter((x) => x.entity_id.startsWith('media_player.'))
    .map((x) => ({
      id: x.entity_id,
      name: str(x.attributes.friendly_name) ?? x.entity_id,
      state: x.state,
      title: str(x.attributes.media_title),
      artist: str(x.attributes.media_artist),
      volume: num(x.attributes.volume_level),
    }));

  return { weather, sun, media, weatherEntity };
}

/** Викликається поллером після отримання станів. Збій прогнозу не критичний. */
export async function refreshHaExtras(states: Map<string, HaState>): Promise<void> {
  const built = buildExtras(states);
  let forecast = extras.forecast;
  if (built.weatherEntity) {
    try {
      forecast = await loadForecast(built.weatherEntity);
    } catch (err) {
      console.warn('[ha] прогноз не оновлено:', err instanceof Error ? err.message : err);
    }
  }
  extras = {
    weather: built.weather,
    forecast,
    sun: built.sun,
    media: built.media,
    updatedAt: new Date().toISOString(),
  };
}

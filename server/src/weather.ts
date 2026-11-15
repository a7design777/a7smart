import type { HaExtras, ForecastDay } from './ha/extras.js';

/**
 * Погода й сонце для довільної точки (локація квартири) через Open-Meteo —
 * безкоштовний сервіс без ключа. Назовні йдуть лише координати, округлені до
 * сотих (~1 км): точної адреси квартири сервісу знати не потрібно.
 *
 * Результат у тому ж вигляді, що й погода з HA (HaExtras), тож фронтенд не
 * розрізняє джерела. Кеш на 30 хв: погода змінюється повільно.
 */

const TTL_MS = 30 * 60 * 1000;
const cache = new Map<string, { at: number; data: HaExtras }>();

/** Код WMO → умови в термінах HA (їх уже вміє показувати «Огляд»). */
function condition(code: number, isDay: boolean): string {
  if (code === 0) return isDay ? 'sunny' : 'clear-night';
  if (code === 1 || code === 2) return 'partlycloudy';
  if (code === 3) return 'cloudy';
  if (code === 45 || code === 48) return 'fog';
  if ((code >= 51 && code <= 65) || code === 80 || code === 81) return 'rainy';
  if (code === 82) return 'pouring';
  if (code === 66 || code === 67) return 'snowy-rainy';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snowy';
  if (code === 95) return 'lightning-rainy';
  if (code === 96 || code === 99) return 'hail';
  return 'cloudy';
}

interface OpenMeteo {
  utc_offset_seconds: number;
  current: {
    temperature_2m: number;
    relative_humidity_2m: number;
    weather_code: number;
    wind_speed_10m: number;
    surface_pressure: number;
    is_day: number;
  };
  daily: {
    time: string[];
    weather_code: number[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    precipitation_sum: number[];
    sunrise: string[];
    sunset: string[];
  };
}

const round2 = (v: number) => Math.round(v * 100) / 100;

export async function getLocationExtras(lat: number, lon: number): Promise<HaExtras> {
  const latitude = round2(lat);
  const longitude = round2(lon);
  const key = `${latitude},${longitude}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data;

  const url =
    'https://api.open-meteo.com/v1/forecast' +
    `?latitude=${latitude}&longitude=${longitude}` +
    '&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,surface_pressure,is_day' +
    '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,sunrise,sunset' +
    '&timezone=auto&forecast_days=6';

  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Open-Meteo: HTTP ${res.status}`);
  const d = (await res.json()) as OpenMeteo;

  // Час сходу/заходу приходить місцевим без зсуву — перетворюємо на момент часу (UTC).
  const instant = (local: string) =>
    new Date(Date.parse(`${local}:00Z`) - d.utc_offset_seconds * 1000).toISOString();
  const now = Date.now();
  const next = (list: string[]) => list.map(instant).find((t) => Date.parse(t) > now) ?? null;

  const forecast: ForecastDay[] = d.daily.time.slice(0, 5).map((date, i) => ({
    date,
    condition: condition(d.daily.weather_code[i] ?? 3, true),
    temperature: d.daily.temperature_2m_max[i] ?? null,
    templow: d.daily.temperature_2m_min[i] ?? null,
    precipitation: d.daily.precipitation_sum[i] ?? null,
  }));

  const data: HaExtras = {
    weather: {
      condition: condition(d.current.weather_code, d.current.is_day === 1),
      temperature: d.current.temperature_2m,
      humidity: d.current.relative_humidity_2m,
      windSpeed: d.current.wind_speed_10m,
      pressure: d.current.surface_pressure,
      unit: '°C',
    },
    forecast,
    sun: {
      nextRising: next(d.daily.sunrise),
      nextSetting: next(d.daily.sunset),
      aboveHorizon: d.current.is_day === 1,
    },
    media: [],
    updatedAt: new Date().toISOString(),
  };
  cache.set(key, { at: Date.now(), data });
  return data;
}

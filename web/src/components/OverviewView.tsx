import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { overviewApi, type Device, type HaExtras } from '../api';
import { Icon } from './Icon';
import { ClimateCard } from './ClimateCard';
import { SwitchCard } from './SwitchCard';
import { SensorCard } from './SensorCard';
import { StationCard, isStation } from './StationCard';

/** hls.js вантажиться лише коли реально є камери — див. коментар у App.tsx. */
const CameraCard = lazy(() =>
  import('./CameraCard').then((m) => ({ default: m.CameraCard })),
);

/** Дані HA оновлюються поллером раз на 5 хв, тож частіше питати немає сенсу. */
const EXTRAS_REFRESH_MS = 60_000;

const CONDITION_LABEL: Record<string, string> = {
  'clear-night': 'Ясно',
  sunny: 'Ясно',
  cloudy: 'Хмарно',
  partlycloudy: 'Мінлива хмарність',
  fog: 'Туман',
  hail: 'Град',
  lightning: 'Гроза',
  'lightning-rainy': 'Гроза з дощем',
  pouring: 'Злива',
  rainy: 'Дощ',
  snowy: 'Сніг',
  'snowy-rainy': 'Мокрий сніг',
  windy: 'Вітряно',
  'windy-variant': 'Вітряно',
  exceptional: 'Погані умови',
};

const conditionLabel = (c: string) => CONDITION_LABEL[c] ?? c;

const hhmm = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })
    : '—';

const degrees = (v: number | null) => (v === null ? '—' : `${Math.round(v)}°`);

function useExtras(): HaExtras | null {
  const [extras, setExtras] = useState<HaExtras | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      overviewApi
        .extras()
        .then((e) => {
          if (!cancelled) setExtras(e);
        })
        .catch(() => {
          // Погода — прикраса: її відсутність не привід показувати помилку.
        });
    };
    load();
    const t = setInterval(load, EXTRAS_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  return extras;
}

/** Годинник для ТВ і планшета; раз на 20 с достатньо для хвилинної точності. */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 20_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function Hero({ extras }: { extras: HaExtras | null }) {
  const now = useNow();
  const w = extras?.weather;

  return (
    <section className="ov-hero ov-block--full">
      <div className="ov-hero__time">
        <span className="ov-hero__clock">
          {now.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })}
        </span>
        <span className="ov-hero__date">
          {now.toLocaleDateString('uk-UA', { weekday: 'long', day: 'numeric', month: 'long' })}
        </span>
      </div>

      {w && (
        <div className="ov-hero__weather">
          <span className="ov-hero__temp">{degrees(w.temperature)}</span>
          <div className="ov-hero__meta">
            <span className="ov-hero__cond">{conditionLabel(w.condition)}</span>
            <span className="ov-hero__sub">
              {w.humidity !== null && (
                <>
                  <Icon name="droplet" size={14} /> {Math.round(w.humidity)}%
                </>
              )}
              {w.windSpeed !== null && (
                <>
                  {' '}
                  <Icon name="wind" size={14} /> {Math.round(w.windSpeed)} км/год
                </>
              )}
            </span>
          </div>
        </div>
      )}

      {extras?.sun && (
        <div className="ov-hero__sun">
          <Icon name="sun" size={16} />
          <span>
            Схід {hhmm(extras.sun.nextRising)} · Захід {hhmm(extras.sun.nextSetting)}
          </span>
        </div>
      )}
    </section>
  );
}

function Forecast({ extras }: { extras: HaExtras | null }) {
  if (!extras || extras.forecast.length === 0) return null;
  return (
    <section className="ov-block ov-block--full">
      <h2 className="section-title">Прогноз</h2>
      <div className="ov-forecast">
        {extras.forecast.map((d, i) => (
          <div className="ov-forecast__day card" key={d.date}>
            <span className="ov-forecast__name">
              {i === 0
                ? 'Сьогодні'
                : new Date(d.date).toLocaleDateString('uk-UA', { weekday: 'short' })}
            </span>
            <span className="ov-forecast__cond">{conditionLabel(d.condition)}</span>
            <span className="ov-forecast__temp">
              {degrees(d.temperature)} <small>{degrees(d.templow)}</small>
            </span>
            {d.precipitation !== null && d.precipitation > 0 && (
              <span className="ov-forecast__rain">{d.precipitation.toFixed(1)} мм</span>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function Media({ extras }: { extras: HaExtras | null }) {
  // Вимкнені плеєри не показуємо — у них немає що розповісти.
  const active = extras?.media.filter((m) => m.state !== 'off' && m.state !== 'unavailable') ?? [];
  if (active.length === 0) return null;
  return (
    <section className="ov-block">
      <h2 className="section-title">Медіа</h2>
      <div className="grid grid--wide">
        {active.map((m) => (
          <div className="card" key={m.id}>
            <span className="card__name">{m.name}</span>
            <span className="card__sub">
              {m.title ? `${m.artist ? `${m.artist} · ` : ''}${m.title}` : m.state}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

export function OverviewView({ devices }: { devices: Device[] }) {
  const extras = useExtras();

  const groups = useMemo(() => {
    const by = (kind: Device['kind']) => devices.filter((d) => d.kind === kind);
    return {
      cameras: by('camera'),
      climate: by('climate'),
      switches: [...by('switch'), ...by('light')],
      stations: by('sensor').filter(isStation),
      sensors: [...by('sensor'), ...by('unknown')].filter((d) => !isStation(d)),
    };
  }, [devices]);

  return (
    <div className="overview">
      <Hero extras={extras} />
      <Forecast extras={extras} />

      {groups.cameras.length > 0 && (
        <section className="ov-block ov-block--full">
          <h2 className="section-title">Камери</h2>
          <Suspense fallback={<div className="empty">Завантаження камер…</div>}>
            <div className="grid grid--wide">
              {groups.cameras.map((d) => (
                <CameraCard key={d.id} device={d} />
              ))}
            </div>
          </Suspense>
        </section>
      )}

      {groups.stations.length > 0 && (
        <section className="ov-block">
          <h2 className="section-title">Енергія</h2>
          <div className="grid grid--wide">
            {groups.stations.map((d) => (
              <StationCard key={d.id} device={d} />
            ))}
          </div>
        </section>
      )}

      {groups.climate.length > 0 && (
        <section className="ov-block">
          <h2 className="section-title">Клімат</h2>
          <div className="grid grid--wide">
            {groups.climate.map((d) => (
              <ClimateCard key={d.id} device={d} />
            ))}
          </div>
        </section>
      )}

      {groups.switches.length > 0 && (
        <section className="ov-block">
          <h2 className="section-title">Світло та розетки</h2>
          <div className="grid">
            {groups.switches.map((d) => (
              <SwitchCard key={d.id} device={d} />
            ))}
          </div>
        </section>
      )}

      {groups.sensors.length > 0 && (
        <section className="ov-block">
          <h2 className="section-title">Датчики</h2>
          <div className="grid">
            {groups.sensors.map((d) => (
              <SensorCard key={d.id} device={d} />
            ))}
          </div>
        </section>
      )}

      <Media extras={extras} />
    </div>
  );
}

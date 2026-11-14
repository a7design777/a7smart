import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { overviewApi, type Apartment, type Device, type HaExtras } from '../api';
import { CHARTABLE_KEYS, METRIC_LABELS } from '../metricLabels';
import { Icon } from './Icon';
import { ClimateCard } from './ClimateCard';
import { SwitchCard } from './SwitchCard';
import { SensorCard } from './SensorCard';
import { StationCard, isStation } from './StationCard';

/** hls.js вантажиться лише коли реально є камери — див. коментар у App.tsx. */
const HistoryChart = lazy(() =>
  import('./HistoryChart').then((m) => ({ default: m.HistoryChart })),
);
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
  );
}

function Media({ extras }: { extras: HaExtras | null }) {
  // Вимкнені плеєри не показуємо — у них немає що розповісти.
  const active = extras?.media.filter((m) => m.state !== 'off' && m.state !== 'unavailable') ?? [];
  if (active.length === 0) return null;
  return (
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
  );
}

/* ── Налаштування розділів і графіків (на пристрої: ТВ і телефон різні) ── */

type SectionId = 'forecast' | 'energy' | 'charts' | 'devices' | 'media';

const SECTION_LABEL: Record<SectionId, string> = {
  forecast: 'Прогноз',
  energy: 'Енергія',
  charts: 'Графіки',
  devices: 'Пристрої',
  media: 'Медіа',
};

const DEFAULT_ORDER: SectionId[] = ['forecast', 'energy', 'charts', 'devices', 'media'];

const isSectionId = (id: string): id is SectionId => (DEFAULT_ORDER as string[]).includes(id);

interface Prefs {
  order: SectionId[];
  hidden: SectionId[];
  /** null — ще не обирали, діє розумний набір за замовчуванням. */
  charts: string[] | null;
  hours: number;
}

const PREFS_KEY = 'a7smart.overviewPrefs';

function loadPrefs(): Prefs {
  const base: Prefs = { order: DEFAULT_ORDER, hidden: [], charts: null, hours: 24 };
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null') as Partial<Prefs> | null;
    if (!raw) return base;
    const known = (raw.order ?? []).filter(isSectionId);
    // Нові розділи, додані пізніше, дописуються в кінець.
    const order = [...known, ...DEFAULT_ORDER.filter((id) => !known.includes(id))];
    return {
      order,
      hidden: (raw.hidden ?? []).filter(isSectionId),
      charts: Array.isArray(raw.charts) ? raw.charts : null,
      hours: typeof raw.hours === 'number' ? raw.hours : 24,
    };
  } catch {
    return base;
  }
}

function usePrefs(): [Prefs, (patch: Partial<Prefs>) => void] {
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const update = (patch: Partial<Prefs>) =>
    setPrefs((p) => {
      const next = { ...p, ...patch };
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(next));
      } catch {
        // Приватний режим: налаштування діють до перезавантаження.
      }
      return next;
    });
  return [prefs, update];
}

const PERIODS = [
  { label: '24 год', hours: 24 },
  { label: '7 діб', hours: 24 * 7 },
  { label: '30 діб', hours: 24 * 30 },
] as const;

interface ChartOption {
  id: string;
  device: Device;
  key: string;
  unit: string;
}

function chartOptions(devices: Device[]): ChartOption[] {
  return devices.flatMap((device) =>
    (device.state?.metrics ?? [])
      .filter((m) => CHARTABLE_KEYS.includes(m.key))
      .map((m) => ({ id: `${device.id}|${m.key}`, device, key: m.key, unit: m.unit })),
  );
}

/** Станція: заряд і вихід; далі — одна температура. Решту користувач додає сам. */
function defaultCharts(options: ChartOption[]): string[] {
  const station = options.filter(
    (o) => isStation(o.device) && (o.key === 'battery' || o.key === 'output_power'),
  );
  const temp = options.find((o) => o.key === 'temperature' && !isStation(o.device));
  return [...station, ...(temp ? [temp] : [])].map((o) => o.id);
}

function Charts({
  devices,
  prefs,
  update,
  isTv,
}: {
  devices: Device[];
  prefs: Prefs;
  update: (p: Partial<Prefs>) => void;
  isTv: boolean;
}) {
  const options = useMemo(() => chartOptions(devices), [devices]);
  const [picking, setPicking] = useState(false);
  if (options.length === 0) return null;

  const selected = prefs.charts ?? defaultCharts(options);
  const shown = options.filter((o) => selected.includes(o.id));
  const toggle = (id: string) =>
    update({ charts: selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id] });

  return (
    <>
      <div className="ov-toolbar">
        <div className="segmented" role="group" aria-label="Період графіків">
          {PERIODS.map((p) => (
            <button
              key={p.hours}
              type="button"
              className="segmented__item"
              aria-pressed={prefs.hours === p.hours}
              onClick={() => update({ hours: p.hours })}
            >
              {p.label}
            </button>
          ))}
        </div>
        {!isTv && (
          <button type="button" className="ghost-btn" onClick={() => setPicking((v) => !v)}>
            {picking ? 'Готово' : 'Які графіки'}
          </button>
        )}
      </div>

      {picking && (
        <div className="ov-chips">
          {options.map((o) => (
            <button
              key={o.id}
              type="button"
              className="segmented__item ov-chip"
              aria-pressed={selected.includes(o.id)}
              onClick={() => toggle(o.id)}
            >
              {o.device.name} · {METRIC_LABELS[o.key] ?? o.key}
            </button>
          ))}
        </div>
      )}

      {shown.length === 0 ? (
        <div className="empty">Графіки вимкнено — оберіть їх кнопкою «Які графіки»</div>
      ) : (
        <Suspense fallback={<div className="empty">Завантаження графіків…</div>}>
          <div className="grid grid--wide ov-charts">
            {shown.map((o) => (
              <HistoryChart
                key={`${o.id}-${prefs.hours}`}
                deviceId={o.device.id}
                deviceName={`${o.device.name} — ${METRIC_LABELS[o.key] ?? o.key}`}
                metricKey={o.key}
                unit={o.unit}
                hours={prefs.hours}
              />
            ))}
          </div>
        </Suspense>
      )}
    </>
  );
}

/** Пристрої однієї квартири (або всі разом), згруповані за типом. */
function DeviceGroups({ devices }: { devices: Device[] }) {
  const by = (kind: Device['kind']) => devices.filter((d) => d.kind === kind);
  const cameras = by('camera');
  const climate = by('climate');
  const switches = [...by('switch'), ...by('light')];
  const sensors = [...by('sensor'), ...by('unknown')];

  return (
    <>
      {cameras.length > 0 && (
        <>
          <h3 className="ov-sub">Камери</h3>
          <Suspense fallback={<div className="empty">Завантаження камер…</div>}>
            <div className="grid grid--wide">
              {cameras.map((d) => (
                <CameraCard key={d.id} device={d} />
              ))}
            </div>
          </Suspense>
        </>
      )}
      {climate.length > 0 && (
        <>
          <h3 className="ov-sub">Клімат</h3>
          <div className="grid grid--wide">
            {climate.map((d) => (
              <ClimateCard key={d.id} device={d} />
            ))}
          </div>
        </>
      )}
      {switches.length > 0 && (
        <>
          <h3 className="ov-sub">Світло та розетки</h3>
          <div className="grid">
            {switches.map((d) => (
              <SwitchCard key={d.id} device={d} />
            ))}
          </div>
        </>
      )}
      {sensors.length > 0 && (
        <>
          <h3 className="ov-sub">Датчики</h3>
          <div className="grid">
            {sensors.map((d) => (
              <SensorCard key={d.id} device={d} />
            ))}
          </div>
        </>
      )}
    </>
  );
}

export function OverviewView({
  devices,
  apartments,
  activeApartmentId,
}: {
  devices: Device[];
  apartments: Apartment[];
  activeApartmentId: number | null;
}) {
  const extras = useExtras();
  const [prefs, update] = usePrefs();
  const [editing, setEditing] = useState(false);
  const isTv = Boolean(document.documentElement.dataset.tv);

  const stations = useMemo(() => devices.filter(isStation), [devices]);

  // «Усі»: кожна квартира окремим блоком; пристрої без квартири — в кінці.
  const apartmentBlocks = useMemo(() => {
    const rest = devices.filter((d) => !isStation(d));
    if (activeApartmentId !== null || apartments.length === 0) {
      return [{ id: 0, title: null as string | null, devices: rest }];
    }
    const blocks = apartments
      .map((a) => ({
        id: a.id,
        title: a.name as string | null,
        devices: rest.filter((d) => d.apartmentId === a.id),
      }))
      .filter((b) => b.devices.length > 0);
    const orphans = rest.filter((d) => d.apartmentId === null);
    if (orphans.length > 0) blocks.push({ id: -1, title: 'Без квартири', devices: orphans });
    return blocks;
  }, [devices, apartments, activeApartmentId]);

  const move = (id: SectionId, delta: -1 | 1) => {
    const order = [...prefs.order];
    const i = order.indexOf(id);
    const j = i + delta;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j]!, order[i]!];
    update({ order });
  };
  const toggleHidden = (id: SectionId) =>
    update({
      hidden: prefs.hidden.includes(id) ? prefs.hidden.filter((x) => x !== id) : [...prefs.hidden, id],
    });

  const body = (id: SectionId): React.ReactNode => {
    switch (id) {
      case 'forecast':
        return <Forecast extras={extras} />;
      case 'energy':
        return stations.length > 0 ? (
          <div className="grid grid--wide">
            {stations.map((d) => (
              <StationCard key={d.id} device={d} />
            ))}
          </div>
        ) : null;
      case 'charts':
        return <Charts devices={devices} prefs={prefs} update={update} isTv={isTv} />;
      case 'devices':
        return apartmentBlocks.map((b) => (
          <div key={b.id} className="ov-apartment">
            {b.title && <h3 className="ov-apartment__name">{b.title}</h3>}
            <DeviceGroups devices={b.devices} />
          </div>
        ));
      case 'media':
        return <Media extras={extras} />;
    }
  };

  return (
    <div className="overview">
      <Hero extras={extras} />

      {!isTv && (
        <div className="ov-block ov-block--full ov-edit">
          <button type="button" className="ghost-btn" onClick={() => setEditing((v) => !v)}>
            {editing ? 'Готово' : 'Налаштувати розділи'}
          </button>
        </div>
      )}

      {prefs.order.map((id, i) => {
        const hidden = prefs.hidden.includes(id);
        if (hidden && !editing) return null;
        const content = body(id);
        if (!content && !editing) return null;
        const full = id === 'devices' || id === 'forecast' || id === 'charts';
        return (
          <section
            key={id}
            className={`ov-block${full ? ' ov-block--full' : ''}${hidden ? ' ov-block--hidden' : ''}`}
          >
            <div className="ov-head">
              <h2 className="section-title">{SECTION_LABEL[id]}</h2>
              {editing && (
                <span className="ov-head__tools">
                  <button type="button" className="ghost-btn" disabled={i === 0} onClick={() => move(id, -1)} aria-label="Вище">
                    ▲
                  </button>
                  <button
                    type="button"
                    className="ghost-btn"
                    disabled={i === prefs.order.length - 1}
                    onClick={() => move(id, 1)}
                    aria-label="Нижче"
                  >
                    ▼
                  </button>
                  <button type="button" className="ghost-btn" onClick={() => toggleHidden(id)}>
                    {hidden ? 'Показати' : 'Сховати'}
                  </button>
                </span>
              )}
            </div>
            {content}
          </section>
        );
      })}
    </div>
  );
}

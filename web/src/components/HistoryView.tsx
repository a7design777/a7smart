import { useEffect, useMemo, useState } from 'react';
import type { Device } from '../api';
import { HistoryChart } from './HistoryChart';

/** Ті самі ключі, що сервер зберігає в readings (HISTORICAL_KEYS). */
const METRIC_LABELS: Record<string, string> = {
  temperature: 'Температура',
  humidity: 'Вологість',
  power: 'Потужність',
  energy: 'Спожито',
  battery: 'Батарея',
  gas: 'Газ',
};

const CHARTABLE_KEYS = Object.keys(METRIC_LABELS);

const PRESETS = [
  { label: '24 год', hours: 24 },
  { label: '7 днів', hours: 24 * 7 },
  { label: '30 днів', hours: 24 * 30 },
  { label: '90 днів', hours: 24 * 90 },
] as const;

function toDateInput(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const TODAY = toDateInput(new Date());
const WEEK_AGO = toDateInput(new Date(Date.now() - 7 * 86_400_000));

/**
 * Графік історії: ручний вибір пристрою й показника замість автоматичної
 * сітки з усіх поспіль — на 40+ пристроях та вже 6 показниках сітка стає
 * непрохідною. Період — пресети або довільні дати.
 */
export function HistoryView({ devices }: { devices: Device[] }) {
  const chartable = useMemo(
    () => devices.filter((d) => (d.state?.metrics ?? []).some((m) => CHARTABLE_KEYS.includes(m.key))),
    [devices],
  );

  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [metricKey, setMetricKey] = useState<string | null>(null);
  const [mode, setMode] = useState<'preset' | 'custom'>('preset');
  const [hours, setHours] = useState<number>(24);
  const [customFrom, setCustomFrom] = useState(WEEK_AGO);
  const [customTo, setCustomTo] = useState(TODAY);

  // Автовибір першого доступного пристрою, коли список змінюється або
  // раніше обраний пристрій зник зі сфери (перейменування, зміна квартири).
  useEffect(() => {
    if (deviceId && chartable.some((d) => d.id === deviceId)) return;
    setDeviceId(chartable[0]?.id ?? null);
  }, [chartable, deviceId]);

  const device = chartable.find((d) => d.id === deviceId) ?? null;
  const metrics = useMemo(
    () => (device?.state?.metrics ?? []).filter((m) => CHARTABLE_KEYS.includes(m.key)),
    [device],
  );

  useEffect(() => {
    if (metricKey && metrics.some((m) => m.key === metricKey)) return;
    setMetricKey(metrics[0]?.key ?? null);
  }, [metrics, metricKey]);

  if (chartable.length === 0) {
    return <div className="empty">Немає показників для графіків</div>;
  }

  const metric = metrics.find((m) => m.key === metricKey) ?? null;

  return (
    <>
      <div className="tabs" role="tablist" aria-label="Пристрій">
        {chartable.map((d) => (
          <button
            key={d.id}
            type="button"
            role="tab"
            className="tab"
            aria-selected={d.id === deviceId}
            onClick={() => {
              setDeviceId(d.id);
              setMetricKey(null);
            }}
          >
            {d.name}
          </button>
        ))}
      </div>

      {metrics.length > 1 && (
        <div className="segmented" role="tablist" aria-label="Показник" style={{ marginBottom: 14 }}>
          {metrics.map((m) => (
            <button
              key={m.key}
              type="button"
              className="segmented__item"
              aria-pressed={m.key === metricKey}
              onClick={() => setMetricKey(m.key)}
            >
              {METRIC_LABELS[m.key] ?? m.key}
            </button>
          ))}
        </div>
      )}

      <div className="tabs" role="tablist" aria-label="Період">
        {PRESETS.map((r) => (
          <button
            key={r.hours}
            type="button"
            role="tab"
            className="tab"
            aria-selected={mode === 'preset' && hours === r.hours}
            onClick={() => {
              setMode('preset');
              setHours(r.hours);
            }}
          >
            {r.label}
          </button>
        ))}
        <button
          type="button"
          role="tab"
          className="tab"
          aria-selected={mode === 'custom'}
          onClick={() => setMode('custom')}
        >
          Свій період
        </button>
      </div>

      {mode === 'custom' && (
        <div className="row" style={{ gap: 8, marginBottom: 14, justifyContent: 'flex-start' }}>
          <input
            type="date"
            value={customFrom}
            max={customTo}
            aria-label="Від дати"
            onChange={(e) => setCustomFrom(e.target.value)}
          />
          <span className="card__sub">—</span>
          <input
            type="date"
            value={customTo}
            min={customFrom}
            max={TODAY}
            aria-label="До дати"
            onChange={(e) => setCustomTo(e.target.value)}
          />
        </div>
      )}

      {device && metric ? (
        <HistoryChart
          key={`${device.id}-${metric.key}`}
          deviceId={device.id}
          deviceName={`${device.name} — ${METRIC_LABELS[metric.key] ?? metric.key}`}
          metricKey={metric.key}
          unit={metric.unit}
          hours={mode === 'preset' ? hours : undefined}
          from={mode === 'custom' ? `${customFrom}T00:00:00.000Z` : undefined}
          to={mode === 'custom' ? `${customTo}T23:59:59.999Z` : undefined}
        />
      ) : (
        <div className="empty">Оберіть пристрій і показник</div>
      )}
    </>
  );
}

import { useEffect, useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api, type HistoryPoint } from '../api';

const RANGES = [
  { label: '24 год', hours: 24 },
  { label: '7 днів', hours: 24 * 7 },
  { label: '30 днів', hours: 24 * 30 },
] as const;

export function HistoryChart({
  deviceId,
  deviceName,
  metricKey,
  unit,
}: {
  deviceId: string;
  deviceName: string;
  metricKey: string;
  unit: string;
}) {
  const [hours, setHours] = useState<number>(24);
  const [data, setData] = useState<HistoryPoint[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .history(deviceId, metricKey, hours)
      .then((points) => {
        if (!cancelled) {
          setData(points);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [deviceId, metricKey, hours]);

  const formatTick = (value: string) => {
    const d = new Date(value);
    return hours <= 24
      ? d.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit' });
  };

  return (
    <div className="card">
      <div className="row">
        <span className="card__name">{deviceName}</span>
        <div className="tabs" style={{ margin: 0 }}>
          {RANGES.map((r) => (
            <button
              key={r.hours}
              type="button"
              className="tab"
              aria-selected={hours === r.hours}
              onClick={() => setHours(r.hours)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <span className="card__sub">{error}</span>
      ) : data.length === 0 ? (
        <span className="card__sub">Даних за період ще немає</span>
      ) : (
        <div className="chart-wrap">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <defs>
                <linearGradient id={`g-${deviceId}-${metricKey}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#4f8cff" stopOpacity={0.45} />
                  <stop offset="100%" stopColor="#4f8cff" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#2a3040" vertical={false} />
              <XAxis
                dataKey="bucket"
                tickFormatter={formatTick}
                stroke="#8b94a8"
                fontSize={11}
                minTickGap={28}
              />
              <YAxis stroke="#8b94a8" fontSize={11} width={44} unit={unit ? ` ${unit}` : ''} />
              <Tooltip
                contentStyle={{
                  background: '#181b22',
                  border: '1px solid #2a3040',
                  borderRadius: 10,
                  fontSize: 13,
                }}
                labelFormatter={(v: string) => new Date(v).toLocaleString('uk-UA')}
                formatter={(v: number) => [`${v.toFixed(1)} ${unit}`, 'середнє']}
              />
              <Area
                type="monotone"
                dataKey="avg"
                stroke="#4f8cff"
                strokeWidth={2}
                fill={`url(#g-${deviceId}-${metricKey})`}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

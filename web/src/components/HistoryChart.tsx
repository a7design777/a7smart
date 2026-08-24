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

/**
 * Період приходить примітивами (не об'єктом) навмисно: батьківський
 * HistoryView будував би новий `range`-об'єкт щорендеру, і ефект нижче
 * перезапускався б на кожен рендер, а не лише на зміну самого періоду.
 */
export function HistoryChart({
  deviceId,
  deviceName,
  metricKey,
  unit,
  hours,
  from,
  to,
}: {
  deviceId: string;
  deviceName: string;
  metricKey: string;
  unit: string;
  hours?: number;
  from?: string;
  to?: string;
}) {
  const [data, setData] = useState<HistoryPoint[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const spanHours = hours ?? (to && from ? (new Date(to).getTime() - new Date(from).getTime()) / 3600_000 : 24);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .history(deviceId, metricKey, from && to ? { from, to } : { hours: hours ?? 24 })
      .then((points) => {
        if (!cancelled) {
          setData(points);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [deviceId, metricKey, hours, from, to]);

  const formatTick = (value: string) => {
    const d = new Date(value);
    return spanHours <= 48
      ? d.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit' });
  };

  return (
    <div className="card">
      <span className="card__name">{deviceName}</span>

      {loading ? (
        <div className="empty">Завантаження…</div>
      ) : error ? (
        <span className="card__sub">{error}</span>
      ) : data.length === 0 ? (
        <span className="card__sub">Даних за період ще немає</span>
      ) : (
        <div className="chart-wrap">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <defs>
                <linearGradient id={`g-${deviceId}-${metricKey}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis
                dataKey="bucket"
                tickFormatter={formatTick}
                stroke="var(--muted)"
                fontSize={11}
                minTickGap={28}
              />
              <YAxis stroke="var(--muted)" fontSize={11} width={44} unit={unit ? ` ${unit}` : ''} />
              <Tooltip
                contentStyle={{
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 12,
                  fontSize: 13,
                  color: 'var(--text)',
                }}
                labelFormatter={(v: string) => new Date(v).toLocaleString('uk-UA')}
                formatter={(v: number) => [`${v.toFixed(1)} ${unit}`, 'середнє']}
              />
              <Area
                type="monotone"
                dataKey="avg"
                stroke="var(--accent)"
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

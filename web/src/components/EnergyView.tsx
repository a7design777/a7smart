import { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api, type Apartment, type EnergyBucket } from '../api';

const RANGES = [
  { label: 'Доба', days: 1 },
  { label: 'Тиждень', days: 7 },
  { label: 'Місяць', days: 30 },
] as const;

/** Кольори серій. Перші два — з палітри референсу. */
const COLORS = ['#213ccc', '#728557', '#a86a2c', '#7b4fb5', '#2c8ba8', '#c62b3f'];

const UNASSIGNED_KEY = 'none';

export function EnergyView({ apartments }: { apartments: Apartment[] }) {
  const [days, setDays] = useState<number>(7);
  const [raw, setRaw] = useState<EnergyBucket[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .energy(days)
      .then((data) => {
        if (!cancelled) {
          setRaw(data);
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
  }, [days]);

  /** Серії — квартири, які реально дали дані. */
  const series = useMemo(() => {
    const present = new Set(
      raw.map((r) => (r.apartment_id === null ? UNASSIGNED_KEY : String(r.apartment_id))),
    );
    const list = apartments
      .filter((a) => present.has(String(a.id)))
      .map((a) => ({ key: String(a.id), name: a.name }));
    if (present.has(UNASSIGNED_KEY)) {
      list.push({ key: UNASSIGNED_KEY, name: 'Без квартири' });
    }
    return list;
  }, [raw, apartments]);

  /** Півот: рядок на часовий інтервал, колонка на квартиру. */
  const chartData = useMemo(() => {
    const byBucket = new Map<string, Record<string, number | string>>();
    for (const row of raw) {
      const key = row.apartment_id === null ? UNASSIGNED_KEY : String(row.apartment_id);
      const existing = byBucket.get(row.bucket) ?? { bucket: row.bucket };
      existing[key] = Number(row.kwh);
      byBucket.set(row.bucket, existing);
    }
    return [...byBucket.values()].sort((a, b) =>
      String(a.bucket).localeCompare(String(b.bucket)),
    );
  }, [raw]);

  const totals = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of raw) {
      const key = row.apartment_id === null ? UNASSIGNED_KEY : String(row.apartment_id);
      map.set(key, (map.get(key) ?? 0) + Number(row.kwh));
    }
    return map;
  }, [raw]);

  const grandTotal = useMemo(
    () => [...totals.values()].reduce((sum, v) => sum + v, 0),
    [totals],
  );

  const formatTick = (value: string) => {
    const d = new Date(value);
    return days <= 2
      ? d.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit' });
  };

  return (
    <>
      <div className="tabs" role="tablist">
        {RANGES.map((r) => (
          <button
            key={r.days}
            type="button"
            role="tab"
            className="tab"
            aria-selected={days === r.days}
            onClick={() => setDays(r.days)}
          >
            {r.label}
          </button>
        ))}
      </div>

      {error && <div className="banner">{error}</div>}

      <div className="card">
        <span className="card__sub">Спожито за період</span>
        <div className="energy-total">
          <span className="energy-total__value">{grandTotal.toFixed(2)}</span>
          <span className="metric__unit">кВт·год</span>
        </div>

        {series.length > 0 && (
          <div className="legend">
            {series.map((s, i) => (
              <span className="legend__item" key={s.key}>
                <span
                  className="legend__swatch"
                  style={{ background: COLORS[i % COLORS.length] }}
                />
                {s.name} — {(totals.get(s.key) ?? 0).toFixed(2)} кВт·год
              </span>
            ))}
          </div>
        )}
      </div>

      {loading ? (
        <div className="empty">Рахуємо…</div>
      ) : chartData.length === 0 ? (
        <div className="empty">
          Даних ще немає. Споживання рахується з показників розеток із вимірюванням
          потужності — перші точки з'являться за кілька циклів опитування.
        </div>
      ) : (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="chart-wrap">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -22 }}>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis
                  dataKey="bucket"
                  tickFormatter={formatTick}
                  stroke="var(--muted)"
                  fontSize={11}
                  minTickGap={26}
                />
                <YAxis stroke="var(--muted)" fontSize={11} width={44} />
                <Tooltip
                  contentStyle={{
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 10,
                    fontSize: 13,
                    color: 'var(--text)',
                  }}
                  labelFormatter={(v: string) => new Date(v).toLocaleString('uk-UA')}
                  formatter={(v: number, n: string) => [`${v.toFixed(3)} кВт·год`, n]}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {series.map((s, i) => (
                  <Bar
                    key={s.key}
                    dataKey={s.key}
                    name={s.name}
                    stackId="a"
                    fill={COLORS[i % COLORS.length]}
                    radius={i === series.length - 1 ? [4, 4, 0, 0] : undefined}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <p className="card__sub" style={{ marginTop: 12 }}>
        Рахується інтегруванням фактичної потужності розеток, а не за лічильником
        пристрою: Tuya-лічильники періодично скидаються й дають викиди. Пристрої без
        вимірювання потужності у підрахунок не входять.
      </p>
    </>
  );
}

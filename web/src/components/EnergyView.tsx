import { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
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

/**
 * Підбір одиниці під масштаб даних.
 *
 * Розетки за годину дають соті частки кіловат-години, і вісь із
 * підписами «0.003» нечитабельна. Тому при малих значеннях переходимо
 * на ват-години.
 */
function pickUnit(maxValue: number): { unit: string; factor: number; digits: number } {
  if (maxValue > 0 && maxValue < 1) return { unit: 'Вт·год', factor: 1000, digits: 0 };
  return { unit: 'кВт·год', factor: 1, digits: maxValue < 10 ? 2 : 1 };
}

export function EnergyView({
  apartments,
  activeApartmentId,
}: {
  apartments: Apartment[];
  activeApartmentId: number | null;
}) {
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

  /**
   * Дані вибраної квартири. Раніше вкладки квартир висіли над цим
   * екраном, але нічого не робили — виглядало як зламаний фільтр.
   */
  const scoped = useMemo(
    () =>
      activeApartmentId === null
        ? raw
        : raw.filter((r) => r.apartment_id === activeApartmentId),
    [raw, activeApartmentId],
  );

  const series = useMemo(() => {
    const present = new Set(
      scoped.map((r) => (r.apartment_id === null ? UNASSIGNED_KEY : String(r.apartment_id))),
    );
    const list = apartments
      .filter((a) => present.has(String(a.id)))
      .map((a) => ({ key: String(a.id), name: a.name }));
    if (present.has(UNASSIGNED_KEY)) {
      list.push({ key: UNASSIGNED_KEY, name: 'Без квартири' });
    }
    return list;
  }, [scoped, apartments]);

  const totals = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of scoped) {
      const key = row.apartment_id === null ? UNASSIGNED_KEY : String(row.apartment_id);
      map.set(key, (map.get(key) ?? 0) + Number(row.kwh));
    }
    return map;
  }, [scoped]);

  const grandTotal = useMemo(
    () => [...totals.values()].reduce((sum, v) => sum + v, 0),
    [totals],
  );

  const { unit, factor, digits } = pickUnit(grandTotal);

  /** Півот: рядок на часовий інтервал, колонка на квартиру. */
  const chartData = useMemo(() => {
    const byBucket = new Map<string, Record<string, number | string>>();
    for (const row of scoped) {
      const key = row.apartment_id === null ? UNASSIGNED_KEY : String(row.apartment_id);
      const existing = byBucket.get(row.bucket) ?? { bucket: row.bucket };
      existing[key] = Number(row.kwh) * factor;
      byBucket.set(row.bucket, existing);
    }
    return [...byBucket.values()].sort((a, b) =>
      String(a.bucket).localeCompare(String(b.bucket)),
    );
  }, [scoped, factor]);

  const formatTick = (value: string) => {
    const d = new Date(value);
    return days <= 2
      ? d.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit' });
  };

  /** Компактні підписи осі: 1200 → «1.2k». */
  const formatAxis = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v)));

  const scopeName =
    activeApartmentId === null
      ? 'усі квартири'
      : (apartments.find((a) => a.id === activeApartmentId)?.name ?? '');

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
        <span className="card__sub">Спожито за період · {scopeName}</span>
        <div className="energy-total">
          <span className="energy-total__value">
            {(grandTotal * factor).toFixed(digits)}
          </span>
          <span className="metric__unit">{unit}</span>
        </div>

        {series.length > 1 && (
          <div className="legend">
            {series.map((s, i) => (
              <span className="legend__item" key={s.key}>
                <span
                  className="legend__swatch"
                  style={{ background: COLORS[i % COLORS.length] }}
                />
                {s.name} — {((totals.get(s.key) ?? 0) * factor).toFixed(digits)} {unit}
              </span>
            ))}
          </div>
        )}
      </div>

      {loading ? (
        <div className="empty">Рахуємо…</div>
      ) : chartData.length === 0 ? (
        <div className="empty">
          Даних за цей період немає. Споживання рахується з розеток із вимірюванням
          потужності — перевірте, чи є такі в обраній квартирі.
        </div>
      ) : (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="chart-wrap">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 4, right: 2, bottom: 0, left: 2 }}>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis
                  dataKey="bucket"
                  tickFormatter={formatTick}
                  stroke="var(--muted)"
                  fontSize={10}
                  minTickGap={20}
                  tickMargin={4}
                />
                <YAxis
                  stroke="var(--muted)"
                  fontSize={10}
                  width={34}
                  tickFormatter={formatAxis}
                />
                <Tooltip
                  contentStyle={{
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 10,
                    fontSize: 13,
                    color: 'var(--text)',
                  }}
                  labelFormatter={(v: string) => new Date(v).toLocaleString('uk-UA')}
                  formatter={(v: number, n: string) => [`${v.toFixed(digits)} ${unit}`, n]}
                />
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
          <span className="card__sub">Вісь Y — {unit}</span>
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

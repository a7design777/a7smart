import { useEffect, useMemo, useState } from 'react';
import {
  Bar as ChartBar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api, type PresenceResponse } from '../api';

/**
 * Скільки годин на добу у квартирі було світло.
 *
 * «Світло є» = у мережі щонайменше половина пристроїв квартири: без
 * електрики зникають і роутер, і розетки. Збій інтернету теж виглядає як
 * відсутність світла — окремо їх розрізнити неможливо.
 */

interface Column {
  label: string;
  on: number;
  off: number;
}

const MONTHS = ['січ', 'лют', 'бер', 'кві', 'тра', 'чер', 'лип', 'сер', 'вер', 'жов', 'лис', 'гру'];

function toColumns(data: PresenceResponse, days: number): Column[] {
  if (days <= 31) {
    return data.days.map((d) => ({
      label: `${d.day.slice(8, 10)}.${d.day.slice(5, 7)}`,
      on: d.onHours,
      off: d.offHours,
    }));
  }
  // Рік: середня кількість годин на добу за місяць, щоб було 12 стовпців.
  const byMonth = new Map<string, { on: number; off: number; n: number }>();
  for (const d of data.days) {
    const key = d.day.slice(0, 7);
    const m = byMonth.get(key) ?? { on: 0, off: 0, n: 0 };
    m.on += d.onHours;
    m.off += d.offHours;
    m.n++;
    byMonth.set(key, m);
  }
  return [...byMonth].map(([key, m]) => ({
    label: MONTHS[Number(key.slice(5, 7)) - 1] ?? key,
    on: Math.round((m.on / m.n) * 10) / 10,
    off: Math.round((m.off / m.n) * 10) / 10,
  }));
}

export function PowerChart({
  apartmentId,
  title,
  days,
}: {
  apartmentId: number;
  title: string;
  days: number;
}) {
  const [data, setData] = useState<PresenceResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    api
      .presence(apartmentId, days)
      .then((r) => {
        if (!cancelled) {
          setData(r);
          setError(null);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [apartmentId, days]);

  const columns = useMemo(() => (data ? toColumns(data, days) : []), [data, days]);
  const totalOn = columns.reduce((s, b) => s + b.on, 0);
  const totalOff = columns.reduce((s, b) => s + b.off, 0);
  const share = totalOn + totalOff > 0 ? Math.round((totalOn / (totalOn + totalOff)) * 100) : null;

  return (
    <div className="card">
      <div className="row">
        <span className="card__name">{title}</span>
        {share !== null && <span className="card__sub">світло {share}% часу</span>}
      </div>
      {error ? (
        <span className="card__sub">{error}</span>
      ) : !data ? (
        <div className="empty">Завантаження…</div>
      ) : columns.length === 0 ? (
        <span className="card__sub">Даних ще немає — вони збираються від моменту оновлення</span>
      ) : (
        <>
          <div className="chart-wrap">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={columns} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis dataKey="label" stroke="var(--muted)" fontSize={11} minTickGap={14} />
                <YAxis stroke="var(--muted)" fontSize={11} width={38} domain={[0, 24]} />
                <Tooltip
                  contentStyle={{
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 12,
                    fontSize: 13,
                    color: 'var(--text)',
                  }}
                  formatter={(v: number, name: string) => [`${v} год`, name]}
                />
                <ChartBar dataKey="on" name="Світло є" stackId="p" fill="var(--ok)" />
                <ChartBar dataKey="off" name="Світла нема" stackId="p" fill="var(--danger)" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <span className="card__sub">
            {days > 31 ? 'Середнє годин на добу за місяць' : 'Годин на добу'}
          </span>
        </>
      )}
    </div>
  );
}

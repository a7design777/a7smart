import { useEffect, useState } from 'react';
import { api } from '../api';

/**
 * Міні-графік останніх 24 год просто на картці пристрою — без переходу
 * в Історію. Легкий власний SVG, не recharts: на 20-30 карток одразу
 * вантажити важку бібліотеку графіків заради лінії в 28px безглуздо.
 */
export function Sparkline({ deviceId, metricKey }: { deviceId: string; metricKey: string }) {
  const [points, setPoints] = useState<number[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .history(deviceId, metricKey, { hours: 24 })
      .then((data) => {
        if (!cancelled) setPoints(data.map((p) => p.avg));
      })
      .catch(() => {
        if (!cancelled) setPoints([]);
      });
    return () => {
      cancelled = true;
    };
  }, [deviceId, metricKey]);

  if (!points || points.length < 2) return null;

  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const w = 100;
  const h = 28;
  const step = w / (points.length - 1);
  const d = points
    .map((v, i) => `${i === 0 ? 'M' : 'L'} ${(i * step).toFixed(1)} ${(h - ((v - min) / range) * h).toFixed(1)}`)
    .join(' ');

  return (
    <svg className="sparkline" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <path d={d} fill="none" stroke="var(--accent)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

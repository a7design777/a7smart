import type { Device } from '../api';

const LABELS: Record<string, string> = {
  temperature: 'Температура',
  humidity: 'Вологість',
  battery: 'Батарея',
  power: 'Потужність',
  energy: 'Спожито',
};

/** Датчик без керування — лише показники. */
export function SensorCard({ device }: { device: Device }) {
  const state = device.state;
  const metrics = state?.metrics ?? [];

  return (
    <div className={`card${state?.online ? '' : ' card--offline'}`}>
      <span className="card__name" title={device.name}>
        {device.name}
      </span>

      {metrics.length === 0 ? (
        <span className="card__sub">немає даних</span>
      ) : (
        <div className="metric-row">
          {metrics.map((m) => (
            <div key={m.code}>
              <div className="metric">
                <span className="metric__value">
                  {m.key === 'humidity' || m.key === 'battery'
                    ? m.value.toFixed(0)
                    : m.value.toFixed(1)}
                </span>
                <span className="metric__unit">{m.unit}</span>
              </div>
              <span className="card__sub">{LABELS[m.key] ?? m.key}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

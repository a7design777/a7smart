import type { Device } from '../api';

const LABELS: Record<string, string> = {
  temperature: 'Температура',
  humidity: 'Вологість',
  battery: 'Батарея',
  power: 'Потужність',
  energy: 'Спожито',
  gas: 'Газ',
};

/**
 * Датчик без керування.
 *
 * Стани з `alarm` (протікання, витік газу, сіла батарея) виносяться
 * нагору й підсвічуються — це те, заради чого датчик і стоїть.
 */
export function SensorCard({ device }: { device: Device }) {
  const state = device.state;
  const metrics = state?.metrics ?? [];
  const states = state?.states ?? [];

  const alarms = states.filter((s) => s.alarm);
  const normal = states.filter((s) => !s.alarm);
  const hasAlarm = alarms.length > 0;

  return (
    <div
      className={`card${state?.online ? '' : ' card--offline'}${hasAlarm ? ' card--alarm' : ''}`}
    >
      <span className="card__name" title={device.name}>
        {device.name}
      </span>

      {alarms.map((s) => (
        <span key={s.code} className="alarm-flag">
          {s.label}
        </span>
      ))}

      {normal.length > 0 && (
        <div className="metric-row">
          {normal.map((s) => (
            <span key={s.code} className="state-chip">
              {s.label}
            </span>
          ))}
        </div>
      )}

      {metrics.length > 0 && (
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

      {metrics.length === 0 && states.length === 0 && (
        <span className="card__sub">немає даних</span>
      )}
    </div>
  );
}

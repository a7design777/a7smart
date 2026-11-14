import type { Device } from '../api';

/**
 * Картка зарядної станції (Aferiy P280 через ha-fossibot).
 *
 * Пристрій розпізнається за кодами сутностей, а не за назвою: назву
 * користувач може змінити. Лише читання — станція керується не звідси.
 */

const SOC = '_state_of_charge';
const code = (d: Device, suffix: string) =>
  d.state?.metrics.find((m) => m.code.endsWith(suffix));

export function isStation(d: Device): boolean {
  return Boolean(code(d, SOC) && code(d, '_total_output') && code(d, '_total_input'));
}

/** 2346 → «39 год 6 хв». */
function duration(min: number): string {
  if (min <= 0) return '—';
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h >= 48) return `${Math.round(h / 24)} діб`;
  return h > 0 ? `${h} год ${m} хв` : `${m} хв`;
}

export function StationCard({ device }: { device: Device }) {
  const g = (suffix: string) => code(device, suffix)?.value ?? null;
  const soc = g(SOC);
  const input = g('_total_input') ?? 0;
  const output = g('_total_output') ?? 0;
  const toEmpty = g('_remaining_discharge_time');
  const toFull = g('_remaining_charge_time');
  const volts = g('_ac_output_voltage');
  const hz = g('_ac_output_frequency');
  const fault = device.state?.states.find((s) => s.code.endsWith('_fault'))?.alarm ?? false;

  const charging = input > 0 && input >= output;
  const level = soc === null ? 'ok' : soc < 15 ? 'low' : soc < 30 ? 'mid' : 'ok';

  return (
    <div
      className={`card station${device.state?.online ? '' : ' card--offline'}${fault ? ' card--alarm' : ''}`}
    >
      <span className="card__name" title={device.name}>
        {device.name}
      </span>

      <div className="station__main">
        <span className="station__soc">{soc === null ? '—' : Math.round(soc)}</span>
        <span className="metric__unit">%</span>
        <span className="station__state">
          {charging ? 'Заряджається' : output > 0 ? 'Віддає струм' : 'Очікує'}
        </span>
      </div>

      <div className="station__bar" aria-hidden>
        <div
          className={`station__fill station__fill--${level}`}
          style={{ width: `${Math.max(0, Math.min(100, soc ?? 0))}%` }}
        />
      </div>

      <div className="metric-row">
        <div>
          <div className="metric">
            <span className="metric__value">{Math.round(input)}</span>
            <span className="metric__unit">Вт</span>
          </div>
          <span className="card__sub">Вхід</span>
        </div>
        <div>
          <div className="metric">
            <span className="metric__value">{Math.round(output)}</span>
            <span className="metric__unit">Вт</span>
          </div>
          <span className="card__sub">Вихід</span>
        </div>
        <div>
          <div className="metric">
            <span className="metric__value station__time">
              {duration(charging ? (toFull ?? 0) : (toEmpty ?? 0))}
            </span>
          </div>
          <span className="card__sub">{charging ? 'До повного' : 'Вистачить на'}</span>
        </div>
      </div>

      {(volts !== null || hz !== null) && output > 0 && (
        <span className="card__sub">
          {volts !== null && `${volts.toFixed(0)} В`}
          {hz !== null && ` · ${hz.toFixed(0)} Гц`}
        </span>
      )}
      {fault && <span className="alarm-flag">Помилка станції</span>}
    </div>
  );
}

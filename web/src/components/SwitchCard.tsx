import { useState } from 'react';
import type { Device } from '../api';
import { useStore } from '../store';

/**
 * Розетка, вимикач або лампа.
 *
 * Двоклавішні вимикачі (`switch_1` + `switch_2`) показуються як два
 * незалежні перемикачі — в акаунті таких п'ять.
 */
export function SwitchCard({ device }: { device: Device }) {
  const sendCommand = useStore((s) => s.sendCommand);
  const [busyCode, setBusyCode] = useState<string | null>(null);
  const state = device.state;
  const gangs = state?.gangs ?? [];

  if (gangs.length === 0) return null;

  const powerMetric = state?.metrics.find((m) => m.key === 'power');
  const energyMetric = state?.metrics.find((m) => m.key === 'energy');

  async function toggle(code: string, on: boolean) {
    setBusyCode(code);
    try {
      await sendCommand(device.id, code, !on);
    } finally {
      setBusyCode(null);
    }
  }

  return (
    <div className={`card${state?.online ? '' : ' card--offline'}`}>
      <span className="card__name" title={device.name}>
        {device.name}
      </span>

      {gangs.map((gang) => (
        <div className="row" key={gang.code}>
          <span className="card__sub">{gang.label}</span>
          <button
            type="button"
            className="toggle"
            aria-pressed={gang.on}
            aria-label={`${device.name}, ${gang.label}: ${gang.on ? 'вимкнути' : 'увімкнути'}`}
            disabled={busyCode === gang.code || !state?.online}
            onClick={() => void toggle(gang.code, gang.on)}
          />
        </div>
      ))}

      {(powerMetric ?? energyMetric) && (
        <div className="metric-row">
          {powerMetric && (
            <div>
              <div className="metric">
                <span className="metric__value">{powerMetric.value.toFixed(0)}</span>
                <span className="metric__unit">{powerMetric.unit}</span>
              </div>
              <span className="card__sub">зараз</span>
            </div>
          )}
          {energyMetric && (
            <div>
              <div className="metric">
                <span className="metric__value">{energyMetric.value.toFixed(2)}</span>
                <span className="metric__unit">{energyMetric.unit}</span>
              </div>
              <span className="card__sub">спожито</span>
            </div>
          )}
        </div>
      )}

      {!state?.online && <span className="card__sub">не в мережі</span>}
    </div>
  );
}

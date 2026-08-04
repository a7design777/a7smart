import { useState } from 'react';
import type { Device } from '../api';
import { useStore } from '../store';

/** Розетка, вимикач або лампа — усе, що має головний перемикач. */
export function SwitchCard({ device }: { device: Device }) {
  const sendCommand = useStore((s) => s.sendCommand);
  const [busy, setBusy] = useState(false);
  const state = device.state;
  const power = state?.power;

  if (!power) return null;

  const powerMetric = state?.metrics.find((m) => m.key === 'power');

  async function toggle() {
    if (!power) return;
    setBusy(true);
    try {
      await sendCommand(device.id, power.code, !power.on);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`card${state?.online ? '' : ' card--offline'}`}>
      <div className="row">
        <span className="card__name" title={device.name}>
          {device.name}
        </span>
        <button
          type="button"
          className="toggle"
          aria-pressed={power.on}
          aria-label={`${device.name}: ${power.on ? 'вимкнути' : 'увімкнути'}`}
          disabled={busy || !state?.online}
          onClick={() => void toggle()}
        />
      </div>

      {powerMetric ? (
        <div className="metric">
          <span className="metric__value">{powerMetric.value.toFixed(0)}</span>
          <span className="metric__unit">{powerMetric.unit}</span>
        </div>
      ) : (
        <span className="card__sub">{state?.online ? 'у мережі' : 'не в мережі'}</span>
      )}
    </div>
  );
}

import { useEffect, useState } from 'react';
import type { Device } from '../api';
import { useStore } from '../store';

/**
 * Клімат: живлення, поточна температура + керування цільовою.
 *
 * Крок — 1 °C, бо `temp_set` у цих термостатах цілочисельний і
 * немасштабований (26 = 26 °C). Зміни дебаунсяться на 800 мс: без цього
 * кожен тик стрілки був би окремим викликом Tuya API, а квота скінченна.
 */
export function ClimateCard({ device }: { device: Device }) {
  const sendCommand = useStore((s) => s.sendCommand);
  const state = device.state;
  const target = state?.target;
  const powerGang = state?.gangs[0];

  const [draft, setDraft] = useState<number | null>(target?.value ?? null);

  // Підхоплюємо значення з сервера, поки користувач не почав крутити.
  useEffect(() => {
    setDraft(target?.value ?? null);
  }, [target?.value]);

  useEffect(() => {
    if (draft === null || !target || draft === target.value) return;

    const timer = setTimeout(() => {
      void sendCommand(device.id, target.code, draft);
    }, 800);

    return () => clearTimeout(timer);
  }, [draft, target, device.id, sendCommand]);

  const current = state?.metrics.find((m) => m.key === 'temperature');
  const humidity = state?.metrics.find((m) => m.key === 'humidity');

  return (
    <div className={`card${state?.online ? '' : ' card--offline'}`}>
      <div className="row">
        <span className="card__name" title={device.name}>
          {device.name}
        </span>
        {powerGang && (
          <button
            type="button"
            className="toggle"
            aria-pressed={powerGang.on}
            aria-label={`${device.name}: ${powerGang.on ? 'вимкнути' : 'увімкнути'}`}
            disabled={!state?.online}
            onClick={() => void sendCommand(device.id, powerGang.code, !powerGang.on)}
          />
        )}
      </div>

      {(current ?? humidity) && (
        <div className="metric-row">
          {current && (
            <div>
              <div className="metric">
                <span className="metric__value">{current.value.toFixed(1)}</span>
                <span className="metric__unit">{current.unit}</span>
              </div>
              <span className="card__sub">зараз</span>
            </div>
          )}
          {humidity && (
            <div>
              <div className="metric">
                <span className="metric__value">{humidity.value.toFixed(0)}</span>
                <span className="metric__unit">{humidity.unit}</span>
              </div>
              <span className="card__sub">вологість</span>
            </div>
          )}
        </div>
      )}

      {target && draft !== null && (
        <>
          <span className="card__sub">цільова</span>
          <div className="stepper">
            <button
              type="button"
              aria-label="Зменшити на 1 градус"
              disabled={!state?.online || draft <= target.min}
              onClick={() => setDraft((v) => Math.max(target.min, (v ?? target.value) - 1))}
            >
              −
            </button>
            <span className="stepper__value">{draft}°</span>
            <button
              type="button"
              aria-label="Збільшити на 1 градус"
              disabled={!state?.online || draft >= target.max}
              onClick={() => setDraft((v) => Math.min(target.max, (v ?? target.value) + 1))}
            >
              +
            </button>
          </div>
        </>
      )}

      {!state?.online && <span className="card__sub">не в мережі</span>}
    </div>
  );
}

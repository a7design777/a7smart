import { useEffect, useState } from 'react';
import type { Device } from '../api';
import { useStore } from '../store';

/**
 * Клімат: поточна температура + керування цільовою.
 *
 * Зміни цільової температури дебаунсяться на 800 мс. Без цього кожен
 * тик стрілки був би окремим викликом Tuya API — а квота в Trial-тарифі
 * скінченна.
 */
export function ClimateCard({ device }: { device: Device }) {
  const sendCommand = useStore((s) => s.sendCommand);
  const state = device.state;
  const target = state?.target;

  const [draft, setDraft] = useState<number | null>(target?.value ?? null);

  // Підхоплюємо значення з сервера, поки користувач не почав крутити.
  useEffect(() => {
    setDraft(target?.value ?? null);
  }, [target?.value]);

  useEffect(() => {
    if (draft === null || !target || draft === target.value) return;

    const timer = setTimeout(() => {
      // Tuya приймає цілі числа: 23.5 °C передається як 235.
      void sendCommand(device.id, target.code, Math.round(draft * 10));
    }, 800);

    return () => clearTimeout(timer);
  }, [draft, target, device.id, sendCommand]);

  const current = state?.metrics.find((m) => m.key === 'temperature');
  const humidity = state?.metrics.find((m) => m.key === 'humidity');

  return (
    <div className={`card${state?.online ? '' : ' card--offline'}`}>
      <span className="card__name" title={device.name}>
        {device.name}
      </span>

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

      {target && draft !== null && (
        <>
          <span className="card__sub">цільова</span>
          <div className="stepper">
            <button
              type="button"
              aria-label="Зменшити на 0.5 градуса"
              disabled={!state?.online || draft <= target.min}
              onClick={() => setDraft((v) => Math.max(target.min, (v ?? target.value) - 0.5))}
            >
              −
            </button>
            <span className="stepper__value">{draft.toFixed(1)}°</span>
            <button
              type="button"
              aria-label="Збільшити на 0.5 градуса"
              disabled={!state?.online || draft >= target.max}
              onClick={() => setDraft((v) => Math.min(target.max, (v ?? target.value) + 0.5))}
            >
              +
            </button>
          </div>
        </>
      )}
    </div>
  );
}

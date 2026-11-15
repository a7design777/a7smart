import { useState } from 'react';
import { api, type Apartment } from '../api';
import { useStore } from '../store';

const ZONES = [
  'Europe/Kyiv',
  'Europe/Madrid',
  'Europe/Warsaw',
  'Europe/Berlin',
  'Europe/Lisbon',
  'Europe/London',
  'UTC',
];

/**
 * Точка квартири на карті й часовий пояс. Від неї залежать погода, схід і
 * захід сонця та годинник на вкладці квартири. Без точки береться погода HA.
 *
 * Координати вводяться вручну або беруться з геолокації цього пристрою
 * («Я тут» — зручно, коли ви саме в тій квартирі). Карту-вибірник не
 * підключаємо: це окрема важка залежність, а для точності ~1 км (так
 * округлюється запит погоди) досить координат із будь-якої карти.
 */
export function LocationEditor({ apartment }: { apartment: Apartment }) {
  const refresh = useStore((s) => s.refresh);
  const [lat, setLat] = useState(apartment.latitude?.toString() ?? '');
  const [lon, setLon] = useState(apartment.longitude?.toString() ?? '');
  const [zone, setZone] = useState(apartment.timezone);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const zones = ZONES.includes(zone) ? ZONES : [zone, ...ZONES];
  const latNum = Number(lat.replace(',', '.'));
  const lonNum = Number(lon.replace(',', '.'));
  const hasPoint = lat.trim() !== '' && lon.trim() !== '';
  const valid =
    !hasPoint ||
    (Number.isFinite(latNum) && Math.abs(latNum) <= 90 && Number.isFinite(lonNum) && Math.abs(lonNum) <= 180);

  async function save(clear = false) {
    setBusy(true);
    setMessage(null);
    try {
      await api.setApartmentLocation(apartment.id, {
        latitude: clear || !hasPoint ? null : latNum,
        longitude: clear || !hasPoint ? null : lonNum,
        timezone: zone,
      });
      if (clear) {
        setLat('');
        setLon('');
      }
      await refresh();
      setMessage('Збережено');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Не вдалося зберегти');
    } finally {
      setBusy(false);
    }
  }

  function useMyLocation() {
    if (!navigator.geolocation) {
      setMessage('Браузер не вміє визначати геолокацію');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(pos.coords.latitude.toFixed(4));
        setLon(pos.coords.longitude.toFixed(4));
        setZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
        setMessage('Координати взято з цього пристрою — натисніть «Зберегти»');
      },
      () => setMessage('Геолокацію не дозволено в браузері'),
      { timeout: 10_000 },
    );
  }

  return (
    <details className="location-editor">
      <summary className="card__sub">
        Локація: {apartment.latitude !== null && apartment.longitude !== null
          ? `${apartment.latitude.toFixed(2)}, ${apartment.longitude.toFixed(2)}`
          : 'не задана (погода з HA)'}{' '}
        · {apartment.timezone}
      </summary>

      <div className="location-editor__grid">
        <label>
          <span className="card__sub">Широта</span>
          <input value={lat} inputMode="decimal" placeholder="40.4168" onChange={(e) => setLat(e.target.value)} />
        </label>
        <label>
          <span className="card__sub">Довгота</span>
          <input value={lon} inputMode="decimal" placeholder="-3.7038" onChange={(e) => setLon(e.target.value)} />
        </label>
        <label>
          <span className="card__sub">Часовий пояс</span>
          <select value={zone} onChange={(e) => setZone(e.target.value)}>
            {zones.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="dropzone__actions">
        <button type="button" className="ghost-btn" onClick={useMyLocation}>
          Я тут (з цього пристрою)
        </button>
        {hasPoint && valid && (
          <a
            className="ghost-btn"
            href={`https://www.openstreetmap.org/?mlat=${latNum}&mlon=${lonNum}#map=14/${latNum}/${lonNum}`}
            target="_blank"
            rel="noreferrer"
          >
            Показати на карті
          </a>
        )}
        <button type="button" className="ghost-btn" disabled={busy || !valid} onClick={() => void save()}>
          Зберегти
        </button>
        {apartment.latitude !== null && (
          <button type="button" className="ghost-btn" disabled={busy} onClick={() => void save(true)}>
            Прибрати точку
          </button>
        )}
      </div>

      {!valid && <span className="card__sub">Широта −90…90, довгота −180…180</span>}
      {message && <span className="card__sub">{message}</span>}
    </details>
  );
}

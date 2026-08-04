import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useStore } from './store';
import { Login } from './components/Login';
import { SwitchCard } from './components/SwitchCard';
import { SensorCard } from './components/SensorCard';
import { ClimateCard } from './components/ClimateCard';
import type { Device } from './api';

/**
 * recharts і hls.js важать разом ~800 kB — більше, ніж решта застосунку.
 * Обидва потрібні не на першому екрані, тому вантажаться на вимогу:
 * дашборд відкривають переважно з телефона.
 */
const CameraCard = lazy(() =>
  import('./components/CameraCard').then((m) => ({ default: m.CameraCard })),
);
const HistoryChart = lazy(() =>
  import('./components/HistoryChart').then((m) => ({ default: m.HistoryChart })),
);

type View = 'home' | 'energy';

export function App() {
  const { authed, loading, error, apartments, devices, activeApartmentId } = useStore();
  const refresh = useStore((s) => s.refresh);
  const setApartment = useStore((s) => s.setApartment);
  const logout = useStore((s) => s.logout);
  const [view, setView] = useState<View>('home');

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const visible = useMemo(
    () =>
      devices.filter(
        (d) => activeApartmentId === null || d.apartmentId === activeApartmentId,
      ),
    [devices, activeApartmentId],
  );

  const groups = useMemo(() => {
    const by = (kind: Device['kind']) => visible.filter((d) => d.kind === kind);
    return {
      climate: by('climate'),
      cameras: by('camera'),
      // Лампи та розетки показуємо разом — для користувача це одна група.
      switches: [...by('switch'), ...by('light')],
      sensors: [...by('sensor'), ...by('unknown')],
    };
  }, [visible]);

  /** Пристрої, які пишуть історію — для вкладки «Історія». */
  const charted = useMemo(
    () =>
      visible.flatMap((d) =>
        (d.state?.metrics ?? [])
          .filter((m) => ['temperature', 'humidity', 'power', 'energy'].includes(m.key))
          .map((m) => ({ device: d, metric: m })),
      ),
    [visible],
  );

  if (loading) {
    return <div className="empty">Завантаження…</div>;
  }

  if (!authed) {
    return <Login />;
  }

  return (
    <div className="app">
      <header className="topbar">
        <h1>a7smart</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            className="ghost-btn"
            onClick={() => setView(view === 'home' ? 'energy' : 'home')}
          >
            {view === 'home' ? 'Історія' : 'Пристрої'}
          </button>
          <button type="button" className="ghost-btn" onClick={() => void logout()}>
            Вийти
          </button>
        </div>
      </header>

      {error && <div className="banner">{error}</div>}

      {apartments.length > 1 && (
        <div className="tabs" role="tablist">
          {apartments.map((a) => (
            <button
              key={a.id}
              type="button"
              role="tab"
              className="tab"
              aria-selected={activeApartmentId === a.id}
              onClick={() => setApartment(a.id)}
            >
              {a.name}
            </button>
          ))}
          <button
            type="button"
            role="tab"
            className="tab"
            aria-selected={activeApartmentId === null}
            onClick={() => setApartment(null)}
          >
            Усі
          </button>
        </div>
      )}

      {view === 'energy' ? (
        <>
          <h2 className="section-title">Історія</h2>
          {charted.length === 0 ? (
            <div className="empty">Немає показників для графіків</div>
          ) : (
            <Suspense fallback={<div className="empty">Завантаження графіків…</div>}>
              <div className="grid grid--wide">
                {charted.map(({ device, metric }) => (
                  <HistoryChart
                    key={`${device.id}-${metric.key}`}
                    deviceId={device.id}
                    deviceName={`${device.name} — ${metric.key}`}
                    metricKey={metric.key}
                    unit={metric.unit}
                  />
                ))}
              </div>
            </Suspense>
          )}
        </>
      ) : devices.length === 0 ? (
        <div className="empty">
          Пристроїв немає. Виконайте синхронізацію з Tuya, а якщо список порожній і після
          неї — перевірте прив'язку акаунта Smart Life.
        </div>
      ) : (
        <>
          {groups.climate.length > 0 && (
            <>
              <h2 className="section-title">Клімат</h2>
              <div className="grid grid--wide">
                {groups.climate.map((d) => (
                  <ClimateCard key={d.id} device={d} />
                ))}
              </div>
            </>
          )}

          {groups.switches.length > 0 && (
            <>
              <h2 className="section-title">Світло та розетки</h2>
              <div className="grid">
                {groups.switches.map((d) => (
                  <SwitchCard key={d.id} device={d} />
                ))}
              </div>
            </>
          )}

          {groups.sensors.length > 0 && (
            <>
              <h2 className="section-title">Датчики</h2>
              <div className="grid">
                {groups.sensors.map((d) => (
                  <SensorCard key={d.id} device={d} />
                ))}
              </div>
            </>
          )}

          {groups.cameras.length > 0 && (
            <>
              <h2 className="section-title">Камери</h2>
              <Suspense fallback={<div className="empty">Завантаження камер…</div>}>
                <div className="grid grid--wide">
                  {groups.cameras.map((d) => (
                    <CameraCard key={d.id} device={d} />
                  ))}
                </div>
              </Suspense>
            </>
          )}
        </>
      )}
    </div>
  );
}

import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useStore } from './store';
import { useTheme, THEME_ICON, THEME_LABEL } from './theme';
import { Login } from './components/Login';
import { SwitchCard } from './components/SwitchCard';
import { SensorCard } from './components/SensorCard';
import { ClimateCard } from './components/ClimateCard';
import { ManageApartments } from './components/ManageApartments';
import { EditGrid } from './components/EditGrid';
import { Icon, type IconName } from './components/Icon';
import { WhatsNew, useUnseenChangelog } from './components/WhatsNew';
import type { Device } from './api';

/**
 * recharts і hls.js важать разом ~800 kB — більше, ніж решта застосунку.
 * Обидва потрібні не на першому екрані, тому вантажаться на вимогу:
 * дашборд відкривають переважно з телефона.
 */
const CameraCard = lazy(() =>
  import('./components/CameraCard').then((m) => ({ default: m.CameraCard })),
);
const HistoryView = lazy(() =>
  import('./components/HistoryView').then((m) => ({ default: m.HistoryView })),
);
const EnergyView = lazy(() =>
  import('./components/EnergyView').then((m) => ({ default: m.EnergyView })),
);
const ScenesView = lazy(() =>
  import('./components/ScenesView').then((m) => ({ default: m.ScenesView })),
);

type View = 'home' | 'scenes' | 'energy' | 'history' | 'manage';

const VIEW_LABEL: Record<View, string> = {
  home: 'Пристрої',
  scenes: 'Сценарії',
  energy: 'Енергія',
  history: 'Історія',
  manage: 'Квартири',
};

const VIEW_ICON: Record<View, IconName> = {
  home: 'devices',
  scenes: 'scenes',
  energy: 'energy',
  history: 'history',
  manage: 'apartments',
};

export function App() {
  const { authed, loading, error, apartments, devices, activeApartmentId } = useStore();
  const refresh = useStore((s) => s.refresh);
  const setApartment = useStore((s) => s.setApartment);
  const logout = useStore((s) => s.logout);
  const [view, setView] = useState<View>('home');
  const [editMode, setEditMode] = useState(false);
  const [whatsNewOpen, setWhatsNewOpen] = useState(false);
  const { theme, cycle } = useTheme();
  const unseenChangelog = useUnseenChangelog();

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const visible = useMemo(
    () =>
      devices.filter((d) => activeApartmentId === null || d.apartmentId === activeApartmentId),
    [devices, activeApartmentId],
  );

  /**
   * Спрацьовані датчики (двері/вікна відчинені, протікання, газ) —
   * по всіх квартирах одразу, а не лише вибраній: інакше тривога в
   * квартирі нагорі лишалась би непоміченою, поки хтось не перемкне
   * вкладку. Показуються нагорі Home, без потреби гортати до «Датчики».
   */
  const activeAlerts = useMemo(
    () =>
      devices.flatMap((d) =>
        (d.state?.states ?? [])
          .filter((s) => s.alarm)
          .map((alarm) => ({
            device: d,
            alarm,
            apartmentName:
              apartments.find((a) => a.id === d.apartmentId)?.name ?? 'Без квартири',
          })),
      ),
    [devices, apartments],
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

  if (loading) return <div className="empty">Завантаження…</div>;
  if (!authed) return <Login />;

  const showTabs = apartments.length > 0 && view !== 'manage';

  return (
    <div className="app">
      <header className="topbar">
        <span className="topbar__brand">a7smart</span>
        <div className="topbar__actions">
          {view === 'home' && (
            <button
              type="button"
              className={`icon-btn${editMode ? ' ghost-btn--active' : ''}`}
              style={editMode ? { borderRadius: 8, background: 'var(--accent)', color: 'var(--on-accent)' } : undefined}
              onClick={() => setEditMode((v) => !v)}
              title={editMode ? 'Завершити редагування' : 'Порядок і назви'}
              aria-label={editMode ? 'Завершити редагування' : 'Порядок і назви'}
            >
              <Icon name={editMode ? 'check' : 'grip'} size={19} />
            </button>
          )}
          <button
            type="button"
            className={`icon-btn${unseenChangelog ? ' icon-btn--dot' : ''}`}
            onClick={() => setWhatsNewOpen(true)}
            title="Що нового"
            aria-label="Що нового"
          >
            <Icon name="info" size={19} />
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={cycle}
            title={THEME_LABEL[theme]}
            aria-label={THEME_LABEL[theme]}
          >
            <Icon name={THEME_ICON[theme]} size={19} />
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => void logout()}
            title="Вийти"
            aria-label="Вийти"
          >
            <Icon name="power" size={19} />
          </button>
        </div>
      </header>

      <h1 className="page-title">{VIEW_LABEL[view]}</h1>

      {error && <div className="banner">{error}</div>}

      {view === 'home' && activeAlerts.length > 0 && (
        <div className="alert-list">
          {activeAlerts.map(({ device, alarm, apartmentName }) => (
            <div className="alert-row" key={`${device.id}-${alarm.code}`}>
              <Icon name="alert" size={18} className="alert-row__icon" />
              <div className="alert-row__body">
                <span className="alert-row__title">{alarm.label}</span>
                <span className="alert-row__sub">
                  {device.name} · {apartmentName}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {showTabs && (
        <div className="tabs" role="tablist" aria-label="Квартири">
          <button
            type="button"
            role="tab"
            className="tab"
            aria-selected={activeApartmentId === null}
            onClick={() => setApartment(null)}
          >
            Усі
          </button>
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
        </div>
      )}

      {view === 'manage' && <ManageApartments />}

      {view === 'scenes' && (
        <Suspense fallback={<div className="empty">Завантаження…</div>}>
          <ScenesView devices={visible} activeApartmentId={activeApartmentId} />
        </Suspense>
      )}

      {view === 'energy' && (
        <Suspense fallback={<div className="empty">Завантаження…</div>}>
          <EnergyView apartments={apartments} activeApartmentId={activeApartmentId} />
        </Suspense>
      )}

      {view === 'history' && (
        <Suspense fallback={<div className="empty">Завантаження графіків…</div>}>
          <HistoryView devices={visible} />
        </Suspense>
      )}

      {view === 'home' && editMode && (
        <>
          <p className="card__sub" style={{ marginBottom: 12 }}>
            Тягніть за ручку, щоб змінити порядок. Торкніться назви, щоб перейменувати.
          </p>
          <EditGrid devices={visible} />
        </>
      )}

      {view === 'home' &&
        !editMode &&
        (devices.length === 0 ? (
          <div className="empty">
            Пристроїв немає. Перевірте прив'язку акаунта Smart Life у Tuya IoT Platform.
          </div>
        ) : visible.length === 0 ? (
          <div className="empty">
            У цій квартирі ще немає пристроїв. Додайте їх у розділі «Квартири».
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
        ))}

      <nav className="tabbar" role="tablist" aria-label="Розділи">
        {(Object.keys(VIEW_LABEL) as View[]).map((v) => (
          <button
            key={v}
            type="button"
            role="tab"
            className="tabbar__item"
            aria-selected={view === v}
            onClick={() => setView(v)}
          >
            <span className="tabbar__icon">
              <Icon name={VIEW_ICON[v]} size={22} strokeWidth={view === v ? 2 : 1.75} />
            </span>
            {VIEW_LABEL[v]}
          </button>
        ))}
      </nav>

      {whatsNewOpen && <WhatsNew onClose={() => setWhatsNewOpen(false)} />}
    </div>
  );
}

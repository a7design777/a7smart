import { useMemo, useState, type FormEvent } from 'react';
import { useStore } from '../store';
import { useDragAssign } from '../useDragAssign';
import { Icon, KIND_ICON } from './Icon';
import type { Device } from '../api';

/** Зона «без квартири» має свій ідентифікатор, бо null у dataset не передаси. */
const UNASSIGNED = 'none';

export function ManageApartments() {
  const apartments = useStore((s) => s.apartments);
  const devices = useStore((s) => s.devices);
  const addApartment = useStore((s) => s.addApartment);
  const removeApartment = useStore((s) => s.removeApartment);
  const setMain = useStore((s) => s.setMain);
  const assign = useStore((s) => s.assign);
  const syncDevices = useStore((s) => s.syncDevices);
  const mutedAlertDeviceIds = useStore((s) => s.mutedAlertDeviceIds);
  const unmuteDeviceAlerts = useStore((s) => s.unmuteDeviceAlerts);

  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  const mutedDevices = useMemo(
    () => devices.filter((d) => mutedAlertDeviceIds.includes(d.id)),
    [devices, mutedAlertDeviceIds],
  );

  async function onSync() {
    setSyncing(true);
    setSyncMessage(null);
    try {
      const added = await syncDevices();
      setSyncMessage(
        added > 0
          ? `Знайдено нових пристроїв: ${added}. Перетягніть їх із «Без квартири».`
          : 'Нових пристроїв не знайдено.',
      );
    } finally {
      setSyncing(false);
    }
  }

  const { drag, overZone, onPointerDown } = useDragAssign((deviceId, zone) => {
    void assign(deviceId, zone === UNASSIGNED ? null : Number(zone));
  });

  const byApartment = useMemo(() => {
    const map = new Map<string, Device[]>();
    map.set(UNASSIGNED, []);
    for (const a of apartments) map.set(String(a.id), []);
    for (const d of devices) {
      const key = d.apartmentId === null ? UNASSIGNED : String(d.apartmentId);
      (map.get(key) ?? map.get(UNASSIGNED)!).push(d);
    }
    return map;
  }, [apartments, devices]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      await addApartment(trimmed);
      setName('');
    } finally {
      setBusy(false);
    }
  }

  const renderZone = (
    zoneId: string,
    title: string,
    actions?: { isMain: boolean; onMain: () => void; onDelete: () => void },
  ) => {
    const list = byApartment.get(zoneId) ?? [];
    return (
      <div
        key={zoneId}
        data-zone={zoneId}
        className={`dropzone${overZone === zoneId ? ' dropzone--over' : ''}`}
      >
        <div className="dropzone__head">
          <span className="dropzone__title">
            {title}
            {actions?.isMain && <span className="badge-main">головна</span>}
          </span>
          <span className="card__sub">{list.length}</span>
        </div>

        {actions && (
          <div className="dropzone__actions">
            <button
              type="button"
              className={`ghost-btn${actions.isMain ? ' ghost-btn--active' : ''}`}
              onClick={actions.onMain}
              disabled={actions.isMain}
            >
              {actions.isMain ? 'Відкривається першою' : 'Зробити головною'}
            </button>
            <button type="button" className="ghost-btn" onClick={actions.onDelete}>
              Видалити
            </button>
          </div>
        )}

        <div className="chip-list">
          {list.length === 0 ? (
            <span className="card__sub">перетягніть пристрої сюди</span>
          ) : (
            list.map((d) => (
              <span
                key={d.id}
                className={`chip${drag?.id === d.id ? ' chip--dragging' : ''}`}
                onPointerDown={(e) => onPointerDown(e, d.id, d.name)}
              >
                <span className="chip__kind">
                  <Icon name={KIND_ICON[d.kind]} size={14} />
                </span>
                <span className="chip__label">{d.name}</span>
              </span>
            ))
          )}
        </div>
      </div>
    );
  };

  return (
    <>
      <form className="manage-head" onSubmit={(e) => void onCreate(e)}>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Назва квартири"
          maxLength={60}
        />
        <button type="submit" className="primary-btn" disabled={busy || !name.trim()}>
          Додати
        </button>
      </form>

      <div className="manage-head" style={{ marginBottom: 18, alignItems: 'center' }}>
        <button
          type="button"
          className="ghost-btn"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flex: '0 0 auto' }}
          onClick={() => void onSync()}
          disabled={syncing}
        >
          <Icon name="refresh" size={15} />
          {syncing ? 'Синхронізація…' : 'Синхронізувати пристрої'}
        </button>
        {syncMessage && <span className="card__sub">{syncMessage}</span>}
      </div>

      {apartments.map((a) =>
        renderZone(String(a.id), a.name, {
          isMain: a.is_main,
          onMain: () => void setMain(a.id),
          onDelete: () => {
            if (confirm(`Видалити «${a.name}»? Пристрої повернуться в «Без квартири».`)) {
              void removeApartment(a.id);
            }
          },
        }),
      )}

      {renderZone(UNASSIGNED, 'Без квартири')}

      {mutedDevices.length > 0 && (
        <div className="dropzone">
          <div className="dropzone__head">
            <span className="dropzone__title">Вимкнені сповіщення</span>
            <span className="card__sub">{mutedDevices.length}</span>
          </div>
          <div className="chip-list">
            {mutedDevices.map((d) => (
              <span key={d.id} className="chip">
                <span className="chip__kind">
                  <Icon name={KIND_ICON[d.kind]} size={14} />
                </span>
                <span className="chip__label">{d.name}</span>
                <button
                  type="button"
                  className="icon-btn icon-btn--sm"
                  title="Увімкнути сповіщення"
                  aria-label="Увімкнути сповіщення"
                  onClick={() => unmuteDeviceAlerts(d.id)}
                >
                  <Icon name="close" size={13} />
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Копія, що летить за вказівником. Поза потоком, тому не впливає
          на layout і не перехоплює події. */}
      {drag && (
        <span
          className="chip chip--ghost"
          style={{ left: drag.x + 12, top: drag.y - 16 }}
          aria-hidden="true"
        >
          <span className="chip__label">{drag.label}</span>
        </span>
      )}
    </>
  );
}

import { useMemo, useState, type FormEvent } from 'react';
import { useStore } from '../store';
import { useDragAssign } from '../useDragAssign';
import type { Device } from '../api';

const KIND_ICON: Record<Device['kind'], string> = {
  switch: '⏻',
  light: '☀',
  climate: '🌡',
  sensor: '◈',
  camera: '▣',
  unknown: '·',
};

/** Зона «без квартири» має свій ідентифікатор, бо null у dataset не передаси. */
const UNASSIGNED = 'none';

export function ManageApartments() {
  const apartments = useStore((s) => s.apartments);
  const devices = useStore((s) => s.devices);
  const addApartment = useStore((s) => s.addApartment);
  const removeApartment = useStore((s) => s.removeApartment);
  const assign = useStore((s) => s.assign);

  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

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

  const renderZone = (zoneId: string, title: string, onDelete?: () => void) => {
    const list = byApartment.get(zoneId) ?? [];
    return (
      <div
        key={zoneId}
        data-zone={zoneId}
        className={`dropzone${overZone === zoneId ? ' dropzone--over' : ''}`}
      >
        <div className="dropzone__head">
          <span className="dropzone__title">{title}</span>
          <span className="card__sub">
            {list.length}
            {onDelete && (
              <button
                type="button"
                className="ghost-btn"
                style={{ marginLeft: 8 }}
                onClick={onDelete}
              >
                Видалити
              </button>
            )}
          </span>
        </div>

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
                <span className="chip__kind">{KIND_ICON[d.kind]}</span>
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

      {apartments.map((a) =>
        renderZone(String(a.id), a.name, () => {
          if (confirm(`Видалити «${a.name}»? Пристрої повернуться в «Без квартири».`)) {
            void removeApartment(a.id);
          }
        }),
      )}

      {renderZone(UNASSIGNED, 'Без квартири')}

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

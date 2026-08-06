import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import type { Device, Scene, SceneAction } from '../api';

/**
 * Сценарії: іменований набір дій, що виконується однією кнопкою.
 *
 * Розкладів і тригерів тут немає — це ручні сценарії. Автоматизації за
 * часом чи подією потребують окремого рушія на сервері, і змішувати їх
 * сюди означало б закласти складність наперед.
 */
export function ScenesView({ devices }: { devices: Device[] }) {
  const scenes = useStore((s) => s.scenes);
  const loadScenes = useStore((s) => s.loadScenes);
  const runScene = useStore((s) => s.runScene);
  const removeScene = useStore((s) => s.removeScene);
  const [editing, setEditing] = useState<Scene | 'new' | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  useEffect(() => {
    void loadScenes();
  }, [loadScenes]);

  async function run(id: number) {
    setBusyId(id);
    try {
      await runScene(id);
    } finally {
      setBusyId(null);
    }
  }

  if (editing) {
    return (
      <SceneEditor
        scene={editing === 'new' ? null : editing}
        devices={devices}
        onDone={() => setEditing(null)}
      />
    );
  }

  return (
    <>
      <button
        type="button"
        className="primary-btn"
        style={{ width: '100%', marginBottom: 14 }}
        onClick={() => setEditing('new')}
      >
        Новий сценарій
      </button>

      {scenes.length === 0 ? (
        <div className="empty">
          Сценаріїв ще немає. Сценарій — це набір дій: наприклад, «Йду з дому» вимикає
          світло й опалення одним натисканням.
        </div>
      ) : (
        <div className="grid grid--wide">
          {scenes.map((scene) => (
            <div className="card" key={scene.id}>
              <div className="row">
                <span className="card__name">{scene.name}</span>
                <span className="card__sub">{scene.actions.length} дій</span>
              </div>
              <div className="dropzone__actions" style={{ margin: 0 }}>
                <button
                  type="button"
                  className="primary-btn"
                  style={{ flex: 1 }}
                  disabled={busyId === scene.id || scene.actions.length === 0}
                  onClick={() => void run(scene.id)}
                >
                  {busyId === scene.id ? 'Виконую…' : 'Запустити'}
                </button>
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={() => setEditing(scene)}
                >
                  Змінити
                </button>
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={() => {
                    if (confirm(`Видалити сценарій «${scene.name}»?`)) {
                      void removeScene(scene.id);
                    }
                  }}
                >
                  Видалити
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/** Дії, які можна записати в сценарій, зібрані з поточного стану пристрою. */
function availableActions(device: Device): Array<{ action: SceneAction; label: string }> {
  const out: Array<{ action: SceneAction; label: string }> = [];
  const state = device.state;
  if (!state) return out;

  for (const gang of state.gangs) {
    for (const on of [true, false]) {
      const value = on ? gang.onValue : gang.offValue;
      out.push({
        action: {
          device_id: device.id,
          code: gang.code,
          value: String(value),
          value_type: typeof value === 'boolean' ? 'boolean' : 'string',
        },
        label: `${gang.label}: ${on ? 'увімкнути' : 'вимкнути'}`,
      });
    }
  }

  for (const opt of state.options) {
    for (const choice of opt.choices) {
      out.push({
        action: {
          device_id: device.id,
          code: opt.code,
          value: choice.value,
          value_type: 'string',
        },
        label: `${opt.label}: ${choice.label}`,
      });
    }
  }

  return out;
}

function SceneEditor({
  scene,
  devices,
  onDone,
}: {
  scene: Scene | null;
  devices: Device[];
  onDone: () => void;
}) {
  const saveScene = useStore((s) => s.saveScene);
  const [name, setName] = useState(scene?.name ?? '');
  const [actions, setActions] = useState<SceneAction[]>(scene?.actions ?? []);
  const [busy, setBusy] = useState(false);

  const byId = useMemo(() => new Map(devices.map((d) => [d.id, d])), [devices]);

  /** Пристрої, якими є що керувати. Датчики в сценарії додавати нема сенсу. */
  const controllable = useMemo(
    () => devices.filter((d) => availableActions(d).length > 0),
    [devices],
  );

  function describe(action: SceneAction): string {
    const device = byId.get(action.device_id);
    const match = device
      ? availableActions(device).find(
          (a) => a.action.code === action.code && a.action.value === action.value,
        )
      : undefined;
    return `${device?.name ?? action.device_id} — ${match?.label ?? `${action.code}=${action.value}`}`;
  }

  async function save() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      await saveScene(scene?.id ?? null, { name: trimmed, apartmentId: null, actions });
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="manage-head">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Назва сценарію"
          maxLength={60}
        />
        <button type="button" className="primary-btn" disabled={busy || !name.trim()} onClick={() => void save()}>
          Зберегти
        </button>
        <button type="button" className="ghost-btn" onClick={onDone}>
          Скасувати
        </button>
      </div>

      <h2 className="section-title">Дії ({actions.length})</h2>
      {actions.length === 0 ? (
        <div className="card__sub" style={{ marginBottom: 14 }}>
          Оберіть дії нижче. Виконуються послідовно, згори вниз.
        </div>
      ) : (
        <div className="chip-list" style={{ marginBottom: 14 }}>
          {actions.map((a, i) => (
            <span className="chip" key={`${a.device_id}-${a.code}-${i}`} style={{ cursor: 'default' }}>
              <span className="chip__label">{describe(a)}</span>
              <button
                type="button"
                className="chip__remove"
                aria-label="Прибрати дію"
                onClick={() => setActions((prev) => prev.filter((_, idx) => idx !== i))}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <h2 className="section-title">Додати дію</h2>
      {controllable.length === 0 ? (
        <div className="empty">Немає пристроїв, якими можна керувати</div>
      ) : (
        controllable.map((device) => (
          <div className="dropzone" key={device.id}>
            <div className="dropzone__head">
              <span className="dropzone__title">{device.name}</span>
            </div>
            <div className="chip-list">
              {availableActions(device).map(({ action, label }) => (
                <button
                  type="button"
                  className="chip"
                  key={`${action.code}-${action.value}`}
                  onClick={() => setActions((prev) => [...prev, action])}
                >
                  <span className="chip__label">{label}</span>
                </button>
              ))}
            </div>
          </div>
        ))
      )}
    </>
  );
}

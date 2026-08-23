import { useState } from 'react';
import { useStore } from '../store';
import { useDragSort } from '../useDragSort';
import { Icon, KIND_ICON } from './Icon';
import type { Device } from '../api';

/**
 * Режим редагування дашборда: порядок і назви.
 *
 * Керування тут навмисно недоступне. Змішувати перетягування з
 * перемикачами на телефоні небезпечно: палець легко зачепить вимикач
 * замість того, щоб перетягнути картку.
 *
 * Перетягування починається лише з ручки — інакше не було б як
 * поставити курсор у поле назви.
 */
export function EditGrid({ devices }: { devices: Device[] }) {
  const setOrder = useStore((s) => s.setOrder);
  const commitOrder = useStore((s) => s.commitOrder);
  const rename = useStore((s) => s.rename);

  const ids = devices.map((d) => d.id);
  const { draggingId, onPointerDown } = useDragSort({
    ids,
    onPreview: setOrder,
    onCommit: () => void commitOrder(),
  });

  return (
    <div className="edit-list">
      {devices.map((d) => (
        <EditRow
          key={d.id}
          device={d}
          dragging={draggingId === d.id}
          onHandleDown={(e) => onPointerDown(e, d.id)}
          onRename={(name) => void rename(d.id, name)}
        />
      ))}
    </div>
  );
}

function EditRow({
  device,
  dragging,
  onHandleDown,
  onRename,
}: {
  device: Device;
  dragging: boolean;
  onHandleDown: (e: React.PointerEvent<HTMLElement>) => void;
  onRename: (name: string) => void;
}) {
  const [draft, setDraft] = useState(device.name);

  function commit() {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== device.name) {
      onRename(trimmed);
    } else {
      setDraft(device.name);
    }
  }

  return (
    <div
      data-sort-id={device.id}
      className={`edit-row${dragging ? ' edit-row--dragging' : ''}`}
    >
      <span
        className="edit-row__handle"
        onPointerDown={onHandleDown}
        role="button"
        tabIndex={-1}
        aria-label={`Перетягнути ${device.name}`}
        title="Перетягнути"
      >
        <Icon name="grip" size={18} />
      </span>
      <span className="edit-row__icon">
        <Icon name={KIND_ICON[device.kind]} size={17} />
      </span>
      <input
        type="text"
        className="edit-row__input"
        value={draft}
        maxLength={60}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            setDraft(device.name);
            e.currentTarget.blur();
          }
        }}
        aria-label={`Назва: ${device.name}`}
      />
    </div>
  );
}

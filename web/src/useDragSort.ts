import { useCallback, useRef, useState } from 'react';

/**
 * Перетягування для зміни порядку.
 *
 * Як і в перетягуванні по квартирах — Pointer Events, а не HTML5 DnD:
 * останній не працює на тач-екранах. Ціль визначається через
 * elementFromPoint, бо під час захоплення вказівника сусідні картки
 * власних подій не отримують.
 *
 * Порядок змінюється просто під пальцем, а на сервер відправляється
 * один раз — коли користувач відпустив.
 */

const DRAG_THRESHOLD_PX = 6;

export function useDragSort(opts: {
  ids: string[];
  onPreview: (ids: string[]) => void;
  onCommit: (ids: string[]) => void;
}) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const activeRef = useRef(false);
  const orderRef = useRef<string[]>(opts.ids);
  orderRef.current = opts.ids;

  const idAt = (x: number, y: number): string | null => {
    const el = document.elementFromPoint(x, y);
    return el?.closest<HTMLElement>('[data-sort-id]')?.dataset.sortId ?? null;
  };

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>, id: string) => {
      if (e.button !== 0) return;

      startRef.current = { x: e.clientX, y: e.clientY };
      activeRef.current = false;
      const target = e.currentTarget;
      try {
        target.setPointerCapture(e.pointerId);
      } catch {
        /* захоплення не критичне */
      }

      const move = (ev: PointerEvent) => {
        const start = startRef.current;
        if (!start) return;

        if (!activeRef.current) {
          if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < DRAG_THRESHOLD_PX) return;
          activeRef.current = true;
          setDraggingId(id);
        }

        const overId = idAt(ev.clientX, ev.clientY);
        if (!overId || overId === id) return;

        const current = orderRef.current;
        const from = current.indexOf(id);
        const to = current.indexOf(overId);
        if (from < 0 || to < 0) return;

        const next = [...current];
        next.splice(to, 0, ...next.splice(from, 1));
        opts.onPreview(next);
      };

      const up = (ev: PointerEvent) => {
        target.releasePointerCapture?.(ev.pointerId);
        target.removeEventListener('pointermove', move);
        target.removeEventListener('pointerup', up);
        target.removeEventListener('pointercancel', up);

        if (activeRef.current) opts.onCommit(orderRef.current);

        activeRef.current = false;
        startRef.current = null;
        setDraggingId(null);
      };

      target.addEventListener('pointermove', move);
      target.addEventListener('pointerup', up);
      target.addEventListener('pointercancel', up);
    },
    [opts],
  );

  return { draggingId, onPointerDown };
}

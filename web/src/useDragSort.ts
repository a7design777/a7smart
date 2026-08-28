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

/**
 * Авто-скрол біля країв екрана під час перетягування.
 *
 * Список у режимі редагування довший за екран (40+ пристроїв), а
 * перетягування — лише в межах видимої області: без цього перенести
 * картку з середини списку на початок фізично неможливо, палець
 * впирається у верх/низ екрана й далі рухатись нема куди.
 */
const SCROLL_EDGE_PX = 70;
const SCROLL_SPEED_PX = 14;

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

  const lastPointRef = useRef({ x: 0, y: 0 });
  const scrollRafRef = useRef<number | null>(null);

  const idAt = (x: number, y: number): string | null => {
    const el = document.elementFromPoint(x, y);
    return el?.closest<HTMLElement>('[data-sort-id]')?.dataset.sortId ?? null;
  };

  /** Реордер під поточними координатами вказівника (і після авто-скролу теж). */
  const reorderUnderPointer = (draggedId: string) => {
    const { x, y } = lastPointRef.current;
    const overId = idAt(x, y);
    if (!overId || overId === draggedId) return;

    const current = orderRef.current;
    const from = current.indexOf(draggedId);
    const to = current.indexOf(overId);
    if (from < 0 || to < 0) return;

    const next = [...current];
    next.splice(to, 0, ...next.splice(from, 1));
    opts.onPreview(next);
  };

  const stopAutoScroll = () => {
    if (scrollRafRef.current !== null) {
      cancelAnimationFrame(scrollRafRef.current);
      scrollRafRef.current = null;
    }
  };

  const startAutoScroll = (draggedId: string) => {
    const tick = () => {
      const { y } = lastPointRef.current;
      const vh = window.innerHeight;
      if (y < SCROLL_EDGE_PX) {
        window.scrollBy(0, -SCROLL_SPEED_PX * (1 - y / SCROLL_EDGE_PX));
        reorderUnderPointer(draggedId);
      } else if (y > vh - SCROLL_EDGE_PX) {
        window.scrollBy(0, SCROLL_SPEED_PX * (1 - (vh - y) / SCROLL_EDGE_PX));
        reorderUnderPointer(draggedId);
      }
      scrollRafRef.current = requestAnimationFrame(tick);
    };
    scrollRafRef.current = requestAnimationFrame(tick);
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

        lastPointRef.current = { x: ev.clientX, y: ev.clientY };

        if (!activeRef.current) {
          if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < DRAG_THRESHOLD_PX) return;
          activeRef.current = true;
          setDraggingId(id);
          startAutoScroll(id);
        }

        reorderUnderPointer(id);
      };

      const up = (ev: PointerEvent) => {
        target.releasePointerCapture?.(ev.pointerId);
        target.removeEventListener('pointermove', move);
        target.removeEventListener('pointerup', up);
        target.removeEventListener('pointercancel', up);
        stopAutoScroll();

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

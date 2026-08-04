import { useCallback, useRef, useState } from 'react';

/**
 * Перетягування пристроїв на Pointer Events.
 *
 * Нативний HTML5 drag-and-drop тут не годиться: на тач-екранах він не
 * працює взагалі, а дашборд відкривають переважно з телефона. Pointer
 * Events дають один код і для миші, і для пальця.
 *
 * Ціль визначаємо через elementFromPoint, а не через події зон: під час
 * захоплення вказівника (setPointerCapture) зони власних подій не
 * отримують.
 */

export interface DragState {
  id: string;
  label: string;
  x: number;
  y: number;
}

/** Зсув, після якого жест вважається перетягуванням, а не тапом. */
const DRAG_THRESHOLD_PX = 6;

export function useDragAssign(onDrop: (deviceId: string, zoneId: string) => void) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const [overZone, setOverZone] = useState<string | null>(null);

  const startRef = useRef<{ x: number; y: number } | null>(null);
  const activeRef = useRef(false);

  const zoneAt = (x: number, y: number): string | null => {
    const el = document.elementFromPoint(x, y);
    const zone = el?.closest<HTMLElement>('[data-zone]');
    return zone?.dataset.zone ?? null;
  };

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>, id: string, label: string) => {
      // Тільки основна кнопка миші; правий клік не має тягнути.
      if (e.button !== 0) return;

      startRef.current = { x: e.clientX, y: e.clientY };
      activeRef.current = false;
      const target = e.currentTarget;
      // Захоплення вказівника не критичне: без нього drag теж працює,
      // просто гірше переживає вихід за межі елемента.
      try {
        target.setPointerCapture(e.pointerId);
      } catch {
        /* деякі середовища відхиляють захоплення — не привід ламати жест */
      }

      const move = (ev: PointerEvent) => {
        const start = startRef.current;
        if (!start) return;

        if (!activeRef.current) {
          const moved = Math.hypot(ev.clientX - start.x, ev.clientY - start.y);
          if (moved < DRAG_THRESHOLD_PX) return;
          activeRef.current = true;
        }

        setDrag({ id, label, x: ev.clientX, y: ev.clientY });
        setOverZone(zoneAt(ev.clientX, ev.clientY));
      };

      const up = (ev: PointerEvent) => {
        target.releasePointerCapture?.(ev.pointerId);
        target.removeEventListener('pointermove', move);
        target.removeEventListener('pointerup', up);
        target.removeEventListener('pointercancel', up);

        if (activeRef.current) {
          const zone = zoneAt(ev.clientX, ev.clientY);
          if (zone) onDrop(id, zone);
        }

        activeRef.current = false;
        startRef.current = null;
        setDrag(null);
        setOverZone(null);
      };

      target.addEventListener('pointermove', move);
      target.addEventListener('pointerup', up);
      target.addEventListener('pointercancel', up);
    },
    [onDrop],
  );

  return { drag, overZone, onPointerDown };
}

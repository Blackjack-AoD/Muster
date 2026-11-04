// Horizontal swipe on a row (touch or pen), leaving vertical scrolling alone.
import { useRef, useState } from 'preact/hooks';

export const SWIPE = 90; // px past which a swipe counts

export function useSwipe({ onLeft, onRight }: { onLeft?: () => void; onRight?: () => void }) {
  const [dx, setDx] = useState(0);
  const drag = useRef<{ x: number; y: number; id: number; swiping: boolean } | null>(null);
  const suppress = useRef(false);
  const last = useRef(0);
  const clamp = (v: number) => Math.max(onLeft ? -160 : 0, Math.min(onRight ? 160 : 0, v));

  const handlers = {
    onPointerDown: (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      drag.current = { x: e.clientX, y: e.clientY, id: e.pointerId, swiping: false };
    },
    onPointerMove: (e: PointerEvent) => {
      const d = drag.current;
      if (!d || d.id !== e.pointerId) return;
      const mx = e.clientX - d.x;
      const my = e.clientY - d.y;
      if (!d.swiping) {
        if (Math.abs(my) > 10 && Math.abs(my) > Math.abs(mx)) {
          drag.current = null;
          return;
        } // scrolling
        if (Math.abs(mx) < 12 || !clamp(mx)) return;
        d.swiping = true;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      }
      last.current = clamp(mx);
      setDx(last.current);
    },
    onPointerUp: () => {
      const d = drag.current;
      drag.current = null;
      if (!d?.swiping) return;
      const x = last.current;
      last.current = 0;
      setDx(0);
      if (x <= -SWIPE) onLeft?.();
      else if (x >= SWIPE) onRight?.();
      // the click that follows a swipe shouldn't also count as a tap
      suppress.current = true;
      setTimeout(() => (suppress.current = false), 60);
    },
    onPointerCancel: () => {
      drag.current = null;
      last.current = 0;
      setDx(0);
    },
  };
  /** wrap a click handler so it ignores the click at the end of a swipe */
  const tap = (fn: () => void) => () => {
    if (!suppress.current) fn();
  };
  return { dx, handlers, tap };
}

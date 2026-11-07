import type { ComponentChildren } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';
import { back, go, pushSheetState } from '../app';
import { Icon } from './Icon';

export function Link({
  to,
  replace,
  class: cls,
  children,
}: {
  to: string;
  replace?: boolean;
  class?: string;
  children: ComponentChildren;
}) {
  return (
    <a
      class={cls}
      href={'#' + to}
      onClick={(e) => {
        e.preventDefault();
        go(to, replace);
      }}
    >
      {children}
    </a>
  );
}

export function TopBar({
  title,
  sub,
  onBack,
  backTo,
  right,
}: {
  title: ComponentChildren;
  sub?: ComponentChildren;
  onBack?: () => void;
  backTo?: string;
  right?: ComponentChildren;
}) {
  const hasBack = onBack || backTo;
  return (
    <header class="topbar">
      {hasBack && (
        <button class="icon-btn" aria-label="Back" onClick={() => (onBack ? onBack() : back(backTo))}>
          <Icon name="back" />
        </button>
      )}
      <div class={'topbar-title' + (hasBack ? '' : ' pad')}>
        <h1>{title}</h1>
        {sub && <div class="sub">{sub}</div>}
      </div>
      <div class="topbar-right">{right}</div>
    </header>
  );
}

let sheetSeq = 0;
/** a sheet that just closed itself: its history step is released a moment later unless another sheet takes it over */
let releasing: { cancelled: boolean } | null = null;

/** A ref to the latest value, for effects that run once and must not hold on to a stale one. */
function useLatest<T>(value: T) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

/** Gives a sheet its own history step, so the phone's back button closes it instead of leaving the page. */
function useSheetHistory(onClose: () => void) {
  const close = useLatest(onClose);
  const id = useRef(0);
  const popped = useRef(false);
  // Back can close a picker shown inside the sheet and leave the sheet up, which then needs a step of its own again.
  useLayoutEffect(() => {
    if (!popped.current) return;
    popped.current = false;
    pushSheetState(id.current);
  });
  // layout effect: runs in the same commit as a previous sheet's cleanup, so one sheet can hand its step to the next
  useLayoutEffect(() => {
    // Navigating from inside a sheet should use go(path, true), which replaces this step.
    id.current = ++sheetSeq;
    if (releasing) {
      releasing.cancelled = true;
      releasing = null;
      history.replaceState({ sheet: id.current }, '', location.href);
    } else pushSheetState(id.current);
    const onPop = () => {
      if (history.state?.sheet === id.current) return;
      popped.current = true;
      close.current();
    };
    addEventListener('popstate', onPop);
    return () => {
      removeEventListener('popstate', onPop);
      // closed with the X, a tap outside or a choice: take our history step back off
      if (!popped.current && history.state?.sheet === id.current) {
        const r = (releasing = { cancelled: false });
        queueMicrotask(() => {
          if (r.cancelled) return;
          releasing = null;
          history.back();
        });
      }
    };
  }, []);
}

export function Sheet({
  title,
  onClose,
  children,
  full,
  footer,
}: {
  title: ComponentChildren;
  onClose: () => void;
  children: ComponentChildren;
  full?: boolean;
  /** Stays on screen below the body, however far the body scrolls. */
  footer?: ComponentChildren;
}) {
  const close = useLatest(onClose);
  useSheetHistory(onClose);
  useLayoutEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && close.current();
    addEventListener('keydown', k);
    document.body.classList.add('locked');
    return () => {
      removeEventListener('keydown', k);
      document.body.classList.remove('locked');
    };
  }, []);
  return (
    <div class="sheet-wrap" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div
        class={'sheet' + (full ? ' full' : '')}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
      >
        <div class="sheet-head">
          <h2>{title}</h2>
          <button class="icon-btn" aria-label="Close" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
        <div class="sheet-body">{children}</div>
        {footer && <div class="sheet-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ComponentChildren }) {
  return (
    <div class="empty">
      <div class="empty-mark">
        <Icon name="shield" size={40} />
      </div>
      <h3>{title}</h3>
      {children}
    </div>
  );
}

export function Loading({ label }: { label?: string }) {
  return (
    <div class="center-fill">
      <div class="spinner" />
      {label && <p class="muted">{label}</p>}
    </div>
  );
}

export function Pts({ v, limit }: { v: number; limit?: number }) {
  const over = limit && limit > 0 && v > limit;
  return (
    <span class={'pts' + (over ? ' over' : '')}>
      {fmtN(v)}
      {limit && limit > 0 ? <span class="lim">/{fmtN(limit)}</span> : null}
      <span class="u">pts</span>
    </span>
  );
}

export function fmtN(n: number) {
  return Number.isInteger(n) ? n.toLocaleString('en-GB') : n.toFixed(1);
}

export function ago(t?: number) {
  if (!t) return 'never';
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

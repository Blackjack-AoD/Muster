import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import { back, go, pushSheetState } from '../app';
import { Icon } from './Icon';

export function Link({ to, replace, class: cls, children }: { to: string; replace?: boolean; class?: string; children: ComponentChildren }) {
  return (
    <a class={cls} href={'#' + to} onClick={(e) => { e.preventDefault(); go(to, replace); }}>
      {children}
    </a>
  );
}

export function TopBar({ title, sub, onBack, backTo, right }: {
  title: ComponentChildren; sub?: ComponentChildren; onBack?: () => void; backTo?: string; right?: ComponentChildren;
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

export function Sheet({ title, onClose, children, full }: { title: ComponentChildren; onClose: () => void; children: ComponentChildren; full?: boolean }) {
  const close = useRef(onClose);
  close.current = onClose;
  // layout effect: runs in the same commit as a previous sheet's cleanup, so one sheet can hand its step to the next
  useLayoutEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && close.current();
    addEventListener('keydown', k);
    document.body.classList.add('locked');
    // The sheet gets its own history step, so the phone's back button closes it instead of leaving the page.
    // Navigating from inside a sheet should use go(path, true), which replaces this step.
    const id = ++sheetSeq;
    if (releasing) {
      releasing.cancelled = true;
      releasing = null;
      history.replaceState({ sheet: id }, '', location.href);
    } else pushSheetState(id);
    let popped = false;
    const onPop = () => {
      if (history.state?.sheet === id) return;
      popped = true;
      close.current();
    };
    addEventListener('popstate', onPop);
    return () => {
      removeEventListener('keydown', k);
      removeEventListener('popstate', onPop);
      document.body.classList.remove('locked');
      // closed with the X, a tap outside or a choice: take our history step back off
      if (!popped && history.state?.sheet === id) {
        const r = (releasing = { cancelled: false });
        queueMicrotask(() => {
          if (r.cancelled) return;
          releasing = null;
          history.back();
        });
      }
    };
  }, []);
  return (
    <div class="sheet-wrap" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class={'sheet' + (full ? ' full' : '')} role="dialog" aria-modal="true">
        <div class="sheet-head">
          <h2>{title}</h2>
          <button class="icon-btn" aria-label="Close" onClick={onClose}><Icon name="x" /></button>
        </div>
        <div class="sheet-body">{children}</div>
      </div>
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ComponentChildren }) {
  return (
    <div class="empty">
      <div class="empty-mark"><Icon name="shield" size={40} /></div>
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

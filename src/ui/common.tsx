import type { ComponentChildren } from 'preact';
import { useEffect } from 'preact/hooks';
import { back, go } from '../app';
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

export function Sheet({ title, onClose, children, full }: { title: ComponentChildren; onClose: () => void; children: ComponentChildren; full?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    addEventListener('keydown', k);
    document.body.classList.add('locked');
    return () => { removeEventListener('keydown', k); document.body.classList.remove('locked'); };
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

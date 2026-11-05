import type { RepoState } from '../data/db';
import type { RSel } from '../data/engine';
import type { Roster } from '../data/engine';
import type { RosterCtl } from '../store';
import { failureMessage, toast } from '../store';
import { catalogueName } from './Lists';

const clean = (s: string) => s.replace(/[:\s]+$/, '');
const n = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

/** Plain-text list, easy to paste into chat apps. */
export function rosterText(ctl: RosterCtl, repos: RepoState[]): string {
  const { roster, ev } = ctl;
  const lines: string[] = [];
  lines.push(`${roster.name} — ${n(ev.total)}${roster.costLimit > 0 ? '/' + n(roster.costLimit) : ''} pts`);
  for (const rf of ev.forces) {
    lines.push(
      '',
      `== ${rf.entry.name} · ${catalogueName(repos, roster.repo, rf.force.catalogueId)} (${n(rf.total)} pts) ==`,
    );
    const cats = rf.entry.categoryLinks.map((c) => c.targetId);
    const done = new Set<RSel>();
    const unitLines = (u: RSel) => {
      lines.push(`${u.sel.number > 1 ? u.sel.number + '× ' : ''}${u.eff.name} [${n(u.total)}]`);
      // counts are totals: 5 models each with a bolter print as 5× Bolter
      const walk = (r: RSel, depth: number, mult: number) => {
        for (const c of r.children) {
          const k = c.sel.number * mult;
          lines.push(
            `${'  '.repeat(depth)}• ${k > 1 ? k + '× ' : ''}${c.eff.name}${c.total ? ` (${n(c.total * mult)})` : ''}`,
          );
          walk(c, depth + 1, k);
        }
      };
      walk(u, 1, u.sel.number);
    };
    for (const c of cats) {
      const units = rf.roots.filter((r) => (r.eff.primary ?? '') === c);
      if (!units.length) continue;
      lines.push('', `-- ${clean(rf.ctx.categoryName(c))} --`);
      units.forEach((u) => {
        done.add(u);
        unitLines(u);
      });
    }
    const rest = rf.roots.filter((r) => !done.has(r));
    if (rest.length) {
      lines.push('', '-- Other --');
      rest.forEach(unitLines);
    }
  }
  const errs = ev.issues.filter((i) => i.level === 'error');
  if (errs.length) lines.push('', `(${errs.length} unresolved issue${errs.length > 1 ? 's' : ''})`);
  lines.push('', 'Built with Muster');
  return lines.join('\n');
}

export const isCancelled = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';

export async function shareText(text: string, title: string) {
  try {
    if (navigator.share) {
      await navigator.share({ title, text });
    } else {
      await navigator.clipboard.writeText(text);
      toast('Copied to clipboard');
    }
  } catch (e) {
    if (!isCancelled(e)) toast(failureMessage('share', e));
  }
}

export function downloadJson(name: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
}

export async function shareBackup(rosters: Roster[]) {
  const name = `muster-lists-${new Date().toISOString().slice(0, 10)}.json`;
  const file = new File([JSON.stringify({ app: 'muster', version: 1, rosters }, null, 1)], name, {
    type: 'application/json',
  });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Muster lists backup' });
      return;
    }
  } catch (e) {
    if (isCancelled(e)) return;
    toast(failureMessage('share', e));
  }
  downloadJson(name, { app: 'muster', version: 1, rosters });
}

// Army sheet: every unit with its points, wargear, stats and rules, plus a rules reference.
// Shown from a list (with Print / Share), and from a shared link (no game data needed).
import { useEffect, useErrorBoundary, useMemo, useState } from 'preact/hooks';
import { go } from '../app';
import { failureMessage, toast, useRosterCtl, useStore } from '../store';
import { Loading, TopBar, fmtN } from './common';
import { isCancelled } from './exporter';
import { Icon } from './Icon';
import { StatBlock } from './StatBlock';
import {
  buildSnapshot,
  decodeSnapshot,
  encodeSnapshot,
  viewUrl,
  type Snapshot,
  type SnapProfile,
  type SnapUnit,
} from './snapshot';

export function ArmySheet({ snap }: { snap: Snapshot }) {
  const ruleText = new Map(snap.rules ?? []);
  return (
    <article class="army-sheet">
      <header class="as-head">
        <h1>{snap.name}</h1>
        <p>{snap.game}</p>
        <p class="as-pts">
          <b>{fmtN(snap.pts)}</b>
          {snap.limit > 0 ? ` / ${fmtN(snap.limit)}` : ''} pts
          {snap.issues > 0 && (
            <span class="as-issues">
              {' '}
              · {snap.issues} unresolved issue{snap.issues === 1 ? '' : 's'}
            </span>
          )}
        </p>
      </header>
      {snap.forces.map((f) => (
        <section class="as-force">
          <h2>
            {f.name}{' '}
            <small>
              · {f.army} · {fmtN(f.pts)} pts
            </small>
          </h2>
          {f.setup && f.setup.length > 0 && <p class="as-setup">{f.setup.join(' · ')}</p>}
          {f.units.map((u) => (
            <UnitCard u={u} />
          ))}
        </section>
      ))}
      {ruleText.size > 0 && (
        <section class="as-rules">
          <h2>Rules reference</h2>
          {[...ruleText].map(([name, text]) => (
            <div class="as-rule">
              <b>{name}</b>
              <p>{text}</p>
            </div>
          ))}
        </section>
      )}
      <footer class="as-foot">
        Made with Muster ·{' '}
        {new Date(snap.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
      </footer>
    </article>
  );
}

function UnitCard({ u }: { u: SnapUnit }) {
  // profiles grouped by type: unit stats first, then weapons, then the rest
  const types = [...new Set(u.profiles.map((p) => p.type))];
  const rank = (t: string) =>
    /unit|model|vehicle|knight|titan|walker|infantry|primarch/i.test(t) ? 0 : /weapon/i.test(t) ? 1 : 2;
  types.sort((a, b) => rank(a) - rank(b));
  const asStat = (p: SnapProfile) => ({
    name: p.name,
    characteristics: p.chars.map(([name, value]) => ({ name, value })),
  });
  // wordy wargear descriptions are already in the rules/wargear lines; keep the sheet to stat grids
  const statTypes = types.filter(
    (t) => rank(t) < 2 || u.profiles.filter((p) => p.type === t).every((p) => p.chars.every(([, v]) => v.length <= 12)),
  );
  return (
    <div class="as-unit">
      <div class="as-unit-head">
        <div>
          <b>{u.name}</b>
          {u.cat && <small> · {u.cat}</small>}
        </div>
        {u.pts ? <span class="as-unit-pts">{fmtN(u.pts)}</span> : null}
      </div>
      {u.gear.length > 0 && (
        <ul class="as-gear">
          {u.gear.map((g) => (
            <li style={{ paddingLeft: `${g.d * 14}px` }}>{g.t}</li>
          ))}
        </ul>
      )}
      {statTypes.map((t) => (
        <div class="as-stats">
          <StatBlock profiles={u.profiles.filter((p) => p.type === t).map(asStat)} />
        </div>
      ))}
      {u.rules.length > 0 && (
        <p class="as-unit-rules">
          <span>Rules:</span> {u.rules.join(', ')}
        </p>
      )}
    </div>
  );
}

async function shareLink(snap: Snapshot) {
  try {
    const { data, withRules } = await encodeSnapshot(snap);
    const url = viewUrl(data);
    if (navigator.share) {
      await navigator.share({ title: snap.name, text: `${snap.name} · ${fmtN(snap.pts)} pts`, url });
      if (!withRules) toast('Link shared. Rule text was left out to keep it short');
    } else {
      await navigator.clipboard.writeText(url);
      toast(withRules ? 'Link copied' : 'Link copied (rule text left out to keep it short)');
    }
  } catch (e) {
    if (!isCancelled(e)) toast(failureMessage('share', e));
  }
}

function Actions({ snap }: { snap: Snapshot }) {
  return (
    <div class="as-actions no-print">
      <button class="btn grow" onClick={() => window.print()}>
        <Icon name="list" /> Print / save PDF
      </button>
      <button class="btn grow" onClick={() => shareLink(snap)}>
        <Icon name="share" /> Share link
      </button>
    </div>
  );
}

/** Army sheet for one of your lists. */
export function SheetPage({ rosterUid }: { rosterUid: string }) {
  const roster = useStore((s) => s.rosters.find((r) => r.uid === rosterUid));
  const repos = useStore((s) => s.repos);
  const { ctl, error, loading } = useRosterCtl(roster, true);
  const snap = useMemo(() => (ctl ? buildSnapshot(ctl, repos) : undefined), [ctl?.ev, repos]);
  const backTo = `/r/${rosterUid}`;
  if (loading)
    return (
      <div class="page">
        <TopBar title="Army sheet" backTo={backTo} />
        <Loading label="Preparing…" />
      </div>
    );
  if (!snap)
    return (
      <div class="page">
        <TopBar title="Army sheet" backTo={backTo} />
        <p class="error-text pad">{error}</p>
      </div>
    );
  return (
    <div class="page sheet-page">
      <div class="no-print">
        <TopBar title="Army sheet" sub={snap.name} backTo={backTo} />
      </div>
      <Actions snap={snap} />
      <p class="muted small pad-x no-print">To save a PDF, pick Print, then "Save as PDF" as the printer.</p>
      <ArmySheet snap={snap} />
    </div>
  );
}

/** A list someone shared as a link: shown without needing any game data. */
export function SharedView({ data }: { data: string }) {
  const [snap, setSnap] = useState<Snapshot>();
  const [undecodable, setUndecodable] = useState(false);
  // a link can unpack cleanly and still hold a list the sheet can't draw
  const [undrawable] = useErrorBoundary();
  useEffect(() => {
    decodeSnapshot(data)
      .then(setSnap)
      .catch(() => setUndecodable(true));
  }, [data]);
  if (undecodable || undrawable)
    return (
      <div class="page">
        <TopBar title="Shared list" />
        <p class="error-text pad">
          This link doesn't contain a readable list. It may have been cut short when it was sent.
        </p>
      </div>
    );
  if (!snap)
    return (
      <div class="page">
        <TopBar title="Shared list" />
        <Loading />
      </div>
    );
  return (
    <div class="page sheet-page">
      <div class="no-print">
        <TopBar
          title="Shared list"
          sub={snap.game}
          right={
            <button class="btn sm" onClick={() => go('/', true)}>
              Open Muster
            </button>
          }
        />
      </div>
      <Actions snap={snap} />
      <ArmySheet snap={snap} />
    </div>
  );
}

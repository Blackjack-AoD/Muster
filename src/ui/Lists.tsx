import { useEffect, useMemo, useState } from 'preact/hooks';
import { go } from '../app';
import type { RepoState } from '../data/db';
import { Evaluator, uid, type Roster } from '../data/engine';
import { newListLimit } from '../data/units';
import { activeSystems, getContext, rosterGameKey, systemsOf, gameKey, type SystemInfo } from '../data/library';
import { failureReason } from '../data/sync';
import { addRoster, failureMessage, toast, useStore } from '../store';
import { setUpForce } from '../data/setup';
import type { Context } from '../data/catalog';
import { Empty, Link, Loading, Sheet, TopBar, ago, fmtN } from './common';
import { Icon } from './Icon';

export function catalogueName(repos: RepoState[], repo: string, id: string) {
  return repos.find((r) => r.repo === repo)?.files.find((f) => f.header?.id === id)?.header?.name ?? 'Unknown army';
}
export function systemName(repos: RepoState[], repo: string, gstId: string) {
  return repos.find((r) => r.repo === repo)?.files.find((f) => f.header?.id === gstId)?.header?.name ?? repo;
}

export function Lists() {
  const rosters = useStore((s) => s.rosters);
  const repos = useStore((s) => s.repos);
  const sync = useStore((s) => s.sync);
  const game = useStore((s) => s.game);
  const [creating, setCreating] = useState(false);
  const { active } = activeSystems(repos, game);
  const filterKey = active && systemsOf(repos).length > 1 ? gameKey(active) : undefined;
  const sorted = useMemo(
    () => rosters.filter((r) => !filterKey || rosterGameKey(r) === filterKey).sort((a, b) => b.updated - a.updated),
    [rosters, filterKey],
  );
  const elsewhere = rosters.length - sorted.length;
  const syncing = Object.values(sync).some((p) => p.stage === 'checking' || p.stage === 'downloading');
  const hasData = systemsOf(repos).length > 0;

  return (
    <div class="page">
      <TopBar
        title="Muster"
        sub={active ? active.gst.header.name : 'Army lists · all games'}
        right={
          hasData ? (
            <Link class="icon-btn sm" to="/games">
              <Icon name="dice" />
            </Link>
          ) : null
        }
      />
      {!hasData && (
        <div class="banner">
          {syncing ? (
            <>
              <div class="spinner sm" /> Downloading army data… you can keep using the app.
            </>
          ) : (
            <>
              No army data on this phone yet.{' '}
              <Link to="/data" replace>
                Get data
              </Link>
            </>
          )}
        </div>
      )}
      {sorted.length === 0 ? (
        <Empty title="No lists yet">
          <p class="muted">Build your first army list. It's saved on this phone and works offline.</p>
          {hasData && (
            <button class="btn primary" onClick={() => setCreating(true)}>
              <Icon name="plus" /> New list
            </button>
          )}
        </Empty>
      ) : (
        <div class="cards">
          {sorted.map((r) => (
            <Link key={r.uid} class="card roster-card" to={`/r/${encodeURIComponent(r.uid)}`}>
              <div class="rc-main">
                <div class="rc-name">{r.name}</div>
                <div class="rc-sub">
                  {[...new Set(r.forces.map((f) => catalogueName(repos, r.repo, f.catalogueId)))].join(' · ') ||
                    'Empty'}
                </div>
                <div class="rc-meta">
                  {systemName(repos, r.repo, r.gameSystemId)} · edited {ago(r.updated)}
                </div>
              </div>
              <div class="rc-side">
                <span class="rc-limit">{r.costLimit > 0 ? fmtN(r.costLimit) : '∞'}</span>
                <span class="u">pts</span>
              </div>
            </Link>
          ))}
        </div>
      )}
      {elsewhere > 0 && (
        <p class="muted small pad-x center">
          {elsewhere} list{elsewhere === 1 ? '' : 's'} in other games. <Link to="/games">Switch game</Link>
        </p>
      )}
      {hasData && sorted.length > 0 && (
        <button class="fab" aria-label="New list" onClick={() => setCreating(true)}>
          <Icon name="plus" size={26} />
        </button>
      )}
      {creating && <NewList onClose={() => setCreating(false)} />}
    </div>
  );
}

function NewList({ onClose }: { onClose: () => void }) {
  const repos = useStore((s) => s.repos);
  const game = useStore((s) => s.game);
  const systems = systemsOf(repos);
  const [sys, setSys] = useState<SystemInfo | undefined>(activeSystems(repos, game).active);
  const [cat, setCat] = useState<SystemInfo['catalogues'][number]>();
  const [q, setQ] = useState('');

  if (!sys) {
    return (
      <Sheet title="Which game?" onClose={onClose}>
        <div class="pick-list">
          {systems.map((s) => (
            <button class="pick" onClick={() => setSys(s)}>
              <span>
                <b>{s.gst.header.name}</b>
                <small>
                  {s.repo} · {s.catalogues.length} armies
                </small>
              </span>
              <Icon name="chev" />
            </button>
          ))}
        </div>
      </Sheet>
    );
  }
  if (!cat) {
    const list = sys.catalogues.filter((c) => c.header.name.toLowerCase().includes(q.toLowerCase()));
    return (
      <Sheet title="Pick an army" onClose={onClose} full>
        <div class="search">
          <Icon name="search" size={18} />
          <input placeholder="Search armies" value={q} onInput={(e) => setQ(e.currentTarget.value)} />
        </div>
        <div class="pick-list">
          {list.map((c) => (
            <button class="pick" onClick={() => setCat(c)}>
              <span>
                <b>{c.header.name}</b>
              </span>
              <Icon name="chev" />
            </button>
          ))}
        </div>
      </Sheet>
    );
  }
  return <NewListDetails sys={sys} cat={cat} onClose={onClose} onBack={() => setCat(undefined)} />;
}

function NewListDetails({
  sys,
  cat,
  onClose,
  onBack,
}: {
  sys: SystemInfo;
  cat: SystemInfo['catalogues'][number];
  onClose: () => void;
  onBack: () => void;
}) {
  const repos = useStore((s) => s.repos);
  const repo = repos.find((r) => r.repo === sys.repo);
  const { id: catId, name: catName } = cat.header;
  const [state, setState] = useState<
    { forces: { id: string; name: string }[]; limit: number; ctx: Context } | { error: string }
  >();
  const [forceId, setForceId] = useState<string>();
  const [name, setName] = useState(catName.replace(/^\d{4}\s*-\s*/, ''));
  const [limit, setLimit] = useState('');

  useEffect(() => {
    if (!repo) return;
    setTimeout(() => {
      getContext(repo, catId)
        .then((ctx) => {
          const forces = ctx
            .forceEntries()
            .filter((f) => !f.hidden)
            .map((f) => ({ id: f.id, name: f.name }));
          const lim = newListLimit(ctx);
          setState({ forces, limit: lim, ctx });
          setForceId(forces[0]?.id);
          setLimit(String(lim));
        })
        .catch((e: unknown) => setState({ error: failureReason(e) }));
    }, 30);
  }, [catId]);

  if (!repo)
    return (
      <Sheet title={catName} onClose={onClose}>
        <p class="error-text">This army's data isn't on the phone.</p>
      </Sheet>
    );

  const create = async () => {
    if (!forceId || !state || 'error' in state) return;
    const r: Roster = {
      uid: uid(),
      name: name.trim() || catName,
      repo: sys.repo,
      gameSystemId: sys.gst.header.id,
      costLimit: Number(limit) || 0,
      forces: [{ uid: uid(), forceEntryId: forceId, catalogueId: catId, selections: [] }],
      created: Date.now(),
      updated: Date.now(),
    };
    // mandatory set-up (Legion, Allegiance by lore, Expanded Army Lists...) so the list starts ready to fill
    try {
      setUpForce(r, new Map([[catId, state.ctx]]), r.forces[0].uid, catName);
    } catch (e) {
      console.warn('set-up skipped', e);
    }
    try {
      await addRoster(r);
    } catch (e) {
      toast(failureMessage('create this list', e));
      return;
    }
    onClose();
    go(`/r/${r.uid}`, true);
  };

  return (
    <Sheet title={catName} onClose={onClose}>
      {!state ? (
        <Loading label="Reading army data…" />
      ) : 'error' in state ? (
        <p class="error-text">{state.error}</p>
      ) : (
        <div class="form">
          <label>
            List name
            <input value={name} onInput={(e) => setName(e.currentTarget.value)} />
          </label>
          <label>
            Points limit
            <input type="number" inputMode="numeric" value={limit} onInput={(e) => setLimit(e.currentTarget.value)} />
          </label>
          <div class="label">Detachment</div>
          <div class="pick-list compact">
            {state.forces.map((f) => (
              <button class={'pick radio' + (f.id === forceId ? ' on' : '')} onClick={() => setForceId(f.id)}>
                <span class="dot" />
                <span>
                  <b>{f.name}</b>
                </span>
              </button>
            ))}
          </div>
          <div class="row gap">
            <button class="btn" onClick={onBack}>
              Back
            </button>
            <button class="btn primary grow" onClick={create}>
              Create list
            </button>
          </div>
        </div>
      )}
    </Sheet>
  );
}

export function rosterIssueCount(ev: Evaluator) {
  return ev.issues.filter((i) => i.level === 'error').length;
}

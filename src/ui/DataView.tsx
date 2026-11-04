import { useEffect, useState } from 'preact/hooks';
import { storageUse } from '../data/db';
import { DEFAULT_REPOS, importLocalFiles, normaliseRepo } from '../data/sync';
import { clearCaches } from '../data/library';
import { importRosters, refreshRepos, removeRepo, syncAll, toast, useStore } from '../store';
import { TopBar, ago } from './common';
import { Icon } from './Icon';
import { shareBackup } from './exporter';

const mb = (b: number) => (b / 1048576).toFixed(b > 10485760 ? 0 : 1) + ' MB';

let installEvent: (Event & { prompt: () => Promise<void> }) | null = null;
addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvent = e as typeof installEvent; });

export function DataView() {
  const repos = useStore((s) => s.repos);
  const sync = useStore((s) => s.sync);
  const rosters = useStore((s) => s.rosters);
  const [input, setInput] = useState('');
  const [usage, setUsage] = useState<Awaited<ReturnType<typeof storageUse>>>(null);
  const [online, setOnline] = useState(navigator.onLine);
  const busy = Object.values(sync).some((p) => p.stage === 'checking' || p.stage === 'downloading');

  useEffect(() => {
    storageUse().then(setUsage);
    const on = () => setOnline(navigator.onLine);
    addEventListener('online', on);
    addEventListener('offline', on);
    return () => { removeEventListener('online', on); removeEventListener('offline', on); };
  }, [repos]);

  const add = () => {
    const r = normaliseRepo(input);
    if (!r) return toast('Use the form owner/repo, e.g. BSData/horus-heresy');
    setInput('');
    syncAll([r]);
  };

  const standalone = matchMedia('(display-mode: standalone)').matches;

  return (
    <div class="page">
      <TopBar title="Data" sub={online ? 'Online' : 'Offline: everything on the phone still works'} />

      {!standalone && (
        <div class="banner info">
          <Icon name="shield" size={18} />
          <span>
            Install Muster for full-screen, offline use: {installEvent ? (
              <button class="link" onClick={() => installEvent?.prompt()}>Install app</button>
            ) : <>in your browser menu choose <b>Add to Home screen</b> (or <b>Install app</b>).</>}
          </span>
        </div>
      )}

      <div class="list-label">Army data sources</div>
      <div class="cards">
        {repos.length === 0 && !busy && <p class="muted pad-x">Nothing downloaded yet.</p>}
        {[...new Set([...repos.map((r) => r.repo), ...Object.keys(sync)])].map((name) => {
          const r = repos.find((x) => x.repo === name);
          const p = sync[name];
          const working = p && (p.stage === 'checking' || p.stage === 'downloading');
          const size = r?.files.reduce((t, f) => t + f.size, 0) ?? 0;
          return (
            <div class="card repo" key={name}>
              <div class="repo-main">
                <b>{name}</b>
                <small class="muted">
                  {r?.files.length ? `${r.files.length} files · ${mb(size)} · synced ${ago(r.syncedAt)}` : 'Not downloaded'}
                </small>
                {working && (
                  <div class="progress">
                    <div class="meter"><div class="meter-fill" style={{ width: p.total ? (p.done / p.total) * 100 + '%' : '8%' }} /></div>
                    <small>{p.stage === 'checking' ? 'Checking for updates…' : `Downloading ${p.done}/${p.total}`}</small>
                  </div>
                )}
                {!working && p?.message && <small class={p.stage === 'error' ? 'error-text' : 'good-text'}>{p.message}</small>}
                {!working && !p && r?.error && <small class="error-text">{r.error}</small>}
              </div>
              {!working && name !== 'local' && (
                <button class="icon-btn" aria-label={'Sync ' + name} disabled={!online || busy} onClick={() => syncAll([name])}><Icon name="sync" /></button>
              )}
              {!working && (
                <button class="icon-btn" aria-label={'Remove ' + name} onClick={() => {
                  if (confirm(`Remove ${name} data from this phone? Lists using it will need it re-downloaded.`)) removeRepo(name);
                }}><Icon name="trash" /></button>
              )}
            </div>
          );
        })}
      </div>

      <div class="pad">
        <button class="btn primary wide" disabled={!online || busy || !repos.length} onClick={() => syncAll()}>
          <Icon name="sync" /> {busy ? 'Syncing…' : 'Check all for updates'}
        </button>
      </div>

      <div class="list-label">Add a GitHub repo</div>
      <div class="pad-x row gap">
        <input class="grow" placeholder="owner/repo or GitHub URL" value={input} onInput={(e) => setInput(e.currentTarget.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()} autocapitalize="off" autocorrect="off" spellcheck={false} />
        <button class="btn" disabled={!online || !input} onClick={add}>Add</button>
      </div>
      <p class="muted small pad-x">Any public BattleScribe / New Recruit data repo works. {DEFAULT_REPOS.filter((d) => !repos.some((r) => r.repo === d) && !sync[d]).map((d) => (
        <button class="link" onClick={() => syncAll([d])}>Add {d}</button>
      ))}</p>

      <div class="list-label">Files on this phone</div>
      <div class="pad-x">
        <label class="btn wide file-btn">
          <Icon name="plus" /> Import data files or a repo .zip
          <input type="file" multiple accept=".gst,.cat,.gstz,.catz,.zip,application/xml,text/xml,application/zip" onChange={async (e) => {
            const input = e.currentTarget;
            const files = [...(input.files ?? [])];
            input.value = '';
            if (!files.length) return;
            try {
              const n = await importLocalFiles('local', files);
              clearCaches('local');
              await refreshRepos();
              toast(n ? `Imported ${n} data file${n === 1 ? '' : 's'}` : 'No .gst / .cat files found in that');
            } catch (err) {
              toast(`Couldn't import: ${(err as Error).message}`);
            }
          }} />
        </label>
        <p class="muted small">Handy for testing your own edits from New Recruit without pushing to GitHub. Pick .gst / .cat files (zipped .gstz / .catz work too) and include the game system file, or pick a whole repo .zip from GitHub's Download ZIP.</p>
      </div>

      <div class="list-label">Your lists</div>
      <div class="pad-x row gap">
        <button class="btn grow" disabled={!rosters.length} onClick={() => shareBackup(rosters)}><Icon name="share" /> Back up {rosters.length} list{rosters.length === 1 ? '' : 's'}</button>
        <label class="btn grow file-btn">
          Restore
          <input type="file" accept=".json,application/json" onChange={async (e) => {
            const f = e.currentTarget.files?.[0];
            if (!f) return;
            try {
              const data = JSON.parse(await f.text());
              const list = Array.isArray(data) ? data : data.rosters;
              await importRosters(list);
              toast(`Restored ${list.length} list(s)`);
            } catch {
              toast("That file isn't a Muster backup");
            }
          }} />
        </label>
      </div>
      <p class="muted small pad-x">Lists live only on this phone. Back them up now and then, or to move them to a friend's phone.</p>

      {usage && (
        <p class="muted small pad-x">
          Storage used: {mb(usage.used)}{usage.quota ? ` of ${mb(usage.quota)}` : ''}. {usage.persisted ? 'Protected from automatic clean-up.' : 'The browser may clear this if the phone runs very low on space; installing the app helps.'}
        </p>
      )}
      <div class="foot-space" />
    </div>
  );
}

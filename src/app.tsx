import { useEffect, useState } from 'preact/hooks';
import { useStore } from './store';
import { Lists } from './ui/Lists';
import { RosterView } from './ui/RosterView';
import { UnitPage } from './ui/UnitPage';
import { Library } from './ui/Library';
import { DataView } from './ui/DataView';
import { Games } from './ui/Games';
import { Compendium } from './ui/Library';
import { Icon } from './ui/Icon';

function useHash() {
  const [h, setH] = useState(location.hash || '#/');
  useEffect(() => {
    const f = () => setH(location.hash || '#/');
    addEventListener('hashchange', f);
    return () => removeEventListener('hashchange', f);
  }, []);
  return h;
}

let depth = 0;
addEventListener('popstate', () => { if (depth > 0) depth--; });
export function go(path: string, replace = false) {
  const h = '#' + path;
  if (replace) history.replaceState(null, '', h);
  else { history.pushState(null, '', h); depth++; }
  dispatchEvent(new HashChangeEvent('hashchange'));
}
/** go back within the app, or to a sensible parent page if opened directly */
export function back(fallback = '/') {
  if (depth > 0) history.back();
  else go(fallback, true);
}

export function App() {
  const hash = useHash();
  const ready = useStore((s) => s.ready);
  const toast = useStore((s) => s.toast);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [hash]);

  const parts = hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  let page;
  let tab = 'lists';
  if (!ready) page = <div class="center-fill"><div class="spinner" /></div>;
  else if (parts[0] === 'r' && parts[1] && parts[2] === 'u') page = <UnitPage rosterUid={parts[1]} selUid={parts[3]} />;
  else if (parts[0] === 'r' && parts[1]) page = <RosterView uid={parts[1]} />;
  else if (parts[0] === 'games') {
    tab = 'games';
    page = <Games />;
  } else if (parts[0] === 'lib-rules') {
    tab = 'lib';
    page = <Compendium />;
  } else if (parts[0] === 'lib') {
    tab = 'lib';
    page = <Library repo={parts[1] && parts[2] ? `${parts[1]}/${parts[2]}` : undefined} catId={parts[3]} unitKey={parts[4]} />;
  } else if (parts[0] === 'data') {
    tab = 'data';
    page = <DataView />;
  } else page = <Lists />;

  const showNav = !(parts[0] === 'r' && parts[1]) && !(parts[0] === 'lib' && parts[4]);
  return (
    <div class={'app' + (showNav ? ' has-nav' : '')}>
      {page}
      {showNav && (
        <nav class="tabbar">
          <a class={tab === 'games' ? 'on' : ''} href="#/games"><Icon name="dice" /><span>Games</span></a>
          <a class={tab === 'lists' ? 'on' : ''} href="#/"><Icon name="list" /><span>Lists</span></a>
          <a class={tab === 'lib' ? 'on' : ''} href="#/lib"><Icon name="book" /><span>Library</span></a>
          <a class={tab === 'data' ? 'on' : ''} href="#/data"><Icon name="sync" /><span>Data</span></a>
        </nav>
      )}
      {toast && <div class="toast">{toast}</div>}
    </div>
  );
}

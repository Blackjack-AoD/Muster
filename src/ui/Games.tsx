import { go } from '../app';
import { gameKey, rosterGameKey, systemsOf } from '../data/library';
import { setGame, toast, useStore } from '../store';
import { Empty, Link, TopBar } from './common';

/** Choose which game Lists and Library show. */
export function Games() {
  const repos = useStore((s) => s.repos);
  const rosters = useStore((s) => s.rosters);
  const game = useStore((s) => s.game);
  const systems = systemsOf(repos);
  if (!systems.length) {
    return (
      <div class="page">
        <TopBar title="Games" />
        <Empty title="No games yet">
          <p class="muted">
            Download army data on the{' '}
            <Link to="/data" replace>
              Data
            </Link>{' '}
            tab.
          </p>
        </Empty>
      </div>
    );
  }
  const current = systems.find((s) => gameKey(s) === game);
  const pick = (key: string | undefined, name: string) => {
    setGame(key);
    toast(key ? `Showing ${name}` : 'Showing all games');
    go('/', true);
  };
  return (
    <div class="page">
      <TopBar title="Games" sub="Lists and Library show the game you pick here" />
      <div class="pick-list games">
        {systems.length > 1 && (
          <button class={'pick radio' + (!current ? ' on' : '')} onClick={() => pick(undefined, '')}>
            <span class="dot" />
            <span>
              <b>All games</b>
              <small>
                {rosters.length} list{rosters.length === 1 ? '' : 's'}
              </small>
            </span>
          </button>
        )}
        {systems.map((s) => {
          const key = gameKey(s);
          const lists = rosters.filter((r) => rosterGameKey(r) === key).length;
          const name = s.gst.header!.name;
          return (
            <button class={'pick radio' + (current === s ? ' on' : '')} onClick={() => pick(key, name)}>
              <span class="dot" />
              <span>
                <b>{name}</b>
                <small>
                  {s.catalogues.length} arm{s.catalogues.length === 1 ? 'y' : 'ies'} · {lists} list
                  {lists === 1 ? '' : 's'} · {s.repo}
                </small>
              </span>
            </button>
          );
        })}
      </div>
      <p class="muted small pad-x">
        To add another game, add its data repo on the <Link to="/data">Data</Link> tab.
      </p>
    </div>
  );
}
